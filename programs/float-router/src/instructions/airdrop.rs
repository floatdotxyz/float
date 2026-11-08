//! Trader airdrops: merkle-rooted rounds funded from the USDC traders vault.
//!
//! The operator ranks traders off chain (volume, bot and wash filters, new-pair
//! maturity), commits the allocation as a merkle root, and pushes claims.
//! Claims are permissionless: anyone may submit a valid proof, funds always go
//! to the wallet in the leaf.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use float_core::merkle;

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::{AirdropClaimed, AirdropClosed, AirdropCreated};
use crate::state::{AirdropRound, ClaimReceipt, RouterConfig};

/// SHA-256 via the Solana syscall.
pub struct SolHasher;
impl merkle::Hasher for SolHasher {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] {
        anchor_lang::solana_program::hash::hashv(parts).to_bytes()
    }
}

fn transfer_signed<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    authority_bump: u8,
) -> Result<()> {
    let bump = [authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.clone(),
            TransferChecked { from: from.clone(), mint: mint.clone(), to: to.clone(), authority: authority.clone() },
            seeds,
        ),
        amount,
        decimals,
    )
}

// ------------------------------------------------------------ create_airdrop

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CreateAirdrop<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ RouterError::NotOperator,
        constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(address = USDC_MINT)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::TRADERS], usdc_mint.key().as_ref()], bump)]
    pub traders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = operator, space = 8 + AirdropRound::INIT_SPACE,
        seeds = [AIRDROP_SEED, round_id.to_le_bytes().as_ref()], bump)]
    pub round: Box<Account<'info, AirdropRound>>,
    #[account(init, payer = operator, seeds = [AIRDROP_SEED, round_id.to_le_bytes().as_ref(), ESCROW_SUFFIX], bump,
        token::mint = usdc_mint, token::authority = authority, token::token_program = token_program)]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn create_airdrop(ctx: Context<CreateAirdrop>, round_id: u64, root: [u8; 32], total: u64, expires_at: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(expires_at > now, RouterError::InvalidLimit);
    require!(total > 0 && total <= ctx.accounts.traders_vault.amount, RouterError::InsufficientFunds);

    let a = &ctx.accounts;
    transfer_signed(
        &a.token_program.to_account_info(),
        &a.traders_vault.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.escrow.to_account_info(),
        &a.authority.to_account_info(),
        total,
        a.usdc_mint.decimals,
        a.config.authority_bump,
    )?;

    let r = &mut ctx.accounts.round;
    r.round_id = round_id;
    r.root = root;
    r.mint = USDC_MINT;
    r.total = total;
    r.claimed = 0;
    r.claims = 0;
    r.created_at = now;
    r.expires_at = expires_at;
    r.closed = false;
    r.bump = ctx.bumps.round;
    r.escrow_bump = ctx.bumps.escrow;

    emit!(AirdropCreated { round_id, root, total, expires_at });
    Ok(())
}

// ------------------------------------------------------------- claim_airdrop

#[derive(Accounts)]
#[instruction(round_id: u64, index: u64)]
pub struct ClaimAirdrop<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [AIRDROP_SEED, round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, AirdropRound>>,
    #[account(mut, seeds = [AIRDROP_SEED, round_id.to_le_bytes().as_ref(), ESCROW_SUFFIX], bump = round.escrow_bump)]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = round.mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: the wallet committed in the merkle leaf; only receives funds.
    pub wallet: UncheckedAccount<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = wallet)]
    pub recipient_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(init, payer = payer, space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, round_id.to_le_bytes().as_ref(), index.to_le_bytes().as_ref()], bump)]
    pub receipt: Box<Account<'info, ClaimReceipt>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn claim_airdrop(ctx: Context<ClaimAirdrop>, round_id: u64, index: u64, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(!ctx.accounts.round.closed, RouterError::AirdropClosed);
    require!(proof.len() <= MAX_PROOF_LEN, RouterError::ProofTooLong);

    let wallet = ctx.accounts.wallet.key();
    let leaf = merkle::leaf::<SolHasher>(round_id, index, &wallet.to_bytes(), amount);
    require!(merkle::verify::<SolHasher>(&proof, &ctx.accounts.round.root, leaf), RouterError::InvalidProof);

    let claimed = ctx.accounts.round.claimed.checked_add(amount).ok_or(RouterError::MathOverflow)?;
    require!(claimed <= ctx.accounts.round.total, RouterError::AirdropOverClaimed);

    let a = &ctx.accounts;
    transfer_signed(
        &a.token_program.to_account_info(),
        &a.escrow.to_account_info(),
        &a.usdc_mint.to_account_info(),
        &a.recipient_token.to_account_info(),
        &a.authority.to_account_info(),
        amount,
        a.usdc_mint.decimals,
        a.config.authority_bump,
    )?;

    let r = &mut ctx.accounts.round;
    r.claimed = claimed;
    r.claims = r.claims.saturating_add(1);

    let rc = &mut ctx.accounts.receipt;
    rc.round_id = round_id;
    rc.index = index;
    rc.wallet = wallet;
    rc.amount = amount;
    rc.claimed_at = Clock::get()?.unix_timestamp;

    emit!(AirdropClaimed { round_id, index, wallet, amount });
    Ok(())
}

// ------------------------------------------------------------- close_airdrop

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseAirdrop<'info> {
    pub operator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ RouterError::NotOperator)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [AIRDROP_SEED, round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, AirdropRound>>,
    #[account(mut, seeds = [AIRDROP_SEED, round_id.to_le_bytes().as_ref(), ESCROW_SUFFIX], bump = round.escrow_bump)]
    pub escrow: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = round.mint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::TRADERS], usdc_mint.key().as_ref()], bump)]
    pub traders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// After expiry, returns unclaimed USDC to the traders vault for the next round.
pub fn close_airdrop(ctx: Context<CloseAirdrop>, round_id: u64) -> Result<()> {
    require!(!ctx.accounts.round.closed, RouterError::AirdropClosed);
    require!(Clock::get()?.unix_timestamp >= ctx.accounts.round.expires_at, RouterError::AirdropNotExpired);

    let a = &ctx.accounts;
    let remaining = a.escrow.amount;
    if remaining > 0 {
        transfer_signed(
            &a.token_program.to_account_info(),
            &a.escrow.to_account_info(),
            &a.usdc_mint.to_account_info(),
            &a.traders_vault.to_account_info(),
            &a.authority.to_account_info(),
            remaining,
            a.usdc_mint.decimals,
            a.config.authority_bump,
        )?;
    }
    ctx.accounts.round.closed = true;
    emit!(AirdropClosed { round_id, returned: remaining });
    Ok(())
}
