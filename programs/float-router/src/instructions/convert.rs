//! Guarded vault conversions: flagship → WSOL, traders → USDC.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use float_core::guard;

use crate::constants::*;
use crate::errors::{CoreResultExt, RouterError};
use crate::events::VaultConverted;
use crate::instructions::cycle::validate_swap_pool;
use crate::raydium;
use crate::state::RouterConfig;

#[derive(Accounts)]
#[instruction(kind: u8)]
pub struct ConvertVault<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ RouterError::NotOperator,
        constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA; owner of both vaults.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    pub source_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(constraint = (kind == vault_kind::FLAGSHIP && target_mint.key() == WSOL_MINT)
        || (kind == vault_kind::TRADERS && target_mint.key() == USDC_MINT) @ RouterError::InvalidConversionTarget)]
    pub target_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, &[kind], source_mint.key().as_ref()], bump)]
    pub source_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[kind], target_mint.key().as_ref()], bump)]
    pub target_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated against its data.
    #[account(mut, owner = CPMM_PROGRAM_ID)]
    pub cpmm_pool: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.amm_config`.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: CPMM authority.
    #[account(address = CPMM_AUTHORITY)]
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: pool vault for `source_mint`.
    #[account(mut)]
    pub input_vault: UncheckedAccount<'info>,
    /// CHECK: pool vault for `target_mint`.
    #[account(mut)]
    pub output_vault: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.observation_key`.
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    /// CHECK: CPMM program.
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,

    pub source_token_program: Interface<'info, TokenInterface>,
    pub target_token_program: Interface<'info, TokenInterface>,
}

/// Swaps `amount_in` from `vault[kind][source]` to `vault[kind][target]`.
/// `reference_price_q64` is target-per-source in Q64.64; the swap reverts if
/// it returns less than `reference · (1 − guard_bps)`.
pub fn convert_vault(ctx: Context<ConvertVault>, kind: u8, amount_in: u64, reference_price_q64: u128) -> Result<()> {
    let a = &ctx.accounts;
    require!(kind == vault_kind::FLAGSHIP || kind == vault_kind::TRADERS, RouterError::InvalidConversionTarget);
    require!(a.source_mint.key() != a.target_mint.key(), RouterError::InvalidConversionTarget);
    require!(amount_in > 0 && amount_in <= a.source_vault.amount, RouterError::InsufficientFunds);
    validate_swap_pool(
        &a.cpmm_pool,
        &a.amm_config,
        &a.input_vault,
        &a.output_vault,
        &a.observation_state,
        a.source_mint.key(),
        a.target_mint.key(),
    )?;

    let min_out = guard::min_out(guard::expected_out(amount_in, reference_price_q64).core()?, a.config.guard_bps).core()?;
    let before = a.target_vault.amount;
    let bump = [a.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    raydium::cpmm::swap_base_input(
        raydium::cpmm::SwapBaseInput {
            payer: &a.authority.to_account_info(),
            authority: &a.cpmm_authority.to_account_info(),
            amm_config: &a.amm_config.to_account_info(),
            pool_state: &a.cpmm_pool.to_account_info(),
            input_token_account: &a.source_vault.to_account_info(),
            output_token_account: &a.target_vault.to_account_info(),
            input_vault: &a.input_vault.to_account_info(),
            output_vault: &a.output_vault.to_account_info(),
            input_token_program: &a.source_token_program.to_account_info(),
            output_token_program: &a.target_token_program.to_account_info(),
            input_token_mint: &a.source_mint.to_account_info(),
            output_token_mint: &a.target_mint.to_account_info(),
            observation_state: &a.observation_state.to_account_info(),
            cpmm_program: &a.cpmm_program.to_account_info(),
        },
        amount_in,
        min_out,
        seeds,
    )?;

    ctx.accounts.target_vault.reload()?;
    let a = &ctx.accounts;
    let out = a.target_vault.amount.checked_sub(before).ok_or(RouterError::MathOverflow)?;
    guard::check(out, amount_in, reference_price_q64, a.config.guard_bps).core()?;

    emit!(VaultConverted { kind, from_mint: a.source_mint.key(), to_mint: a.target_mint.key(), amount_in, amount_out: out });
    Ok(())
}
