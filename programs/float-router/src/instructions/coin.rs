use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use anchor_spl::token_interface::Mint;
use float_core::launchlab::PoolView;
use float_core::ticker::{self, FeeSettlement, Ticker};

use crate::constants::*;
use crate::errors::{CoreResultExt, RouterError};
use crate::events::{CoinGraduated, CoinRegistered, TickerFeeSettled};
use crate::state::{CoinRecord, RouterConfig, TickerRecord};

// ------------------------------------------------------------ register_coin

/// Registers a coin launched on the router's LaunchLab platform. Bundle it in
/// the same transaction as LaunchLab `initialize`, after it.
#[derive(Accounts)]
#[instruction(ticker: String)]
pub struct RegisterCoin<'info> {
    #[account(mut)]
    pub launcher: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    pub coin_mint: Box<InterfaceAccount<'info, Mint>>,
    pub paired_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: verified as the LaunchLab pool PDA for (coin, paired) and parsed below.
    #[account(
        seeds = [b"pool", coin_mint.key().as_ref(), paired_mint.key().as_ref()],
        bump,
        seeds::program = LAUNCHLAB_PROGRAM_ID,
        owner = LAUNCHLAB_PROGRAM_ID @ RouterError::InvalidLaunchLabPool,
    )]
    pub launchlab_pool: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = launcher, space = 8 + TickerRecord::INIT_SPACE,
        seeds = [TICKER_SEED, ticker.as_bytes()], bump)]
    pub ticker_record: Box<Account<'info, TickerRecord>>,
    #[account(init, payer = launcher, space = 8 + CoinRecord::INIT_SPACE,
        seeds = [COIN_SEED, coin_mint.key().as_ref()], bump)]
    pub coin_record: Box<Account<'info, CoinRecord>>,
    #[account(mut, seeds = [TICKER_ESCROW_SEED, coin_mint.key().as_ref()], bump)]
    pub ticker_escrow: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn register_coin(ctx: Context<RegisterCoin>, ticker: String, creator_wallet: Pubkey) -> Result<()> {
    // The caller must pass the ticker already normalised: it is a PDA seed.
    let parsed = Ticker::parse(ticker.as_bytes()).core()?;
    require!(parsed.as_bytes() == ticker.as_bytes(), RouterError::InvalidTicker);

    let pool_data = ctx.accounts.launchlab_pool.try_borrow_data()?;
    let pool = PoolView::new(&pool_data).core()?;
    require_keys_eq!(
        Pubkey::new_from_array(pool.platform_config()),
        ctx.accounts.config.launchlab_platform_config,
        RouterError::WrongPlatform
    );
    require_keys_eq!(Pubkey::new_from_array(pool.creator()), ctx.accounts.launcher.key(), RouterError::NotPoolCreator);
    require!(!pool.is_graduated(), RouterError::AlreadyGraduated);
    drop(pool_data);

    let now = Clock::get()?.unix_timestamp;
    let tr = &mut ctx.accounts.ticker_record;
    let prior = tr.launches;
    if prior == 0 {
        tr.ticker = [0; 10];
        tr.ticker[..parsed.len()].copy_from_slice(parsed.as_bytes());
        tr.ticker_len = parsed.len() as u8;
        tr.first_mint = ctx.accounts.coin_mint.key();
        tr.bump = ctx.bumps.ticker_record;
    }
    tr.launches = prior.checked_add(1).ok_or(RouterError::MathOverflow)?;

    let fee = ticker::reuse_fee(prior, now);
    if fee > 0 {
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.launcher.to_account_info(), to: ctx.accounts.ticker_escrow.to_account_info() },
            ),
            fee,
        )?;
    }

    let c = &mut ctx.accounts.coin_record;
    c.mint = ctx.accounts.coin_mint.key();
    c.paired_mint = ctx.accounts.paired_mint.key();
    c.launchlab_pool = ctx.accounts.launchlab_pool.key();
    c.launcher = ctx.accounts.launcher.key();
    c.creator_wallet = creator_wallet;
    c.ticker = tr.ticker;
    c.ticker_len = tr.ticker_len;
    c.launched_at = now;
    c.graduated_at = 0;
    c.reuse_fee = fee;
    c.reuse_fee_settled = fee == 0;
    c.bump = ctx.bumps.coin_record;

    let config = &mut ctx.accounts.config;
    config.coins_registered = config.coins_registered.saturating_add(1);

    emit!(CoinRegistered {
        mint: c.mint,
        paired_mint: c.paired_mint,
        ticker,
        launcher: c.launcher,
        creator_wallet,
        reuse_fee: fee,
        launch_index: prior,
    });
    Ok(())
}

// ---------------------------------------------------------- mark_graduated

/// Permissionless: records the graduation time once the LaunchLab pool has
/// migrated. Keepers call it as soon as they see `status == 2`.
#[derive(Accounts)]
pub struct MarkGraduated<'info> {
    #[account(mut, seeds = [COIN_SEED, coin_record.mint.as_ref()], bump = coin_record.bump)]
    pub coin_record: Box<Account<'info, CoinRecord>>,
    /// CHECK: address pinned to the coin's LaunchLab pool.
    #[account(address = coin_record.launchlab_pool, owner = LAUNCHLAB_PROGRAM_ID)]
    pub launchlab_pool: UncheckedAccount<'info>,
}

pub fn mark_graduated(ctx: Context<MarkGraduated>) -> Result<()> {
    let c = &mut ctx.accounts.coin_record;
    require!(c.graduated_at == 0, RouterError::AlreadyGraduated);
    let data = ctx.accounts.launchlab_pool.try_borrow_data()?;
    require!(PoolView::new(&data).core()?.is_graduated(), RouterError::NotGraduated);
    c.graduated_at = Clock::get()?.unix_timestamp;
    emit!(CoinGraduated { mint: c.mint, graduated_at: c.graduated_at });
    Ok(())
}

// ------------------------------------------------------- settle_ticker_fee

/// Permissionless: refunds the escrowed reuse fee to the launcher if the coin
/// graduated within 48 h of launch, or releases it to the treasury once the
/// window has passed without graduation.
#[derive(Accounts)]
pub struct SettleTickerFee<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,
    #[account(mut, seeds = [COIN_SEED, coin_record.mint.as_ref()], bump = coin_record.bump)]
    pub coin_record: Box<Account<'info, CoinRecord>>,
    #[account(mut, seeds = [TICKER_ESCROW_SEED, coin_record.mint.as_ref()], bump)]
    pub ticker_escrow: SystemAccount<'info>,
    #[account(mut, address = coin_record.launcher)]
    pub launcher: SystemAccount<'info>,
    #[account(mut, address = config.treasury)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn settle_ticker_fee(ctx: Context<SettleTickerFee>) -> Result<()> {
    let c = &mut ctx.accounts.coin_record;
    require!(!c.reuse_fee_settled, RouterError::AlreadySettled);

    let graduated = if c.graduated_at == 0 { None } else { Some(c.graduated_at) };
    let decision = ticker::settle(c.launched_at, graduated, Clock::get()?.unix_timestamp);
    let to = match decision {
        FeeSettlement::Pending => return err!(RouterError::SettlementPending),
        FeeSettlement::RefundLauncher => ctx.accounts.launcher.to_account_info(),
        FeeSettlement::ReleaseToTreasury => ctx.accounts.treasury.to_account_info(),
    };

    let amount = ctx.accounts.ticker_escrow.lamports();
    let mint = c.mint;
    let bump = [ctx.bumps.ticker_escrow];
    let seeds: &[&[&[u8]]] = &[&[TICKER_ESCROW_SEED, mint.as_ref(), &bump]];
    system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer { from: ctx.accounts.ticker_escrow.to_account_info(), to },
            seeds,
        ),
        amount,
    )?;

    c.reuse_fee_settled = true;
    emit!(TickerFeeSettled { mint, amount, refunded: decision == FeeSettlement::RefundLauncher });
    Ok(())
}
