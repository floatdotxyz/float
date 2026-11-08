//! Fee cycling: claim a coin's fees from Raydium and route them through the split.
//!
//! * `cycle_launchlab` — platform fee earned on the bonding curve.
//! * `cycle_cpmm`      — creator fee earned by the graduated CPMM pool.
//! * `swap_base_fees`  — converts coin-side CPMM fees to the paired token (operator, guarded).
//!
//! Every claim measures the intake balance before and after the CPI, so each
//! routed amount is attributable to exactly one coin.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use float_core::cpmm_state::CpmmPoolView;
use float_core::guard;
use float_core::launchlab::PoolView;

use crate::constants::*;
use crate::errors::{CoreResultExt, RouterError};
use crate::raydium;
use crate::route::{route_fees, RouteAccounts};
use crate::state::{CoinRecord, RouterConfig};

pub const SOURCE_LAUNCHLAB: u8 = 0;
pub const SOURCE_CPMM: u8 = 1;
pub const SOURCE_BASE_SWAP: u8 = 2;

// ---------------------------------------------------------- cycle_launchlab

#[derive(Accounts)]
pub struct CycleLaunchLab<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA; signs the LaunchLab claim as `platform_fee_wallet`.
    #[account(mut, seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [COIN_SEED, coin_record.mint.as_ref()], bump = coin_record.bump)]
    pub coin_record: Box<Account<'info, CoinRecord>>,

    /// CHECK: pinned to the coin's LaunchLab pool.
    #[account(mut, address = coin_record.launchlab_pool, owner = LAUNCHLAB_PROGRAM_ID)]
    pub launchlab_pool: UncheckedAccount<'info>,
    /// CHECK: pinned to the router's LaunchLab platform config.
    #[account(address = config.launchlab_platform_config)]
    pub launchlab_platform_config: UncheckedAccount<'info>,
    /// CHECK: LaunchLab vault authority.
    #[account(address = LAUNCHLAB_AUTHORITY)]
    pub launchlab_authority: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.quote_vault` in the handler.
    #[account(mut)]
    pub pool_quote_vault: UncheckedAccount<'info>,
    /// CHECK: LaunchLab program.
    #[account(address = LAUNCHLAB_PROGRAM_ID)]
    pub launchlab_program: UncheckedAccount<'info>,

    #[account(address = coin_record.paired_mint)]
    pub paired_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = paired_mint, associated_token::authority = authority,
        associated_token::token_program = token_program)]
    pub intake: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::HOLDERS], paired_mint.key().as_ref()], bump)]
    pub holders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::FLAGSHIP], paired_mint.key().as_ref()], bump)]
    pub flagship_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::TRADERS], paired_mint.key().as_ref()], bump)]
    pub traders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = paired_mint, token::authority = coin_record.creator_wallet)]
    pub creator_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = paired_mint, token::authority = config.treasury)]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    /// LaunchLab only supports the classic SPL Token program for the quote side.
    #[account(address = anchor_spl::token::ID)]
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn cycle_launchlab(ctx: Context<CycleLaunchLab>) -> Result<()> {
    {
        let data = ctx.accounts.launchlab_pool.try_borrow_data()?;
        let pool = PoolView::new(&data).core()?;
        require_keys_eq!(
            Pubkey::new_from_array(pool.quote_vault()),
            ctx.accounts.pool_quote_vault.key(),
            RouterError::InvalidLaunchLabPool
        );
        require!(pool.platform_fee() > 0, RouterError::NoFees);
    }

    let a = &ctx.accounts;
    let before = a.intake.amount;
    let bump = [a.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    raydium::launchlab::claim_platform_fee(
        raydium::launchlab::ClaimPlatformFee {
            platform_fee_wallet: &a.authority.to_account_info(),
            authority: &a.launchlab_authority.to_account_info(),
            pool_state: &a.launchlab_pool.to_account_info(),
            platform_config: &a.launchlab_platform_config.to_account_info(),
            quote_vault: &a.pool_quote_vault.to_account_info(),
            recipient_token_account: &a.intake.to_account_info(),
            quote_mint: &a.paired_mint.to_account_info(),
            token_program: &a.token_program.to_account_info(),
            system_program: &a.system_program.to_account_info(),
            associated_token_program: &a.associated_token_program.to_account_info(),
            launchlab_program: &a.launchlab_program.to_account_info(),
        },
        seeds,
    )?;

    ctx.accounts.intake.reload()?;
    let claimed = ctx.accounts.intake.amount.checked_sub(before).ok_or(RouterError::MathOverflow)?;
    require!(claimed > 0, RouterError::NoFees);

    let a = &mut ctx.accounts;
    let decimals = a.paired_mint.decimals;
    let mint = a.coin_record.mint;
    route_fees(
        RouteAccounts {
            intake: &a.intake.to_account_info(),
            paired_mint: &a.paired_mint.to_account_info(),
            authority: &a.authority.to_account_info(),
            holders_vault: &a.holders_vault.to_account_info(),
            flagship_vault: &a.flagship_vault.to_account_info(),
            traders_vault: &a.traders_vault.to_account_info(),
            creator_token: &a.creator_token.to_account_info(),
            treasury_token: &a.treasury_token.to_account_info(),
            token_program: &a.token_program.to_account_info(),
        },
        &a.config,
        &mut a.coin_record,
        mint,
        claimed,
        decimals,
        SOURCE_LAUNCHLAB,
    )?;
    Ok(())
}

// --------------------------------------------------------------- cycle_cpmm

#[derive(Accounts)]
pub struct CycleCpmm<'info> {
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA; signs as the CPMM pool creator.
    #[account(mut, seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [COIN_SEED, coin_record.mint.as_ref()], bump = coin_record.bump,
        constraint = coin_record.graduated_at != 0 @ RouterError::NotGraduated)]
    pub coin_record: Box<Account<'info, CoinRecord>>,

    /// CHECK: validated against its data in the handler.
    #[account(mut, owner = CPMM_PROGRAM_ID)]
    pub cpmm_pool: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.amm_config`.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: CPMM vault & LP authority.
    #[account(address = CPMM_AUTHORITY)]
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.token_0_vault`.
    #[account(mut)]
    pub token_0_vault: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.token_1_vault`.
    #[account(mut)]
    pub token_1_vault: UncheckedAccount<'info>,
    pub vault_0_mint: Box<InterfaceAccount<'info, Mint>>,
    pub vault_1_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = vault_0_mint, associated_token::authority = authority,
        associated_token::token_program = token_0_program)]
    pub authority_token_0: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = vault_1_mint, associated_token::authority = authority,
        associated_token::token_program = token_1_program)]
    pub authority_token_1: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_0_program: Interface<'info, TokenInterface>,
    pub token_1_program: Interface<'info, TokenInterface>,
    /// CHECK: CPMM program.
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,

    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::HOLDERS], coin_record.paired_mint.as_ref()], bump)]
    pub holders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::FLAGSHIP], coin_record.paired_mint.as_ref()], bump)]
    pub flagship_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::TRADERS], coin_record.paired_mint.as_ref()], bump)]
    pub traders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = coin_record.paired_mint, token::authority = coin_record.creator_wallet)]
    pub creator_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = coin_record.paired_mint, token::authority = config.treasury)]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn cycle_cpmm(ctx: Context<CycleCpmm>) -> Result<()> {
    let a = &ctx.accounts;
    let coin = a.coin_record.mint;
    let paired = a.coin_record.paired_mint;
    let paired_is_0;
    {
        let data = a.cpmm_pool.try_borrow_data()?;
        let p = CpmmPoolView::new(&data).core()?;
        require_keys_eq!(Pubkey::new_from_array(p.pool_creator()), a.authority.key(), RouterError::WrongPoolCreator);
        require_keys_eq!(Pubkey::new_from_array(p.amm_config()), a.amm_config.key(), RouterError::InvalidCpmmPool);
        require_keys_eq!(Pubkey::new_from_array(p.token_0_vault()), a.token_0_vault.key(), RouterError::InvalidCpmmPool);
        require_keys_eq!(Pubkey::new_from_array(p.token_1_vault()), a.token_1_vault.key(), RouterError::InvalidCpmmPool);
        let (m0, m1) = (Pubkey::new_from_array(p.token_0_mint()), Pubkey::new_from_array(p.token_1_mint()));
        require_keys_eq!(m0, a.vault_0_mint.key(), RouterError::InvalidCpmmPool);
        require_keys_eq!(m1, a.vault_1_mint.key(), RouterError::InvalidCpmmPool);
        paired_is_0 = m0 == paired && m1 == coin;
        require!(paired_is_0 || (m0 == coin && m1 == paired), RouterError::InvalidCpmmPool);
        require!(p.creator_fees_0() > 0 || p.creator_fees_1() > 0, RouterError::NoFees);
    }

    let (b0, b1) = (a.authority_token_0.amount, a.authority_token_1.amount);
    let bump = [a.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    raydium::cpmm::collect_creator_fee(
        raydium::cpmm::CollectCreatorFee {
            creator: &a.authority.to_account_info(),
            authority: &a.cpmm_authority.to_account_info(),
            pool_state: &a.cpmm_pool.to_account_info(),
            amm_config: &a.amm_config.to_account_info(),
            token_0_vault: &a.token_0_vault.to_account_info(),
            token_1_vault: &a.token_1_vault.to_account_info(),
            vault_0_mint: &a.vault_0_mint.to_account_info(),
            vault_1_mint: &a.vault_1_mint.to_account_info(),
            creator_token_0: &a.authority_token_0.to_account_info(),
            creator_token_1: &a.authority_token_1.to_account_info(),
            token_0_program: &a.token_0_program.to_account_info(),
            token_1_program: &a.token_1_program.to_account_info(),
            associated_token_program: &a.associated_token_program.to_account_info(),
            system_program: &a.system_program.to_account_info(),
            cpmm_program: &a.cpmm_program.to_account_info(),
        },
        seeds,
    )?;

    ctx.accounts.authority_token_0.reload()?;
    ctx.accounts.authority_token_1.reload()?;
    let a = &mut ctx.accounts;
    let d0 = a.authority_token_0.amount.checked_sub(b0).ok_or(RouterError::MathOverflow)?;
    let d1 = a.authority_token_1.amount.checked_sub(b1).ok_or(RouterError::MathOverflow)?;
    let (paired_delta, base_delta) = if paired_is_0 { (d0, d1) } else { (d1, d0) };

    a.coin_record.pending_base_fees = a.coin_record.pending_base_fees.checked_add(base_delta).ok_or(RouterError::MathOverflow)?;
    if paired_delta == 0 {
        return Ok(());
    }

    let (intake, paired_mint, paired_program) = if paired_is_0 {
        (a.authority_token_0.to_account_info(), a.vault_0_mint.to_account_info(), a.token_0_program.to_account_info())
    } else {
        (a.authority_token_1.to_account_info(), a.vault_1_mint.to_account_info(), a.token_1_program.to_account_info())
    };
    let decimals = if paired_is_0 { a.vault_0_mint.decimals } else { a.vault_1_mint.decimals };
    route_fees(
        RouteAccounts {
            intake: &intake,
            paired_mint: &paired_mint,
            authority: &a.authority.to_account_info(),
            holders_vault: &a.holders_vault.to_account_info(),
            flagship_vault: &a.flagship_vault.to_account_info(),
            traders_vault: &a.traders_vault.to_account_info(),
            creator_token: &a.creator_token.to_account_info(),
            treasury_token: &a.treasury_token.to_account_info(),
            token_program: &paired_program,
        },
        &a.config,
        &mut a.coin_record,
        coin,
        paired_delta,
        decimals,
        SOURCE_CPMM,
    )?;
    Ok(())
}

// ----------------------------------------------------------- swap_base_fees

#[derive(Accounts)]
pub struct SwapBaseFees<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ RouterError::NotOperator,
        constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA; owner of both token accounts.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [COIN_SEED, coin_record.mint.as_ref()], bump = coin_record.bump)]
    pub coin_record: Box<Account<'info, CoinRecord>>,

    #[account(address = coin_record.mint)]
    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = coin_record.paired_mint)]
    pub paired_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, associated_token::mint = coin_mint, associated_token::authority = authority,
        associated_token::token_program = coin_token_program)]
    pub coin_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = paired_mint, associated_token::authority = authority,
        associated_token::token_program = paired_token_program)]
    pub intake: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: validated against its data in the handler.
    #[account(mut, owner = CPMM_PROGRAM_ID)]
    pub cpmm_pool: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.amm_config`.
    pub amm_config: UncheckedAccount<'info>,
    /// CHECK: CPMM authority.
    #[account(address = CPMM_AUTHORITY)]
    pub cpmm_authority: UncheckedAccount<'info>,
    /// CHECK: pool vault of the coin; checked in handler.
    #[account(mut)]
    pub input_vault: UncheckedAccount<'info>,
    /// CHECK: pool vault of the paired token; checked in handler.
    #[account(mut)]
    pub output_vault: UncheckedAccount<'info>,
    /// CHECK: compared against `PoolState.observation_key`.
    #[account(mut)]
    pub observation_state: UncheckedAccount<'info>,
    /// CHECK: CPMM program.
    #[account(address = CPMM_PROGRAM_ID)]
    pub cpmm_program: UncheckedAccount<'info>,

    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::HOLDERS], paired_mint.key().as_ref()], bump)]
    pub holders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::FLAGSHIP], paired_mint.key().as_ref()], bump)]
    pub flagship_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::TRADERS], paired_mint.key().as_ref()], bump)]
    pub traders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = paired_mint, token::authority = coin_record.creator_wallet)]
    pub creator_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = paired_mint, token::authority = config.treasury)]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,

    pub coin_token_program: Interface<'info, TokenInterface>,
    pub paired_token_program: Interface<'info, TokenInterface>,
}

/// Swaps `amount_in` of the coin-side CPMM fees into the paired token and
/// routes the proceeds. `reference_price_q64` is paired-per-coin in Q64.64.
pub fn swap_base_fees(ctx: Context<SwapBaseFees>, amount_in: u64, reference_price_q64: u128) -> Result<()> {
    let a = &ctx.accounts;
    require!(amount_in > 0 && amount_in <= a.coin_record.pending_base_fees, RouterError::InsufficientFunds);
    validate_swap_pool(
        &a.cpmm_pool,
        &a.amm_config,
        &a.input_vault,
        &a.output_vault,
        &a.observation_state,
        a.coin_mint.key(),
        a.paired_mint.key(),
    )?;

    let min_out = guard::min_out(guard::expected_out(amount_in, reference_price_q64).core()?, a.config.guard_bps).core()?;
    let before = a.intake.amount;
    let bump = [a.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    raydium::cpmm::swap_base_input(
        raydium::cpmm::SwapBaseInput {
            payer: &a.authority.to_account_info(),
            authority: &a.cpmm_authority.to_account_info(),
            amm_config: &a.amm_config.to_account_info(),
            pool_state: &a.cpmm_pool.to_account_info(),
            input_token_account: &a.coin_token.to_account_info(),
            output_token_account: &a.intake.to_account_info(),
            input_vault: &a.input_vault.to_account_info(),
            output_vault: &a.output_vault.to_account_info(),
            input_token_program: &a.coin_token_program.to_account_info(),
            output_token_program: &a.paired_token_program.to_account_info(),
            input_token_mint: &a.coin_mint.to_account_info(),
            output_token_mint: &a.paired_mint.to_account_info(),
            observation_state: &a.observation_state.to_account_info(),
            cpmm_program: &a.cpmm_program.to_account_info(),
        },
        amount_in,
        min_out,
        seeds,
    )?;

    ctx.accounts.intake.reload()?;
    let a = &mut ctx.accounts;
    let received = a.intake.amount.checked_sub(before).ok_or(RouterError::MathOverflow)?;
    guard::check(received, amount_in, reference_price_q64, a.config.guard_bps).core()?;
    a.coin_record.pending_base_fees -= amount_in;

    let decimals = a.paired_mint.decimals;
    let mint = a.coin_record.mint;
    route_fees(
        RouteAccounts {
            intake: &a.intake.to_account_info(),
            paired_mint: &a.paired_mint.to_account_info(),
            authority: &a.authority.to_account_info(),
            holders_vault: &a.holders_vault.to_account_info(),
            flagship_vault: &a.flagship_vault.to_account_info(),
            traders_vault: &a.traders_vault.to_account_info(),
            creator_token: &a.creator_token.to_account_info(),
            treasury_token: &a.treasury_token.to_account_info(),
            token_program: &a.paired_token_program.to_account_info(),
        },
        &a.config,
        &mut a.coin_record,
        mint,
        received,
        decimals,
        SOURCE_BASE_SWAP,
    )?;
    Ok(())
}

/// Checks that the CPMM accounts belong together and that the pool trades
/// `input_mint` against `output_mint`, with `input_vault` / `output_vault` on
/// the right sides. Returns `true` if the swap is token_0 → token_1.
pub fn validate_swap_pool(
    pool: &AccountInfo,
    amm_config: &AccountInfo,
    input_vault: &AccountInfo,
    output_vault: &AccountInfo,
    observation: &AccountInfo,
    input_mint: Pubkey,
    output_mint: Pubkey,
) -> Result<bool> {
    let data = pool.try_borrow_data()?;
    let p = CpmmPoolView::new(&data).core()?;
    require_keys_eq!(Pubkey::new_from_array(p.amm_config()), amm_config.key(), RouterError::InvalidCpmmPool);
    require_keys_eq!(Pubkey::new_from_array(p.observation_key()), observation.key(), RouterError::InvalidCpmmPool);
    let (m0, m1) = (Pubkey::new_from_array(p.token_0_mint()), Pubkey::new_from_array(p.token_1_mint()));
    let (v0, v1) = (Pubkey::new_from_array(p.token_0_vault()), Pubkey::new_from_array(p.token_1_vault()));
    if m0 == input_mint && m1 == output_mint {
        require_keys_eq!(v0, input_vault.key(), RouterError::InvalidCpmmPool);
        require_keys_eq!(v1, output_vault.key(), RouterError::InvalidCpmmPool);
        Ok(true)
    } else if m1 == input_mint && m0 == output_mint {
        require_keys_eq!(v1, input_vault.key(), RouterError::InvalidCpmmPool);
        require_keys_eq!(v0, output_vault.key(), RouterError::InvalidCpmmPool);
        Ok(false)
    } else {
        err!(RouterError::InvalidCpmmPool)
    }
}
