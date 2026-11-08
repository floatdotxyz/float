//! Holder payouts.
//!
//! The operator (payout bot) computes each holder's share off chain — pro
//! rata balances, the $2 account-creation threshold, rollovers and seller
//! forfeits — and submits batches here. The program enforces that a coin can
//! never pay out more than the holder share it has actually accrued, that
//! every recipient account holds the coin's paired token, and emits an
//! auditable event per batch.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::errors::RouterError;
use crate::events::HoldersPaid;
use crate::state::{CoinRecord, RouterConfig};

#[derive(Accounts)]
pub struct PayoutHolders<'info> {
    pub operator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = operator @ RouterError::NotOperator,
        constraint = !config.paused @ RouterError::Paused)]
    pub config: Box<Account<'info, RouterConfig>>,
    /// CHECK: router authority PDA; owner of the holders vault.
    #[account(seeds = [AUTHORITY_SEED], bump = config.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [COIN_SEED, coin_record.mint.as_ref()], bump = coin_record.bump)]
    pub coin_record: Box<Account<'info, CoinRecord>>,
    #[account(address = coin_record.paired_mint)]
    pub paired_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [VAULT_SEED, &[vault_kind::HOLDERS], paired_mint.key().as_ref()], bump)]
    pub holders_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    // remaining_accounts: recipient token accounts (writable), one per amount.
}

pub fn payout_holders<'info>(ctx: Context<'_, '_, 'info, 'info, PayoutHolders<'info>>, round: u64, amounts: Vec<u64>) -> Result<()> {
    let recipients = ctx.remaining_accounts;
    require!(recipients.len() == amounts.len(), RouterError::LengthMismatch);
    require!(!amounts.is_empty() && amounts.len() <= MAX_PAYOUTS_PER_IX, RouterError::TooManyRecipients);

    let total = amounts.iter().try_fold(0u64, |s, x| s.checked_add(*x)).ok_or(RouterError::MathOverflow)?;
    require!(total <= ctx.accounts.coin_record.holders_unpaid, RouterError::InsufficientFunds);

    let paired = ctx.accounts.paired_mint.key();
    let decimals = ctx.accounts.paired_mint.decimals;
    let bump = [ctx.accounts.config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];

    for (acc, amount) in recipients.iter().zip(amounts.iter()) {
        require!(acc.is_writable, RouterError::InvalidAccountData);
        let ta = InterfaceAccount::<TokenAccount>::try_from(acc)?;
        require_keys_eq!(ta.mint, paired, RouterError::MintMismatch);
        if *amount == 0 {
            continue;
        }
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.holders_vault.to_account_info(),
                    mint: ctx.accounts.paired_mint.to_account_info(),
                    to: acc.clone(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
                seeds,
            ),
            *amount,
            decimals,
        )?;
    }

    let coin = &mut ctx.accounts.coin_record;
    coin.holders_unpaid -= total;
    let config = &mut ctx.accounts.config;
    config.payout_rounds = config.payout_rounds.saturating_add(1);

    emit!(HoldersPaid { mint: coin.mint, round, recipients: amounts.len() as u16, total });
    Ok(())
}
