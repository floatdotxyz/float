use anchor_lang::prelude::*;
use anchor_lang::solana_program::pubkey;

// ------------------------------------------------------------------ seeds

/// `RouterConfig` singleton.
pub const CONFIG_SEED: &[u8] = b"config";
/// Program authority PDA. Signs every vault transfer and every Raydium CPI.
/// It must be set as the LaunchLab `platform_fee_wallet` and as the
/// `platform_cp_creator` of the platform config the router serves.
pub const AUTHORITY_SEED: &[u8] = b"authority";
/// `CoinRecord` per coin mint.
pub const COIN_SEED: &[u8] = b"coin";
/// `TickerRecord` per normalised ticker.
pub const TICKER_SEED: &[u8] = b"ticker";
/// System-owned PDA holding a coin's escrowed ticker reuse fee.
pub const TICKER_ESCROW_SEED: &[u8] = b"ticker_escrow";
/// Token vaults: `[VAULT_SEED, kind, mint]`.
pub const VAULT_SEED: &[u8] = b"vault";
/// `AirdropRound` and its escrow: `[AIRDROP_SEED, round_id_le]`, `[AIRDROP_SEED, round_id_le, b"escrow"]`.
pub const AIRDROP_SEED: &[u8] = b"airdrop";
/// Airdrop escrow suffix.
pub const ESCROW_SUFFIX: &[u8] = b"escrow";
/// `ClaimReceipt`: `[CLAIM_SEED, round_id_le, index_le]`.
pub const CLAIM_SEED: &[u8] = b"claim";

/// Vault kinds.
pub mod vault_kind {
    /// Holder rewards (paired token), accounted per coin.
    pub const HOLDERS: u8 = 0;
    /// Flagship share, converted to SOL for $FLOAT buybacks.
    pub const FLAGSHIP: u8 = 1;
    /// Traders share, converted to USDC for airdrops.
    pub const TRADERS: u8 = 2;
}

// --------------------------------------------------------- external programs

/// Raydium LaunchLab.
pub const LAUNCHLAB_PROGRAM_ID: Pubkey = pubkey!("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");
/// LaunchLab vault authority (`["vault_auth_seed"]`).
pub const LAUNCHLAB_AUTHORITY: Pubkey = pubkey!("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh");
/// Raydium CPMM.
pub const CPMM_PROGRAM_ID: Pubkey = pubkey!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");
/// CPMM vault & LP authority (`["vault_and_lp_mint_auth_seed"]`).
pub const CPMM_AUTHORITY: Pubkey = pubkey!("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL");
/// Wrapped SOL mint.
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
/// USDC mint.
pub const USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// ------------------------------------------------------- CPI discriminators

/// LaunchLab `claim_platform_fee`.
pub const IX_LAUNCHLAB_CLAIM_PLATFORM_FEE: [u8; 8] = [156, 39, 208, 135, 76, 237, 61, 72];
/// CPMM `collect_creator_fee`.
pub const IX_CPMM_COLLECT_CREATOR_FEE: [u8; 8] = [20, 22, 86, 123, 198, 28, 219, 132];
/// CPMM `swap_base_input`.
pub const IX_CPMM_SWAP_BASE_INPUT: [u8; 8] = [143, 190, 90, 218, 196, 30, 51, 222];

// ---------------------------------------------------------------- limits

/// Maximum holder transfers per `payout_holders` call (fits a v0 transaction with an ALT).
pub const MAX_PAYOUTS_PER_IX: usize = 20;
/// Maximum merkle proof depth (2^24 claims).
pub const MAX_PROOF_LEN: usize = 24;
