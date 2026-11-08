//! The five-way fee split.
//!
//! | Bucket   | Default | Paid in |
//! | -------- | ------: | ------- |
//! | Holders  | 15 %    | paired token, pro rata |
//! | Creator  |  5 %    | paired token |
//! | Flagship | 35 %    | SOL → $FLOAT, burned |
//! | Traders  | 35 %    | USDC airdrop |
//! | Treasury | 10 %    | paired token |

use crate::error::{CoreError, Result};
use crate::BPS;

/// Split shares in basis points.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SplitBps {
    /// Holders share.
    pub holders: u16,
    /// Creator share.
    pub creator: u16,
    /// Flagship ($FLOAT buyback & burn) share.
    pub flagship: u16,
    /// Traders (USDC airdrop) share.
    pub traders: u16,
    /// Treasury share. Also receives rounding dust.
    pub treasury: u16,
}

impl SplitBps {
    /// Float's published split: 15 / 5 / 35 / 35 / 10.
    pub const FLOAT: Self = Self { holders: 1_500, creator: 500, flagship: 3_500, traders: 3_500, treasury: 1_000 };

    /// Sum of all shares.
    pub const fn total(&self) -> u32 {
        self.holders as u32 + self.creator as u32 + self.flagship as u32 + self.traders as u32 + self.treasury as u32
    }

    /// Fails unless the shares sum to exactly 10 000 bps.
    pub fn validate(&self) -> Result<()> {
        if self.total() == BPS as u32 {
            Ok(())
        } else {
            Err(CoreError::InvalidSplit)
        }
    }
}

impl Default for SplitBps {
    fn default() -> Self {
        Self::FLOAT
    }
}

/// Amounts per bucket, in the paired token's base units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SplitAmounts {
    /// To the holder payout vault.
    pub holders: u64,
    /// To the creator wallet.
    pub creator: u64,
    /// To the flagship (buyback) vault.
    pub flagship: u64,
    /// To the traders (airdrop) vault.
    pub traders: u64,
    /// To the treasury.
    pub treasury: u64,
}

impl SplitAmounts {
    /// Sum of all buckets; always equals the input of [`split`].
    pub const fn total(&self) -> u64 {
        self.holders + self.creator + self.flagship + self.traders + self.treasury
    }
}

fn share(amount: u64, bps: u16) -> u64 {
    // amount * bps fits in u128 for any u64 amount; result <= amount.
    ((amount as u128 * bps as u128) / BPS as u128) as u64
}

/// Splits `amount`. Each bucket is floored; the remainder (at most 4 base
/// units) goes to the treasury so the parts always sum to `amount`.
pub fn split(amount: u64, bps: &SplitBps) -> Result<SplitAmounts> {
    bps.validate()?;
    let holders = share(amount, bps.holders);
    let creator = share(amount, bps.creator);
    let flagship = share(amount, bps.flagship);
    let traders = share(amount, bps.traders);
    let allocated = holders + creator + flagship + traders; // <= amount, cannot overflow
    let treasury = amount.checked_sub(allocated).ok_or(CoreError::MathOverflow)?;
    Ok(SplitAmounts { holders, creator, flagship, traders, treasury })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float_split_sums_to_100() {
        assert_eq!(SplitBps::FLOAT.total(), 10_000);
    }

    #[test]
    fn split_matches_sdk_vector() {
        // Same vector as packages/sdk/test/float.test.ts
        let s = split(1_000_000_007, &SplitBps::FLOAT).unwrap();
        assert_eq!(s.holders, 150_000_001);
        assert_eq!(s.creator, 50_000_000);
        assert_eq!(s.flagship, 350_000_002);
        assert_eq!(s.traders, 350_000_002);
        assert_eq!(s.treasury, 100_000_002);
        assert_eq!(s.total(), 1_000_000_007);
    }

    #[test]
    fn split_is_exact_for_every_small_amount() {
        for a in 0..5_000u64 {
            assert_eq!(split(a, &SplitBps::FLOAT).unwrap().total(), a);
        }
    }

    #[test]
    fn split_handles_u64_max() {
        let s = split(u64::MAX, &SplitBps::FLOAT).unwrap();
        assert_eq!(s.total(), u64::MAX);
    }

    #[test]
    fn rejects_bad_split() {
        let bad = SplitBps { holders: 1, ..SplitBps::FLOAT };
        assert_eq!(split(10, &bad), Err(CoreError::InvalidSplit));
    }
}
