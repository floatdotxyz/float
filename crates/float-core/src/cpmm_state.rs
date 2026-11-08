//! Zero-copy reads of Raydium CPMM `PoolState` (bytemuck, `repr(C, packed)`)
//! and `AmmConfig` (borsh).
//!
//! `PoolState` layout (`vendor/raydium/cp-swap-src/states/pool.rs`, LEN = 637):
//!
//! ```text
//!   8 amm_config          40 pool_creator        72 token_0_vault      104 token_1_vault
//! 136 lp_mint            168 token_0_mint        200 token_1_mint       232 token_0_program
//! 264 token_1_program    296 observation_key     328 auth_bump          329 status
//! 330 lp_mint_decimals   331 mint_0_decimals     332 mint_1_decimals    333 lp_supply
//! 341 protocol_fees_0    349 protocol_fees_1     357 fund_fees_0        365 fund_fees_1
//! 373 open_time          381 recent_epoch        389 creator_fee_on     390 enable_creator_fee
//! 397 creator_fees_0     405 creator_fees_1      413 padding [u64; 28]
//! ```
//!
//! `AmmConfig` layout (`states/config.rs`):
//!
//! ```text
//! 8 bump  9 disable_create_pool  10 index:u16  12 trade_fee_rate  20 protocol_fee_rate
//! 28 fund_fee_rate  36 create_pool_fee  44 protocol_owner  76 fund_owner  108 creator_fee_rate
//! ```

use crate::cpmm::Fees;
use crate::error::{CoreError, Result};

/// `sha256("account:PoolState")[..8]` (same name as LaunchLab's, distinguished by owner).
pub const POOL_STATE_DISCRIMINATOR: [u8; 8] = [247, 237, 227, 245, 215, 195, 222, 70];
/// `sha256("account:AmmConfig")[..8]`.
pub const AMM_CONFIG_DISCRIMINATOR: [u8; 8] = [218, 244, 33, 104, 203, 203, 43, 111];
/// `PoolState::LEN`.
pub const POOL_STATE_LEN: usize = 637;

fn u64_at(d: &[u8], o: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&d[o..o + 8]);
    u64::from_le_bytes(b)
}

fn key_at(d: &[u8], o: usize) -> [u8; 32] {
    let mut b = [0u8; 32];
    b.copy_from_slice(&d[o..o + 32]);
    b
}

/// Borrowed view over CPMM `PoolState`.
#[derive(Clone, Copy)]
pub struct CpmmPoolView<'a>(&'a [u8]);

impl<'a> CpmmPoolView<'a> {
    /// Validates length and discriminator.
    pub fn new(data: &'a [u8]) -> Result<Self> {
        if data.len() < POOL_STATE_LEN || data[..8] != POOL_STATE_DISCRIMINATOR {
            return Err(CoreError::InvalidAccountData);
        }
        Ok(Self(data))
    }
    /// `amm_config`
    pub fn amm_config(&self) -> [u8; 32] {
        key_at(self.0, 8)
    }
    /// `pool_creator`
    pub fn pool_creator(&self) -> [u8; 32] {
        key_at(self.0, 40)
    }
    /// `token_0_vault`
    pub fn token_0_vault(&self) -> [u8; 32] {
        key_at(self.0, 72)
    }
    /// `token_1_vault`
    pub fn token_1_vault(&self) -> [u8; 32] {
        key_at(self.0, 104)
    }
    /// `token_0_mint`
    pub fn token_0_mint(&self) -> [u8; 32] {
        key_at(self.0, 168)
    }
    /// `token_1_mint`
    pub fn token_1_mint(&self) -> [u8; 32] {
        key_at(self.0, 200)
    }
    /// `observation_key`
    pub fn observation_key(&self) -> [u8; 32] {
        key_at(self.0, 296)
    }
    /// Fees owed on token_0 (protocol + fund + creator), excluded from reserves.
    pub fn owed_fees_0(&self) -> u64 {
        u64_at(self.0, 341).saturating_add(u64_at(self.0, 357)).saturating_add(u64_at(self.0, 397))
    }
    /// Fees owed on token_1.
    pub fn owed_fees_1(&self) -> u64 {
        u64_at(self.0, 349).saturating_add(u64_at(self.0, 365)).saturating_add(u64_at(self.0, 405))
    }
    /// `creator_fee_on`: 0 both, 1 only token_0, 2 only token_1.
    pub fn creator_fee_on(&self) -> u8 {
        self.0[389]
    }
    /// `enable_creator_fee`
    pub fn enable_creator_fee(&self) -> bool {
        self.0[390] != 0
    }
    /// `creator_fees_token_0`
    pub fn creator_fees_0(&self) -> u64 {
        u64_at(self.0, 397)
    }
    /// `creator_fees_token_1`
    pub fn creator_fees_1(&self) -> u64 {
        u64_at(self.0, 405)
    }

    /// Whether the creator fee is charged on the input for this direction
    /// (`PoolState::is_creator_fee_on_input`).
    pub fn creator_fee_on_input(&self, zero_for_one: bool) -> Result<bool> {
        match (self.creator_fee_on(), zero_for_one) {
            (0, _) => Ok(true),
            (1, true) | (2, false) => Ok(true),
            (1, false) | (2, true) => Ok(false),
            _ => Err(CoreError::InvalidAccountData),
        }
    }
}

/// Fee rates read from `AmmConfig`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AmmConfigRates {
    /// `trade_fee_rate`
    pub trade_fee_rate: u64,
    /// `protocol_fee_rate`
    pub protocol_fee_rate: u64,
    /// `fund_fee_rate`
    pub fund_fee_rate: u64,
    /// `creator_fee_rate`
    pub creator_fee_rate: u64,
}

/// Reads fee rates from `AmmConfig` account data.
pub fn amm_config_rates(data: &[u8]) -> Result<AmmConfigRates> {
    if data.len() < 116 || data[..8] != AMM_CONFIG_DISCRIMINATOR {
        return Err(CoreError::InvalidAccountData);
    }
    Ok(AmmConfigRates {
        trade_fee_rate: u64_at(data, 12),
        protocol_fee_rate: u64_at(data, 20),
        fund_fee_rate: u64_at(data, 28),
        creator_fee_rate: u64_at(data, 108),
    })
}

/// Builds the [`Fees`] for a swap direction from pool + config.
pub fn swap_fees(pool: &CpmmPoolView<'_>, rates: &AmmConfigRates, zero_for_one: bool) -> Result<Fees> {
    Ok(Fees {
        trade_fee_rate: rates.trade_fee_rate,
        creator_fee_rate: if pool.enable_creator_fee() { rates.creator_fee_rate } else { 0 },
        protocol_fee_rate: rates.protocol_fee_rate,
        fund_fee_rate: rates.fund_fee_rate,
        creator_fee_on_input: pool.creator_fee_on_input(zero_for_one)?,
    })
}

/// Tradable reserves `(input, output)` for a direction, given raw vault balances.
pub fn reserves(pool: &CpmmPoolView<'_>, vault_0: u64, vault_1: u64, zero_for_one: bool) -> Result<(u64, u64)> {
    let r0 = vault_0.checked_sub(pool.owed_fees_0()).ok_or(CoreError::InvalidReserves)?;
    let r1 = vault_1.checked_sub(pool.owed_fees_1()).ok_or(CoreError::InvalidReserves)?;
    Ok(if zero_for_one { (r0, r1) } else { (r1, r0) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool_bytes() -> Vec<u8> {
        let mut d = vec![0u8; POOL_STATE_LEN];
        d[..8].copy_from_slice(&POOL_STATE_DISCRIMINATOR);
        d[40..72].copy_from_slice(&[4u8; 32]);
        d[168..200].copy_from_slice(&[1u8; 32]);
        d[200..232].copy_from_slice(&[2u8; 32]);
        d[341..349].copy_from_slice(&10u64.to_le_bytes());
        d[357..365].copy_from_slice(&5u64.to_le_bytes());
        d[397..405].copy_from_slice(&100u64.to_le_bytes());
        d[349..357].copy_from_slice(&10u64.to_le_bytes());
        d[365..373].copy_from_slice(&5u64.to_le_bytes());
        d[390] = 1;
        d
    }

    #[test]
    fn layout_len_matches_rust_source() {
        // PoolState::LEN = 8 + 10*32 + 1*5 + 8*7 + 1*2 + 6*1 + 2*8 + 8*28
        assert_eq!(POOL_STATE_LEN, 8 + 10 * 32 + 5 + 8 * 7 + 2 + 6 + 2 * 8 + 8 * 28);
    }

    #[test]
    fn reads_fields_and_reserves() {
        let d = pool_bytes();
        let v = CpmmPoolView::new(&d).unwrap();
        assert_eq!(v.pool_creator(), [4u8; 32]);
        assert_eq!(v.token_0_mint(), [1u8; 32]);
        assert_eq!(v.creator_fees_0(), 100);
        assert_eq!(reserves(&v, 1_000_000_000, 2_000_000_000, true).unwrap(), (1_000_000_000 - 115, 2_000_000_000 - 15));
        assert!(v.creator_fee_on_input(false).unwrap());
    }

    #[test]
    fn amm_config_offsets() {
        let mut d = vec![0u8; 236];
        d[..8].copy_from_slice(&AMM_CONFIG_DISCRIMINATOR);
        d[12..20].copy_from_slice(&2_500u64.to_le_bytes());
        d[20..28].copy_from_slice(&120_000u64.to_le_bytes());
        d[28..36].copy_from_slice(&40_000u64.to_le_bytes());
        d[108..116].copy_from_slice(&500u64.to_le_bytes());
        let r = amm_config_rates(&d).unwrap();
        assert_eq!((r.trade_fee_rate, r.protocol_fee_rate, r.fund_fee_rate, r.creator_fee_rate), (2_500, 120_000, 40_000, 500));
    }
}
