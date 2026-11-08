//! # float-router
//!
//! Community reference implementation of a Float-style fee router on Solana.
//! It is **not** the program deployed by the Float team (whose source is not
//! public). It implements the mechanics described in Float's documentation
//! on top of the real Raydium programs, with every rule enforced on chain:
//!
//! | Area | Instructions |
//! | --- | --- |
//! | Admin | `initialize`, `update_config`, `set_paused`, `propose_admin`, `accept_admin` |
//! | Setup | `init_mint_vaults` |
//! | Coins & tickers | `register_coin`, `mark_graduated`, `settle_ticker_fee` |
//! | Fee cycling | `cycle_launchlab`, `cycle_cpmm`, `swap_base_fees` |
//! | Conversions | `convert_vault` |
//! | Flagship | `execute_buyback` |
//! | Holders | `payout_holders` |
//! | Traders | `create_airdrop`, `claim_airdrop`, `close_airdrop` |
//!
//! Pure rules and math live in the `float-core` crate and are unit-tested on
//! the host.

#![allow(unexpected_cfgs)]
#![allow(clippy::result_large_err)]
#![allow(clippy::too_many_arguments)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod raydium;
pub mod route;
pub mod state;

pub use instructions::*;

declare_id!("AYBmMVxnWC2o5JGPZm8xo4nrh7fAmxLfrxC3e2RaKomt");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "float-router (community reference implementation)",
    project_url: "https://github.com/float-community/float-community",
    contacts: "link:https://github.com/float-community/float-community/security/advisories/new",
    policy: "https://github.com/float-community/float-community/blob/main/SECURITY.md",
    source_code: "https://github.com/float-community/float-community/tree/main/programs/float-router"
}

#[program]
pub mod float_router {
    use super::*;

    // ------------------------------------------------------------ admin

    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::admin::initialize(ctx, params)
    }

    pub fn update_config(ctx: Context<AdminOnly>, params: UpdateConfigParams) -> Result<()> {
        instructions::admin::update_config(ctx, params)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    // ------------------------------------------------------------ setup

    pub fn init_mint_vaults(ctx: Context<InitMintVaults>) -> Result<()> {
        instructions::vaults::init_mint_vaults(ctx)
    }

    // ------------------------------------------------- coins & tickers

    pub fn register_coin(ctx: Context<RegisterCoin>, ticker: String, creator_wallet: Pubkey) -> Result<()> {
        instructions::coin::register_coin(ctx, ticker, creator_wallet)
    }

    pub fn mark_graduated(ctx: Context<MarkGraduated>) -> Result<()> {
        instructions::coin::mark_graduated(ctx)
    }

    pub fn settle_ticker_fee(ctx: Context<SettleTickerFee>) -> Result<()> {
        instructions::coin::settle_ticker_fee(ctx)
    }

    // ----------------------------------------------------- fee cycling

    pub fn cycle_launchlab(ctx: Context<CycleLaunchLab>) -> Result<()> {
        instructions::cycle::cycle_launchlab(ctx)
    }

    pub fn cycle_cpmm(ctx: Context<CycleCpmm>) -> Result<()> {
        instructions::cycle::cycle_cpmm(ctx)
    }

    pub fn swap_base_fees(ctx: Context<SwapBaseFees>, amount_in: u64, reference_price_q64: u128) -> Result<()> {
        instructions::cycle::swap_base_fees(ctx, amount_in, reference_price_q64)
    }

    // ----------------------------------------------------- conversions

    pub fn convert_vault(ctx: Context<ConvertVault>, kind: u8, amount_in: u64, reference_price_q64: u128) -> Result<()> {
        instructions::convert::convert_vault(ctx, kind, amount_in, reference_price_q64)
    }

    // -------------------------------------------------------- flagship

    pub fn execute_buyback(ctx: Context<ExecuteBuyback>, amount_in: u64, reference_price_q64: u128) -> Result<()> {
        instructions::buyback::execute_buyback(ctx, amount_in, reference_price_q64)
    }

    // --------------------------------------------------------- holders

    pub fn payout_holders<'info>(ctx: Context<'_, '_, 'info, 'info, PayoutHolders<'info>>, round: u64, amounts: Vec<u64>) -> Result<()> {
        instructions::payouts::payout_holders(ctx, round, amounts)
    }

    // --------------------------------------------------------- traders

    pub fn create_airdrop(ctx: Context<CreateAirdrop>, round_id: u64, root: [u8; 32], total: u64, expires_at: i64) -> Result<()> {
        instructions::airdrop::create_airdrop(ctx, round_id, root, total, expires_at)
    }

    pub fn claim_airdrop(ctx: Context<ClaimAirdrop>, round_id: u64, index: u64, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        instructions::airdrop::claim_airdrop(ctx, round_id, index, amount, proof)
    }

    pub fn close_airdrop(ctx: Context<CloseAirdrop>, round_id: u64) -> Result<()> {
        instructions::airdrop::close_airdrop(ctx, round_id)
    }
}
