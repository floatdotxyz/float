//! Raydium CPMM `swap_base_input` math.
//!
//! Line-by-line port of `curve/calculator.rs::CurveCalculator::swap_base_input`
//! and `curve/fees.rs` from `raydium-io/raydium-cp-swap` (vendored under
//! `vendor/raydium/cp-swap-src`). All rates are in 1e-6 units.

use crate::error::{CoreError, Result};
use crate::FEE_RATE_DENOMINATOR;

const D: u128 = FEE_RATE_DENOMINATOR as u128;

fn ceil_div(a: u128, num: u128, den: u128) -> Result<u128> {
    if den == 0 {
        return Err(CoreError::MathOverflow);
    }
    a.checked_mul(num).and_then(|x| x.checked_add(den - 1)).map(|x| x / den).ok_or(CoreError::MathOverflow)
}

fn floor_div(a: u128, num: u128, den: u128) -> Result<u128> {
    if den == 0 {
        return Err(CoreError::MathOverflow);
    }
    a.checked_mul(num).map(|x| x / den).ok_or(CoreError::MathOverflow)
}

/// Fee configuration of a pool (from its `AmmConfig` and `PoolState`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Fees {
    /// `AmmConfig.trade_fee_rate`.
    pub trade_fee_rate: u64,
    /// `AmmConfig.creator_fee_rate`, or 0 when `PoolState.enable_creator_fee` is false.
    pub creator_fee_rate: u64,
    /// `AmmConfig.protocol_fee_rate` (share of the trade fee).
    pub protocol_fee_rate: u64,
    /// `AmmConfig.fund_fee_rate` (share of the trade fee).
    pub fund_fee_rate: u64,
    /// Whether the creator fee is charged on the input side for this direction.
    pub creator_fee_on_input: bool,
}

/// Result of a swap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwapResult {
    /// Output delivered to the trader.
    pub output_amount: u64,
    /// Trade fee (LP + protocol + fund).
    pub trade_fee: u64,
    /// Protocol part of the trade fee.
    pub protocol_fee: u64,
    /// Fund part of the trade fee.
    pub fund_fee: u64,
    /// Creator fee.
    pub creator_fee: u64,
    /// Input reserve after the swap.
    pub new_input_reserve: u64,
    /// Output reserve after the swap.
    pub new_output_reserve: u64,
}

/// Port of `CurveCalculator::swap_base_input`.
pub fn swap_base_input(amount_in: u64, input_reserve: u64, output_reserve: u64, f: &Fees) -> Result<SwapResult> {
    if input_reserve == 0 || output_reserve == 0 {
        return Err(CoreError::InvalidReserves);
    }
    let amount = amount_in as u128;
    let mut creator_fee: u128 = 0;
    let trade_fee: u128;
    let less_fees: u128;

    if f.creator_fee_on_input {
        let rate = f.trade_fee_rate as u128 + f.creator_fee_rate as u128;
        let total_fee = ceil_div(amount, rate, D)?;
        creator_fee = if rate == 0 { 0 } else { floor_div(total_fee, f.creator_fee_rate as u128, rate)? };
        trade_fee = total_fee - creator_fee;
        less_fees = amount.checked_sub(total_fee).ok_or(CoreError::MathOverflow)?;
    } else {
        trade_fee = ceil_div(amount, f.trade_fee_rate as u128, D)?;
        less_fees = amount.checked_sub(trade_fee).ok_or(CoreError::MathOverflow)?;
    }
    let protocol_fee = floor_div(trade_fee, f.protocol_fee_rate as u128, D)?;
    let fund_fee = floor_div(trade_fee, f.fund_fee_rate as u128, D)?;

    let x = input_reserve as u128;
    let y = output_reserve as u128;
    let swapped = less_fees.checked_mul(y).ok_or(CoreError::MathOverflow)? / (x + less_fees);

    let mut output = swapped;
    if !f.creator_fee_on_input {
        creator_fee = ceil_div(swapped, f.creator_fee_rate as u128, D)?;
        output = swapped.checked_sub(creator_fee).ok_or(CoreError::MathOverflow)?;
    }

    let to_u64 = |v: u128| u64::try_from(v).map_err(|_| CoreError::MathOverflow);
    Ok(SwapResult {
        output_amount: to_u64(output)?,
        trade_fee: to_u64(trade_fee)?,
        protocol_fee: to_u64(protocol_fee)?,
        fund_fee: to_u64(fund_fee)?,
        creator_fee: to_u64(creator_fee)?,
        new_input_reserve: to_u64(x + less_fees)?,
        new_output_reserve: to_u64(y - swapped)?,
    })
}

/// True if the spot price moved by at most `max_impact_bps` during a swap.
///
/// Price is `output_reserve / input_reserve`. The check is
/// `(before - after) / before <= max_impact_bps / 10_000`, evaluated without
/// overflow as `rhs - lhs <= rhs * bps / 10_000` with `lhs = y'·x`, `rhs = y·x'`.
pub fn within_price_impact(input_reserve: u64, output_reserve: u64, r: &SwapResult, max_impact_bps: u64) -> bool {
    let lhs = r.new_output_reserve as u128 * input_reserve as u128;
    let rhs = output_reserve as u128 * r.new_input_reserve as u128;
    if lhs >= rhs {
        return true;
    }
    let allowed = (rhs / crate::BPS as u128) * max_impact_bps as u128;
    rhs - lhs <= allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_on_input_vector() {
        // Same vector as packages/sdk/test/raydium.test.ts
        let f = Fees {
            trade_fee_rate: 2_500,
            creator_fee_rate: 500,
            protocol_fee_rate: 120_000,
            fund_fee_rate: 40_000,
            creator_fee_on_input: true,
        };
        let r = swap_base_input(1_000_000, 100_000_000, 50_000_000, &f).unwrap();
        assert_eq!(r.creator_fee, 500);
        assert_eq!(r.trade_fee, 2_500);
        assert_eq!(r.protocol_fee, 300);
        assert_eq!(r.fund_fee, 100);
        assert_eq!(r.output_amount, (997_000u128 * 50_000_000 / 100_997_000) as u64);
    }

    #[test]
    fn fee_on_output_vector() {
        let f = Fees { trade_fee_rate: 2_500, creator_fee_rate: 500, protocol_fee_rate: 0, fund_fee_rate: 0, creator_fee_on_input: false };
        let r = swap_base_input(1_000_000, 100_000_000, 50_000_000, &f).unwrap();
        let swapped = 997_500u128 * 50_000_000 / 100_997_500;
        let cf = (swapped * 500).div_ceil(1_000_000);
        assert_eq!(r.creator_fee as u128, cf);
        assert_eq!(r.output_amount as u128, swapped - cf);
    }

    #[test]
    fn invariant_never_decreases() {
        let f = Fees { trade_fee_rate: 2_500, ..Default::default() };
        for amt in [1u64, 10, 12_345, 9_999_999, 1 << 40] {
            let r = swap_base_input(amt, 7_777_777, 3_333_333, &f).unwrap();
            assert!(r.new_input_reserve as u128 * r.new_output_reserve as u128 >= 7_777_777u128 * 3_333_333);
        }
    }

    #[test]
    fn impact_check() {
        let f = Fees { trade_fee_rate: 2_500, ..Default::default() };
        let (x, y) = (2_000 * crate::LAMPORTS_PER_SOL, 50_000_000_000_000u64);
        let small = swap_base_input(crate::LAMPORTS_PER_SOL, x, y, &f).unwrap();
        assert!(within_price_impact(x, y, &small, 100));
        let big = swap_base_input(20 * crate::LAMPORTS_PER_SOL, x, y, &f).unwrap();
        assert!(!within_price_impact(x, y, &big, 100));
    }

    #[test]
    fn empty_reserves_rejected() {
        assert_eq!(swap_base_input(1, 0, 1, &Fees::default()), Err(CoreError::InvalidReserves));
    }
}
