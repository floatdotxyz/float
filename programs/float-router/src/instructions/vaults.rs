use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::state::RouterConfig;

/// Creates the three router vaults and the authority's intake ATA for a mint.
/// Permissionless; the caller pays rent. Run once per paired mint, plus once
/// for WSOL and USDC (conversion targets) and once for the $FLOAT mint
/// (buyback output, intake ATA only is used).
#[derive(Accounts)]
pub struct InitMintVaults<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = payer, seeds = [VAULT_SEED, &[vault_kind::HOLDERS], mint.key().as_ref()], bump,
        token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub holders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = payer, seeds = [VAULT_SEED, &[vault_kind::FLAGSHIP], mint.key().as_ref()], bump,
        token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub flagship_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = payer, seeds = [VAULT_SEED, &[vault_kind::TRADERS], mint.key().as_ref()], bump,
        token::mint = mint, token::authority = authority, token::token_program = token_program)]
    pub traders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Intake ATA: Raydium fee claims land here before being routed.
    #[account(init_if_needed, payer = payer, associated_token::mint = mint, associated_token::authority = authority,
        associated_token::token_program = token_program)]
    pub intake: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_mint_vaults(_ctx: Context<InitMintVaults>) -> Result<()> {
    Ok(())
}
