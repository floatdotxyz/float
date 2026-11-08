use anchor_lang::prelude::*;
use float_core::guard::MAX_GUARD_BPS;
use float_core::split::SplitBps;

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::ConfigUpdated;
use crate::state::{RouterConfig, SplitConfig};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub operator: Pubkey,
    pub treasury: Pubkey,
    pub flagship_mint: Pubkey,
    pub launchlab_platform_config: Pubkey,
    pub split: SplitConfig,
    pub guard_bps: u16,
    pub max_impact_bps: u16,
    pub buyback_target_lamports: u64,
    pub buyback_interval_secs: i64,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + RouterConfig::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, RouterConfig>,
    /// CHECK: PDA used only as a signer; holds no data.
    #[account(seeds = [AUTHORITY_SEED], bump)]
    pub authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn validate_limits(split: SplitConfig, guard_bps: u16, max_impact_bps: u16, interval: i64) -> Result<()> {
    SplitBps::from(split).validate().map_err(|_| error!(RouterError::InvalidSplit))?;
    require!(guard_bps <= MAX_GUARD_BPS, RouterError::InvalidLimit);
    require!(max_impact_bps > 0 && max_impact_bps <= 500, RouterError::InvalidLimit);
    require!(interval > 0, RouterError::InvalidLimit);
    Ok(())
}

pub fn initialize(ctx: Context<Initialize>, p: InitializeParams) -> Result<()> {
    validate_limits(p.split, p.guard_bps, p.max_impact_bps, p.buyback_interval_secs)?;
    let c = &mut ctx.accounts.config;
    c.admin = ctx.accounts.admin.key();
    c.pending_admin = Pubkey::default();
    c.operator = p.operator;
    c.treasury = p.treasury;
    c.flagship_mint = p.flagship_mint;
    c.launchlab_platform_config = p.launchlab_platform_config;
    c.split = p.split;
    c.guard_bps = p.guard_bps;
    c.max_impact_bps = p.max_impact_bps;
    c.buyback_target_lamports = p.buyback_target_lamports;
    c.buyback_interval_secs = p.buyback_interval_secs;
    c.last_buyback_ts = 0;
    c.total_burned = 0;
    c.total_sol_spent = 0;
    c.coins_registered = 0;
    c.payout_rounds = 0;
    c.paused = false;
    c.bump = ctx.bumps.config;
    c.authority_bump = ctx.bumps.authority;
    c._reserved = [0; 64];
    emit!(ConfigUpdated { admin: c.admin, operator: c.operator, paused: false });
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigParams {
    pub operator: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub split: Option<SplitConfig>,
    pub guard_bps: Option<u16>,
    pub max_impact_bps: Option<u16>,
    pub buyback_target_lamports: Option<u64>,
    pub buyback_interval_secs: Option<i64>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ RouterError::NotAdmin)]
    pub config: Account<'info, RouterConfig>,
}

pub fn update_config(ctx: Context<AdminOnly>, p: UpdateConfigParams) -> Result<()> {
    let c = &mut ctx.accounts.config;
    if let Some(v) = p.operator {
        c.operator = v;
    }
    if let Some(v) = p.treasury {
        c.treasury = v;
    }
    if let Some(v) = p.split {
        c.split = v;
    }
    if let Some(v) = p.guard_bps {
        c.guard_bps = v;
    }
    if let Some(v) = p.max_impact_bps {
        c.max_impact_bps = v;
    }
    if let Some(v) = p.buyback_target_lamports {
        c.buyback_target_lamports = v;
    }
    if let Some(v) = p.buyback_interval_secs {
        c.buyback_interval_secs = v;
    }
    validate_limits(c.split, c.guard_bps, c.max_impact_bps, c.buyback_interval_secs)?;
    emit!(ConfigUpdated { admin: c.admin, operator: c.operator, paused: c.paused });
    Ok(())
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.paused = paused;
    emit!(ConfigUpdated { admin: c.admin, operator: c.operator, paused });
    Ok(())
}

pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_admin = new_admin;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump,
        constraint = config.pending_admin == pending_admin.key() @ RouterError::NotPendingAdmin)]
    pub config: Account<'info, RouterConfig>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.admin = c.pending_admin;
    c.pending_admin = Pubkey::default();
    emit!(ConfigUpdated { admin: c.admin, operator: c.operator, paused: c.paused });
    Ok(())
}
