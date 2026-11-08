//! Price guard for fee-cycle swaps.
//!
//! A conversion swap must return at least `expected · (1 − guard)`, where
//! `expected` comes from a reference price supplied by the operator and
//! `guard` defaults to [`DEFAULT_GUARD_BPS`] (2 %). A trader who moves the
//! price before a conversion can therefore extract at most ~2 % of it.

use crate::error::{CoreError, Result};
use crate::BPS;

/// Default tolerance (2 %).
pub const DEFAULT_GUARD_BPS: u16 = 200;
/// Hard upper bound accepted by the router config (10 %).
pub const MAX_GUARD_BPS: u16 = 1_000;

/// `Q64.64` fixed-point one.
pub const Q64: u128 = 1u128 << 64;

/// Expected output for `amount_in` at `price_q64` (output per input, Q64.64).
pub fn expected_out(amount_in: u64, price_q64: u128) -> Result<u64> {
    let v = (amount_in as u128).checked_mul(price_q64).ok_or(CoreError::MathOverflow)? >> 64;
    u64::try_from(v).map_err(|_| CoreError::MathOverflow)
}

/// Minimum acceptable output under a guard of `guard_bps`.
pub fn min_out(expected: u64, guard_bps: u16) -> Result<u64> {
    if guard_bps as u64 > BPS {
        return Err(CoreError::MathOverflow);
    }
    Ok(((expected as u128 * (BPS - guard_bps as u64) as u128) / BPS as u128) as u64)
}

/// Fails with [`CoreError::PriceGuard`] if `actual` is below the guard minimum.
pub fn check(actual: u64, amount_in: u64, price_q64: u128, guard_bps: u16) -> Result<()> {
    let floor = min_out(expected_out(amount_in, price_q64)?, guard_bps)?;
    if actual >= floor {
        Ok(())
    } else {
        Err(CoreError::PriceGuard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_percent_guard() {
        assert_eq!(min_out(10_000, DEFAULT_GUARD_BPS).unwrap(), 9_800);
        let half = Q64 / 2;
        assert_eq!(expected_out(1_000, half).unwrap(), 500);
        assert!(check(490, 1_000, half, DEFAULT_GUARD_BPS).is_ok());
        assert_eq!(check(489, 1_000, half, DEFAULT_GUARD_BPS), Err(CoreError::PriceGuard));
    }
}
