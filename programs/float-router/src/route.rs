//! Fee routing: splits an amount that has just landed in the authority's
//! intake account and moves each share to its destination.
//!
//! | Share    | Destination |
//! | -------- | ----------- |
//! | holders  | `vault[HOLDERS][paired]`, credited to `coin.holders_unpaid` |
//! | creator  | token account owned by `coin.creator_wallet` |
//! | flagship | `vault[FLAGSHIP][paired]` |
//! | traders  | `vault[TRADERS][paired]` |
//! | treasury | token account owned by `config.treasury` (also gets the rounding dust) |
//!
//! `cycle_launchlab`, `cycle_cpmm` and `swap_base_fees` call [`route_fees`]
//! right after measuring the intake balance delta of one coin's claim or
//! swap, so every routed amount is attributable to exactly one coin.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, TokenAccount, TransferChecked};
use float_core::split;

use crate::constants::AUTHORITY_SEED;
use crate::errors::{CoreResultExt, RouterError};
use crate::events::FeesCycled;
use crate::state::{CoinRecord, RouterConfig};

/// Accounts touched by [`route_fees`]. The calling instruction's `Accounts`
/// struct validates every one of them: vault PDAs per paired mint, intake ATA
/// of the authority, creator and treasury token accounts by mint and owner.
pub struct RouteAccounts<'a, 'info> {
    /// Authority-owned token account holding the amount to route.
    pub intake: &'a AccountInfo<'info>,
    /// Paired mint; every share is denominated in it.
    pub paired_mint: &'a AccountInfo<'info>,
    /// Router authority PDA. Owns `intake` and signs every transfer.
    pub authority: &'a AccountInfo<'info>,
    /// `vault[HOLDERS][paired]`.
    pub holders_vault: &'a AccountInfo<'info>,
    /// `vault[FLAGSHIP][paired]`.
    pub flagship_vault: &'a AccountInfo<'info>,
    /// `vault[TRADERS][paired]`.
    pub traders_vault: &'a AccountInfo<'info>,
    /// Paired-mint token account owned by the coin's `creator_wallet`.
    pub creator_token: &'a AccountInfo<'info>,
    /// Paired-mint token account owned by `config.treasury`.
    pub treasury_token: &'a AccountInfo<'info>,
    /// Token program of the paired mint (SPL Token or Token-2022).
    pub token_program: &'a AccountInfo<'info>,
}

/// Splits `amount` (already sitting in `accs.intake`) with the configured
/// split, transfers each share, updates the coin's lifetime totals and
/// `holders_unpaid`, and emits [`FeesCycled`].
///
/// `source` is `SOURCE_LAUNCHLAB`, `SOURCE_CPMM` or `SOURCE_BASE_SWAP`.
pub fn route_fees<'info>(
    accs: RouteAccounts<'_, 'info>,
    config: &RouterConfig,
    coin: &mut CoinRecord,
    mint: Pubkey,
    amount: u64,
    decimals: u8,
    source: u8,
) -> Result<()> {
    require!(amount > 0, RouterError::NoFees);
    require_keys_eq!(mint, coin.mint, RouterError::InvalidAccountData);
    require_keys_eq!(accs.paired_mint.key(), coin.paired_mint, RouterError::MintMismatch);

    // Conservation: the five shares always sum to `amount` (float_core::split).
    let shares = split::split(amount, &config.split_bps()).core()?;
    let bump = [config.authority_bump];
    let seeds: &[&[&[u8]]] = &[&[AUTHORITY_SEED, &bump]];
    let send = |to: &AccountInfo<'info>, value: u64| transfer_signed(&accs, to, value, decimals, seeds);

    // Interpretation: the docs say `holders_unpaid += holders`. We credit the
    // amount the holders vault actually received instead, which is the same
    // number for every mint without a transfer fee. The vault is shared by
    // every coin with this paired mint, so crediting a quoted amount that a
    // Token-2022 transfer fee then shrinks would let one coin's payouts spend
    // another coin's rewards (breaking holder solvency). Lifetime totals and
    // the event keep the gross split figures, so they still sum to `amount`.
    let holders_before = token_amount(accs.holders_vault)?;
    send(accs.holders_vault, shares.holders)?;
    let holders_received = token_amount(accs.holders_vault)?.checked_sub(holders_before).ok_or(RouterError::MathOverflow)?;

    send(accs.flagship_vault, shares.flagship)?;
    send(accs.traders_vault, shares.traders)?;
    send(accs.creator_token, shares.creator)?;
    send(accs.treasury_token, shares.treasury)?;

    let add = |total: u64, x: u64| total.checked_add(x).ok_or(RouterError::MathOverflow);
    coin.total_cycled = add(coin.total_cycled, amount)?;
    coin.total_holders = add(coin.total_holders, shares.holders)?;
    coin.total_creator = add(coin.total_creator, shares.creator)?;
    coin.total_flagship = add(coin.total_flagship, shares.flagship)?;
    coin.total_traders = add(coin.total_traders, shares.traders)?;
    coin.total_treasury = add(coin.total_treasury, shares.treasury)?;
    coin.holders_unpaid = add(coin.holders_unpaid, holders_received)?;

    emit!(FeesCycled {
        mint,
        paired_mint: coin.paired_mint,
        source,
        amount,
        holders: shares.holders,
        creator: shares.creator,
        flagship: shares.flagship,
        traders: shares.traders,
        treasury: shares.treasury,
    });
    Ok(())
}

/// `transfer_checked` from the intake, signed by the authority PDA.
fn transfer_signed<'info>(
    accs: &RouteAccounts<'_, 'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    seeds: &[&[&[u8]]],
) -> Result<()> {
    // Interpretation: zero shares (tiny amounts, or a 0 bps bucket) are
    // skipped rather than sent as zero-amount transfers. Accounting is identical.
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            accs.token_program.clone(),
            TransferChecked {
                from: accs.intake.clone(),
                mint: accs.paired_mint.clone(),
                to: to.clone(),
                authority: accs.authority.clone(),
            },
            seeds,
        ),
        amount,
        decimals,
    )
}

/// Balance of an SPL Token or Token-2022 account.
fn token_amount(acc: &AccountInfo) -> Result<u64> {
    let data = acc.try_borrow_data()?;
    Ok(TokenAccount::try_deserialize(&mut &data[..])?.amount)
}
