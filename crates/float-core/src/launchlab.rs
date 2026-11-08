//! Zero-copy reads of Raydium LaunchLab `PoolState`.
//!
//! Offsets follow the field order of `PoolState` in the LaunchLab IDL
//! (`packages/sdk/idl/raydium_launchpad.json`), after the 8-byte Anchor
//! discriminator:
//!
//! ```text
//!   0  discriminator   [u8; 8]
//!   8  epoch           u64
//!  16  auth_bump       u8
//!  17  status          u8      0 funding · 1 migrate · 2 migrated
//!  18  base_decimals   u8
//!  19  quote_decimals  u8
//!  20  migrate_type    u8      0 AMM v4 · 1 CPMM
//!  21  supply          u64
//!  29  total_base_sell u64
//!  37  virtual_base    u64
//!  45  virtual_quote   u64
//!  53  real_base       u64
//!  61  real_quote      u64
//!  69  total_quote_fund_raising u64
//!  77  quote_protocol_fee u64
//!  85  platform_fee    u64
//!  93  migrate_fee     u64
//! 101  vesting_schedule (5 × u64 = 40)
//! 141  global_config   Pubkey
//! 173  platform_config Pubkey
//! 205  base_mint       Pubkey
//! 237  quote_mint      Pubkey
//! 269  base_vault      Pubkey
//! 301  quote_vault     Pubkey
//! 333  creator         Pubkey
//! ```

use crate::error::{CoreError, Result};

/// `sha256("account:PoolState")[..8]`.
pub const POOL_STATE_DISCRIMINATOR: [u8; 8] = [247, 237, 227, 245, 215, 195, 222, 70];

/// Byte offsets of the fields the router reads.
pub mod offsets {
    /// `status`
    pub const STATUS: usize = 17;
    /// `migrate_type`
    pub const MIGRATE_TYPE: usize = 20;
    /// `real_quote`
    pub const REAL_QUOTE: usize = 61;
    /// `total_quote_fund_raising`
    pub const TOTAL_QUOTE_FUND_RAISING: usize = 69;
    /// `platform_fee`
    pub const PLATFORM_FEE: usize = 85;
    /// `platform_config`
    pub const PLATFORM_CONFIG: usize = 173;
    /// `base_mint`
    pub const BASE_MINT: usize = 205;
    /// `quote_mint`
    pub const QUOTE_MINT: usize = 237;
    /// `quote_vault`
    pub const QUOTE_VAULT: usize = 301;
    /// `creator`
    pub const CREATOR: usize = 333;
    /// End of `creator`.
    pub const MIN_LEN: usize = 365;
}

/// Pool status values.
pub mod status {
    /// Curve still selling.
    pub const FUND: u8 = 0;
    /// Curve sold out, waiting for migration.
    pub const MIGRATE: u8 = 1;
    /// Migrated to an AMM.
    pub const TRADE: u8 = 2;
}

/// Borrowed view over LaunchLab `PoolState` account data.
#[derive(Clone, Copy)]
pub struct PoolView<'a>(&'a [u8]);

impl<'a> PoolView<'a> {
    /// Validates length and discriminator.
    pub fn new(data: &'a [u8]) -> Result<Self> {
        if data.len() < offsets::MIN_LEN || data[..8] != POOL_STATE_DISCRIMINATOR {
            return Err(CoreError::InvalidAccountData);
        }
        Ok(Self(data))
    }

    fn u64_at(&self, o: usize) -> u64 {
        let mut b = [0u8; 8];
        b.copy_from_slice(&self.0[o..o + 8]);
        u64::from_le_bytes(b)
    }

    fn key_at(&self, o: usize) -> [u8; 32] {
        let mut b = [0u8; 32];
        b.copy_from_slice(&self.0[o..o + 32]);
        b
    }

    /// `status`
    pub fn status(&self) -> u8 {
        self.0[offsets::STATUS]
    }
    /// `migrate_type`
    pub fn migrate_type(&self) -> u8 {
        self.0[offsets::MIGRATE_TYPE]
    }
    /// `real_quote`
    pub fn real_quote(&self) -> u64 {
        self.u64_at(offsets::REAL_QUOTE)
    }
    /// `total_quote_fund_raising`
    pub fn total_quote_fund_raising(&self) -> u64 {
        self.u64_at(offsets::TOTAL_QUOTE_FUND_RAISING)
    }
    /// `platform_fee`
    pub fn platform_fee(&self) -> u64 {
        self.u64_at(offsets::PLATFORM_FEE)
    }
    /// `platform_config`
    pub fn platform_config(&self) -> [u8; 32] {
        self.key_at(offsets::PLATFORM_CONFIG)
    }
    /// `base_mint`
    pub fn base_mint(&self) -> [u8; 32] {
        self.key_at(offsets::BASE_MINT)
    }
    /// `quote_mint`
    pub fn quote_mint(&self) -> [u8; 32] {
        self.key_at(offsets::QUOTE_MINT)
    }
    /// `quote_vault`
    pub fn quote_vault(&self) -> [u8; 32] {
        self.key_at(offsets::QUOTE_VAULT)
    }
    /// `creator`
    pub fn creator(&self) -> [u8; 32] {
        self.key_at(offsets::CREATOR)
    }
    /// True once the pool has migrated.
    pub fn is_graduated(&self) -> bool {
        self.status() == status::TRADE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_fields_at_idl_offsets() {
        let mut d = vec![0u8; 421];
        d[..8].copy_from_slice(&POOL_STATE_DISCRIMINATOR);
        d[offsets::STATUS] = status::TRADE;
        d[offsets::MIGRATE_TYPE] = 1;
        d[offsets::PLATFORM_FEE..offsets::PLATFORM_FEE + 8].copy_from_slice(&42u64.to_le_bytes());
        d[offsets::BASE_MINT..offsets::BASE_MINT + 32].copy_from_slice(&[7u8; 32]);
        d[offsets::CREATOR..offsets::CREATOR + 32].copy_from_slice(&[9u8; 32]);
        let v = PoolView::new(&d).unwrap();
        assert!(v.is_graduated());
        assert_eq!(v.migrate_type(), 1);
        assert_eq!(v.platform_fee(), 42);
        assert_eq!(v.base_mint(), [7u8; 32]);
        assert_eq!(v.creator(), [9u8; 32]);
    }

    #[test]
    fn rejects_wrong_discriminator() {
        assert!(PoolView::new(&[0u8; 421]).is_err());
    }

    #[test]
    fn offsets_follow_field_sizes() {
        use offsets::*;
        assert_eq!(PLATFORM_CONFIG, 8 + 8 + 5 + 10 * 8 + 40 + 32);
        assert_eq!(CREATOR, PLATFORM_CONFIG + 5 * 32);
    }
}
