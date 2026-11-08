use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::constants::{IX_LAUNCHLAB_CLAIM_PLATFORM_FEE, LAUNCHLAB_PROGRAM_ID};

/// Accounts of LaunchLab `claim_platform_fee`, in IDL order.
pub struct ClaimPlatformFee<'a, 'info> {
    /// Must equal `PlatformConfig.platform_fee_wallet` — the router authority PDA.
    pub platform_fee_wallet: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub pool_state: &'a AccountInfo<'info>,
    pub platform_config: &'a AccountInfo<'info>,
    pub quote_vault: &'a AccountInfo<'info>,
    /// ATA(platform_fee_wallet, token_program, quote_mint).
    pub recipient_token_account: &'a AccountInfo<'info>,
    pub quote_mint: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub launchlab_program: &'a AccountInfo<'info>,
}

pub fn claim_platform_fee(a: ClaimPlatformFee<'_, '_>, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let ix = Instruction {
        program_id: LAUNCHLAB_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(a.platform_fee_wallet.key(), true),
            AccountMeta::new_readonly(a.authority.key(), false),
            AccountMeta::new(a.pool_state.key(), false),
            AccountMeta::new_readonly(a.platform_config.key(), false),
            AccountMeta::new(a.quote_vault.key(), false),
            AccountMeta::new(a.recipient_token_account.key(), false),
            AccountMeta::new_readonly(a.quote_mint.key(), false),
            AccountMeta::new_readonly(a.token_program.key(), false),
            AccountMeta::new_readonly(a.system_program.key(), false),
            AccountMeta::new_readonly(a.associated_token_program.key(), false),
        ],
        data: IX_LAUNCHLAB_CLAIM_PLATFORM_FEE.to_vec(),
    };
    invoke_signed(
        &ix,
        &[
            a.platform_fee_wallet.clone(),
            a.authority.clone(),
            a.pool_state.clone(),
            a.platform_config.clone(),
            a.quote_vault.clone(),
            a.recipient_token_account.clone(),
            a.quote_mint.clone(),
            a.token_program.clone(),
            a.system_program.clone(),
            a.associated_token_program.clone(),
            a.launchlab_program.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}
