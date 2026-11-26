//! Account state.
//!
//! Field order and types are mirrored in `packages/sdk/idl/float_router.json`,
//! which `scripts/dev/gen-router-idl.ts` generates from this file. Changing a
//! layout here changes the on-chain format: regenerate the IDL and never
//! reorder or resize fields of an account that already exists on chain. Grow
//! by consuming `_reserved` bytes or by adding a new PDA instead.

use anchor_lang::prelude::*;
use float_core::split::SplitBps;

/// Five-way fee split in basis points. Must sum to 10 000
/// (checked by `float_core::split::SplitBps::validate`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, PartialEq, Eq, InitSpace)]
pub struct SplitConfig {
    /// Holder rewards, paid pro rata in the paired token.
    pub holders: u16,
    /// Creator wallet.
    pub creator: u16,
    /// Flagship share: converted to SOL for $FLOAT buyback and burn.
    pub flagship: u16,
    /// Traders share: converted to USDC for airdrops.
    pub traders: u16,
    /// Treasury. Also receives the split's rounding dust.
    pub treasury: u16,
}

impl From<SplitConfig> for SplitBps {
    fn from(s: SplitConfig) -> Self {
        SplitBps { holders: s.holders, creator: s.creator, flagship: s.flagship, traders: s.traders, treasury: s.treasury }
    }
}

impl From<SplitBps> for SplitConfig {
    fn from(s: SplitBps) -> Self {
        SplitConfig { holders: s.holders, creator: s.creator, flagship: s.flagship, traders: s.traders, treasury: s.treasury }
    }
}

/// Router singleton, seeds `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct RouterConfig {
    /// Can change parameters and pause the router.
    pub admin: Pubkey,
    /// Proposed admin; must call `accept_admin`. `Pubkey::default()` when none.
    pub pending_admin: Pubkey,
    /// Keeper / payout bot allowed to run priced or data-dependent instructions.
    pub operator: Pubkey,
    /// Owner of the treasury token accounts and of released ticker fees.
    pub treasury: Pubkey,
    /// $FLOAT mint, bought back and burned with the flagship share.
    pub flagship_mint: Pubkey,
    /// LaunchLab platform config whose coins this router serves.
    pub launchlab_platform_config: Pubkey,
    /// Fee split applied by every cycle.
    pub split: SplitConfig,
    /// Reference-price guard for operator swaps, in bps.
    pub guard_bps: u16,
    /// Maximum price impact of a buyback, in bps.
    pub max_impact_bps: u16,
    /// Buyback trigger: SOL balance (lamports) that makes a buyback due.
    pub buyback_target_lamports: u64,
    /// Buyback trigger: seconds since the last buyback that make one due.
    pub buyback_interval_secs: i64,
    /// Unix time of the last buyback.
    pub last_buyback_ts: i64,
    /// Lifetime $FLOAT burned, in base units.
    pub total_burned: u64,
    /// Lifetime SOL spent on buybacks, in lamports.
    pub total_sol_spent: u64,
    /// Number of coins registered.
    pub coins_registered: u64,
    /// Number of `payout_holders` batches executed.
    pub payout_rounds: u64,
    /// When true, state-changing instructions other than admin ones fail.
    pub paused: bool,
    /// Bump of this account.
    pub bump: u8,
    /// Bump of the authority PDA (`["authority"]`).
    pub authority_bump: u8,
    /// Reserved for future fields.
    pub _reserved: [u8; 64],
}

impl RouterConfig {
    /// The configured split as `float-core` shares.
    pub fn split_bps(&self) -> SplitBps {
        SplitBps::from(self.split)
    }
}

/// One per registered coin, seeds `["coin", mint]`.
#[account]
#[derive(InitSpace)]
pub struct CoinRecord {
    /// Coin (LaunchLab base) mint.
    pub mint: Pubkey,
    /// Paired (LaunchLab quote) mint; every split amount is in this token.
    pub paired_mint: Pubkey,
    /// LaunchLab pool PDA of (mint, paired_mint).
    pub launchlab_pool: Pubkey,
    /// Pool creator who registered the coin; receives the ticker fee refund.
    pub launcher: Pubkey,
    /// Receives the creator share.
    pub creator_wallet: Pubkey,
    /// Normalised ticker, left-aligned and zero-padded.
    pub ticker: [u8; 10],
    /// Number of meaningful bytes in `ticker`.
    pub ticker_len: u8,
    /// Unix time of registration.
    pub launched_at: i64,
    /// Unix time `mark_graduated` was called; 0 while on the bonding curve.
    pub graduated_at: i64,
    /// Ticker reuse fee escrowed at registration, in lamports.
    pub reuse_fee: u64,
    /// True once the reuse fee has been refunded or released (or was 0).
    pub reuse_fee_settled: bool,
    /// Lifetime amount routed through the split.
    pub total_cycled: u64,
    /// Lifetime holders share.
    pub total_holders: u64,
    /// Lifetime creator share.
    pub total_creator: u64,
    /// Lifetime flagship share.
    pub total_flagship: u64,
    /// Lifetime traders share.
    pub total_traders: u64,
    /// Lifetime treasury share.
    pub total_treasury: u64,
    /// Holder rewards accrued in the holders vault and not yet paid out.
    pub holders_unpaid: u64,
    /// Coin-side CPMM creator fees held by the authority, awaiting `swap_base_fees`.
    pub pending_base_fees: u64,
    /// Bump of this account.
    pub bump: u8,
    /// Reserved for future fields.
    pub _reserved: [u8; 32],
}

impl CoinRecord {
    /// The normalised ticker bytes (without padding).
    pub fn ticker_bytes(&self) -> &[u8] {
        &self.ticker[..(self.ticker_len as usize).min(self.ticker.len())]
    }
}

/// Launch counter per normalised ticker, seeds `["ticker", TICKER]`.
#[account]
#[derive(InitSpace)]
pub struct TickerRecord {
    /// Normalised ticker, left-aligned and zero-padded.
    pub ticker: [u8; 10],
    /// Number of meaningful bytes in `ticker`.
    pub ticker_len: u8,
    /// Number of coins registered with this ticker.
    pub launches: u32,
    /// First coin registered with this ticker.
    pub first_mint: Pubkey,
    /// Bump of this account.
    pub bump: u8,
}

impl TickerRecord {
    /// The normalised ticker bytes (without padding).
    pub fn ticker_bytes(&self) -> &[u8] {
        &self.ticker[..(self.ticker_len as usize).min(self.ticker.len())]
    }
}

/// Merkle airdrop round, seeds `["airdrop", round_id_le]`.
#[account]
#[derive(InitSpace)]
pub struct AirdropRound {
    /// Round number.
    pub round_id: u64,
    /// Merkle root of `(index, wallet, amount)` leaves.
    pub root: [u8; 32],
    /// Mint paid out (USDC).
    pub mint: Pubkey,
    /// Amount escrowed for the round.
    pub total: u64,
    /// Amount claimed so far; never exceeds `total`.
    pub claimed: u64,
    /// Number of claims so far.
    pub claims: u32,
    /// Unix time the round was created.
    pub created_at: i64,
    /// Unix time after which the round can be closed.
    pub expires_at: i64,
    /// True once unclaimed funds have been returned.
    pub closed: bool,
    /// Bump of this account.
    pub bump: u8,
    /// Bump of the round escrow token account.
    pub escrow_bump: u8,
}

/// Proof that a leaf was claimed, seeds `["claim", round_id_le, index_le]`.
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    /// Round number.
    pub round_id: u64,
    /// Leaf index.
    pub index: u64,
    /// Wallet paid.
    pub wallet: Pubkey,
    /// Amount paid.
    pub amount: u64,
    /// Unix time of the claim.
    pub claimed_at: i64,
}
