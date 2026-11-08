//! $FLOAT buyback rules.
//!
//! * A buy may fire once at least [`TARGET_LAMPORTS`] (5 SOL) are available,
//!   or with whatever has accumulated once [`MAX_INTERVAL_SECS`] (4 h) have
//!   passed since the previous buy.
//! * A single buy may move the $FLOAT price by at most [`MAX_IMPACT_BPS`] (1 %).

use crate::cpmm::{self, Fees};
use crate::error::{CoreError, Result};
use crate::LAMPORTS_PER_SOL;

/// Buy threshold.
pub const TARGET_LAMPORTS: u64 = 5 * LAMPORTS_PER_SOL;
/// Maximum time between buys.
pub const MAX_INTERVAL_SECS: i64 = 4 * 60 * 60;
/// Maximum price impact per buy.
pub const MAX_IMPACT_BPS: u64 = 100;

/// Why a buyback is allowed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// The vault holds at least the target.
    Target,
    /// The interval since the last buy has elapsed.
    Interval,
}

/// Returns why a buyback may fire now, or [`CoreError::BuybackNotDue`].
pub fn trigger(available: u64, last_buy_ts: i64, now: i64, target: u64, interval: i64) -> Result<Trigger> {
    if available == 0 {
        return Err(CoreError::BuybackNotDue);
    }
    if available >= target {
        return Ok(Trigger::Target);
    }
    if last_buy_ts == 0 || now.saturating_sub(last_buy_ts) >= interval {
        return Ok(Trigger::Interval);
    }
    Err(CoreError::BuybackNotDue)
}

/// Largest input whose price impact is within `max_impact_bps` (binary search
/// over the exact CPMM math, fees included).
pub fn max_input_within_impact(sol_reserve: u64, float_reserve: u64, fees: &Fees, max_impact_bps: u64) -> Result<u64> {
    if sol_reserve == 0 || float_reserve == 0 {
        return Err(CoreError::InvalidReserves);
    }
    let ok = |amt: u64| -> bool {
        cpmm::swap_base_input(amt, sol_reserve, float_reserve, fees)
            .map(|r| cpmm::within_price_impact(sol_reserve, float_reserve, &r, max_impact_bps))
            .unwrap_or(false)
    };
    let (mut lo, mut hi) = (0u64, sol_reserve);
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if ok(mid) {
            lo = mid
        } else {
            hi = mid - 1
        }
    }
    Ok(lo)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trigger_rules() {
        let now = 1_000_000;
        assert_eq!(trigger(0, 0, now, TARGET_LAMPORTS, MAX_INTERVAL_SECS), Err(CoreError::BuybackNotDue));
        assert_eq!(trigger(TARGET_LAMPORTS, now, now, TARGET_LAMPORTS, MAX_INTERVAL_SECS), Ok(Trigger::Target));
        assert_eq!(trigger(1, now - 3 * 3600, now, TARGET_LAMPORTS, MAX_INTERVAL_SECS), Err(CoreError::BuybackNotDue));
        assert_eq!(trigger(1, now - 4 * 3600, now, TARGET_LAMPORTS, MAX_INTERVAL_SECS), Ok(Trigger::Interval));
        assert_eq!(trigger(1, 0, now, TARGET_LAMPORTS, MAX_INTERVAL_SECS), Ok(Trigger::Interval));
    }

    #[test]
    fn cap_is_tight_and_matches_sdk_range() {
        let fees = Fees {
            trade_fee_rate: 2_500,
            protocol_fee_rate: 120_000,
            fund_fee_rate: 40_000,
            creator_fee_rate: 0,
            creator_fee_on_input: true,
        };
        let (x, y) = (2_000 * LAMPORTS_PER_SOL, 50_000_000 * 1_000_000);
        let cap = max_input_within_impact(x, y, &fees, MAX_IMPACT_BPS).unwrap();
        // SDK test asserts 9..11 SOL for the same pool.
        assert!(cap > 9 * LAMPORTS_PER_SOL && cap < 11 * LAMPORTS_PER_SOL, "cap={cap}");
        let at = cpmm::swap_base_input(cap, x, y, &fees).unwrap();
        assert!(cpmm::within_price_impact(x, y, &at, MAX_IMPACT_BPS));
        let over = cpmm::swap_base_input(cap + 1, x, y, &fees).unwrap();
        assert!(!cpmm::within_price_impact(x, y, &over, MAX_IMPACT_BPS));
    }
}
