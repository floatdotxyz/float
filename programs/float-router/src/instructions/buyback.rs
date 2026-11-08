//! $FLOAT buyback & burn.
//!
//! Enforced on chain:
//! * trigger: ≥ `buyback_target_lamports` available, or `buyback_interval_secs` since the last buy;
//! * size: the simulated swap (exact CPMM math, current reserves) moves the
//!   price by at most `max_impact_bps`;
//! * price: output ≥ `reference · (1 − guard_bps)`;
//! * everything bought is burned in the same instruction.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TokenInterface};
use float_core::{buyback, cpmm, cpmm_state, guard};

use crate::constants::*;
use crate::errors::{CoreResultExt, RouterError};
use crate::events::BuybackBurned;
use crate::instructions::cycle::validate_swap_pool;
use crate::raydium;
use crate::state::RouterConfig;

#[derive(Accounts)]
pub struct ExecuteBuyback<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ RouterError::NotOperator,
        constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA; owns the SOL vault and the $FLOAT intake.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,

    #[account(address = WSOL_MINT)]
    pub wsol_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, address = config.flagship_mint)]
    pub float_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::FLAGSHIP], WSOL_MINT.as_ref()], bump)]
    pub sol_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = float_mint, associated_token::authority = authority,
        associated_token::token_program = float_token_program)]
    pub float_intake: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: the $FLOAT/SOL CPMM pool; validated against its data.
    #[account(mut, owner = CPMM_PROGRAM_ID)]
    pub cpmm_pool: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.amm_config`, parsed for fee rates.
    #[account(owner = CPMM_PROGRAM_ID)]
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: CPMM authority.
    #[account(address = CPMM_AUTHORITY)]
    pub cpmm_authority: UncheckedAccount<'info>,
    /// Pool's WSOL vault.
    #[account(mut)]
    pub input_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Pool's $FLOAT vault.
    #[account(mut)]
    pub output_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: compared against `PoolState.observation_key`.
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    /// CHECK: CPMM program.
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,

    pub wsol_token_program: Interface<'info, TokenInterface>,
    pub float_token_program: Interface<'info, TokenInterface>,
}

pub fn execute_buyback(ctx: Context<ExecuteBuyback>, amount_in: u64, reference_price_q64: u128) -> Result<()> {
    let a = &ctx.accounts;
    let now = Clock::get()?.unix_timestamp;
    let available = a.sol_vault.amount;
    let trig = buyback::trigger(available, a.config.last_buyback_ts, now, a.config.buyback_target_lamports, a.config.buyback_interval_secs)
        .core()?;
    require!(amount_in > 0 && amount_in <= available, RouterError::InsufficientFunds);

    let zero_for_one = validate_swap_pool(
        &a.cpmm_pool,
        &a.amm_config,
        &a.input_vault.to_account_info(),
        &a.output_vault.to_account_info(),
        &a.observation_state,
        WSOL_MINT,
        a.config.flagship_mint,
    )?;

    // Simulate with the exact CPMM math on current reserves and enforce the impact cap.
    let simulated = {
        let pool_data = a.cpmm_pool.try_borrow_data()?;
        let cfg_data = a.amm_config.try_borrow_data()?;
        let view = cpmm_state::CpmmPoolView::new(&pool_data).core()?;
        let rates = cpmm_state::amm_config_rates(&cfg_data).core()?;
        let fees = cpmm_state::swap_fees(&view, &rates, zero_for_one).core()?;
        let (v0, v1) =
            if zero_for_one { (a.input_vault.amount, a.output_vault.amount) } else { (a.output_vault.amount, a.input_vault.amount) };
        let (rin, rout) = cpmm_state::reserves(&view, v0, v1, zero_for_one).core()?;
        let r = cpmm::swap_base_input(amount_in, rin, rout, &fees).core()?;
        require!(cpmm::within_price_impact(rin, rout, &r, a.config.max_impact_bps as u64), RouterError::PriceImpactTooHigh);
        r.output_amount
    };

    let min_out = guard::min_out(guard::expected_out(amount_in, reference_price_q64).core()?, a.config.guard_bps).core()?;
    require!(simulated >= min_out, RouterError::PriceGuard);

    let before = a.float_intake.amount;
    let bump = [a.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    raydium::cpmm::swap_base_input(
        raydium::cpmm::SwapBaseInput {
            payer: &a.authority.to_account_info(),
            authority: &a.cpmm_authority.to_account_info(),
            amm_config: &a.amm_config.to_account_info(),
            pool_state: &a.cpmm_pool.to_account_info(),
            input_token_account: &a.sol_vault.to_account_info(),
            output_token_account: &a.float_intake.to_account_info(),
            input_vault: &a.input_vault.to_account_info(),
            output_vault: &a.output_vault.to_account_info(),
            input_token_program: &a.wsol_token_program.to_account_info(),
            output_token_program: &a.float_token_program.to_account_info(),
            input_token_mint: &a.wsol_mint.to_account_info(),
            output_token_mint: &a.float_mint.to_account_info(),
            observation_state: &a.observation_state.to_account_info(),
            cpmm_program: &a.cpmm_program.to_account_info(),
        },
        amount_in,
        min_out,
        seeds,
    )?;

    ctx.accounts.float_intake.reload()?;
    let bought = ctx.accounts.float_intake.amount.checked_sub(before).ok_or(RouterError::MathOverflow)?;

    let a = &ctx.accounts;
    token_interface::burn(
        CpiContext::new_with_signer(
            a.float_token_program.to_account_info(),
            Burn { mint: a.float_mint.to_account_info(), from: a.float_intake.to_account_info(), authority: a.authority.to_account_info() },
            seeds,
        ),
        bought,
    )?;

    let c = &mut ctx.accounts.config;
    c.last_buyback_ts = now;
    c.total_burned = c.total_burned.checked_add(bought).ok_or(RouterError::MathOverflow)?;
    c.total_sol_spent = c.total_sol_spent.checked_add(amount_in).ok_or(RouterError::MathOverflow)?;

    emit!(BuybackBurned {
        sol_in: amount_in,
        float_burned: bought,
        total_burned: c.total_burned,
        trigger: match trig {
            buyback::Trigger::Target => 0,
            buyback::Trigger::Interval => 1,
        },
    });
    Ok(())
}
