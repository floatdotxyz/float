//! Ticker rules.
//!
//! * 1–10 ASCII letters or digits, case-insensitive.
//! * First launch of a ticker is free; later launches pay a reuse fee
//!   (1 SOL) for coins launched at or after [`REUSE_FEE_EFFECTIVE_TS`].
//! * The fee is refunded if the coin graduates within [`REFUND_WINDOW_SECS`]
//!   of launch; otherwise it is released to the treasury.

use crate::error::{CoreError, Result};
use crate::LAMPORTS_PER_SOL;

/// Maximum ticker length.
pub const MAX_TICKER_LEN: usize = 10;
/// Reuse fee in lamports (1 SOL).
pub const REUSE_FEE_LAMPORTS: u64 = LAMPORTS_PER_SOL;
/// Graduation window for a refund (48 h).
pub const REFUND_WINDOW_SECS: i64 = 48 * 60 * 60;
/// 2026-11-05T04:01:00Z = Nov 4, 2026 10:01 PM CST.
pub const REUSE_FEE_EFFECTIVE_TS: i64 = 1_793_851_260;

/// A normalised (upper-case) ticker stored inline, usable as a PDA seed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ticker {
    bytes: [u8; MAX_TICKER_LEN],
    len: u8,
}

impl Ticker {
    /// Parses and normalises a ticker. A leading `$` is ignored.
    pub fn parse(input: &[u8]) -> Result<Self> {
        let s = match input.first() {
            Some(b'$') => &input[1..],
            _ => input,
        };
        if s.is_empty() || s.len() > MAX_TICKER_LEN {
            return Err(CoreError::InvalidTicker);
        }
        let mut bytes = [0u8; MAX_TICKER_LEN];
        for (i, c) in s.iter().enumerate() {
            if !c.is_ascii_alphanumeric() {
                return Err(CoreError::InvalidTicker);
            }
            bytes[i] = c.to_ascii_uppercase();
        }
        Ok(Self { bytes, len: s.len() as u8 })
    }

    /// Normalised bytes (no padding). Use as a PDA seed.
    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes[..self.len as usize]
    }

    /// Length in bytes.
    pub fn len(&self) -> usize {
        self.len as usize
    }

    /// Always false: a parsed ticker has at least one character.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

/// Reuse fee owed when launching a ticker that has been launched `prior_launches` times.
pub fn reuse_fee(prior_launches: u32, launch_ts: i64) -> u64 {
    if prior_launches > 0 && launch_ts >= REUSE_FEE_EFFECTIVE_TS {
        REUSE_FEE_LAMPORTS
    } else {
        0
    }
}

/// What to do with an escrowed reuse fee.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeeSettlement {
    /// Graduated within the window: return the fee to the launcher.
    RefundLauncher,
    /// Window elapsed without graduation: release the fee to the treasury.
    ReleaseToTreasury,
    /// Window still open and not graduated yet.
    Pending,
}

/// Decides the settlement of an escrowed reuse fee.
pub fn settle(launched_at: i64, graduated_at: Option<i64>, now: i64) -> FeeSettlement {
    let deadline = launched_at.saturating_add(REFUND_WINDOW_SECS);
    match graduated_at {
        Some(g) if g >= launched_at && g <= deadline => FeeSettlement::RefundLauncher,
        Some(_) => FeeSettlement::ReleaseToTreasury,
        None if now > deadline => FeeSettlement::ReleaseToTreasury,
        None => FeeSettlement::Pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_insensitive_and_dollar_prefix() {
        let a = Ticker::parse(b"$Pepe").unwrap();
        let b = Ticker::parse(b"PEPE").unwrap();
        assert_eq!(a, b);
        assert_eq!(a.as_bytes(), b"PEPE");
    }

    #[test]
    fn length_and_charset() {
        assert!(Ticker::parse(b"A").is_ok());
        assert!(Ticker::parse(b"ABCDEFGHIJ").is_ok());
        assert_eq!(Ticker::parse(b"ABCDEFGHIJK"), Err(CoreError::InvalidTicker));
        assert_eq!(Ticker::parse(b""), Err(CoreError::InvalidTicker));
        assert_eq!(Ticker::parse(b"$"), Err(CoreError::InvalidTicker));
        assert_eq!(Ticker::parse(b"PE-PE"), Err(CoreError::InvalidTicker));
        assert_eq!(Ticker::parse("pepé".as_bytes()), Err(CoreError::InvalidTicker));
    }

    #[test]
    fn effective_timestamp_is_nov_4_2026_2201_cst() {
        // 2026-11-05T04:01:00Z: days from 1970-01-01 to 2026-11-05 = 20762
        assert_eq!(REUSE_FEE_EFFECTIVE_TS, 20_762 * 86_400 + 4 * 3_600 + 60);
    }

    #[test]
    fn reuse_fee_rules() {
        assert_eq!(reuse_fee(0, REUSE_FEE_EFFECTIVE_TS + 10), 0);
        assert_eq!(reuse_fee(1, REUSE_FEE_EFFECTIVE_TS - 1), 0);
        assert_eq!(reuse_fee(1, REUSE_FEE_EFFECTIVE_TS), REUSE_FEE_LAMPORTS);
    }

    #[test]
    fn settlement() {
        let l = 1_000_000;
        assert_eq!(settle(l, Some(l + REFUND_WINDOW_SECS), l + REFUND_WINDOW_SECS), FeeSettlement::RefundLauncher);
        assert_eq!(settle(l, Some(l + REFUND_WINDOW_SECS + 1), l + 10 * REFUND_WINDOW_SECS), FeeSettlement::ReleaseToTreasury);
        assert_eq!(settle(l, None, l + 3600), FeeSettlement::Pending);
        assert_eq!(settle(l, None, l + REFUND_WINDOW_SECS + 1), FeeSettlement::ReleaseToTreasury);
    }
}
