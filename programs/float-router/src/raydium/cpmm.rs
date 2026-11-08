use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::constants::{CPMM_PROGRAM_ID, IX_CPMM_COLLECT_CREATOR_FEE, IX_CPMM_SWAP_BASE_INPUT};

/// Accounts of CPMM `collect_creator_fee`, in IDL order.
pub struct CollectCreatorFee<'a, 'info> {
    /// `PoolState.pool_creator` — the router authority PDA.
    pub creator: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub pool_state: &'a AccountInfo<'info>,
    pub amm_config: &'a AccountInfo<'info>,
    pub token_0_vault: &'a AccountInfo<'info>,
    pub token_1_vault: &'a AccountInfo<'info>,
    pub vault_0_mint: &'a AccountInfo<'info>,
    pub vault_1_mint: &'a AccountInfo<'info>,
    /// ATA(creator, token_0_program, vault_0_mint). Must already exist: the
    /// authority PDA holds no lamports to pay for `init_if_needed`.
    pub creator_token_0: &'a AccountInfo<'info>,
    pub creator_token_1: &'a AccountInfo<'info>,
    pub token_0_program: &'a AccountInfo<'info>,
    pub token_1_program: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
    pub cpmm_program: &'a AccountInfo<'info>,
}

pub fn collect_creator_fee(a: CollectCreatorFee<'_, '_>, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(a.creator.key(), true),
            AccountMeta::new_readonly(a.authority.key(), false),
            AccountMeta::new(a.pool_state.key(), false),
            AccountMeta::new_readonly(a.amm_config.key(), false),
            AccountMeta::new(a.token_0_vault.key(), false),
            AccountMeta::new(a.token_1_vault.key(), false),
            AccountMeta::new_readonly(a.vault_0_mint.key(), false),
            AccountMeta::new_readonly(a.vault_1_mint.key(), false),
            AccountMeta::new(a.creator_token_0.key(), false),
            AccountMeta::new(a.creator_token_1.key(), false),
            AccountMeta::new_readonly(a.token_0_program.key(), false),
            AccountMeta::new_readonly(a.token_1_program.key(), false),
            AccountMeta::new_readonly(a.associated_token_program.key(), false),
            AccountMeta::new_readonly(a.system_program.key(), false),
        ],
        data: IX_CPMM_COLLECT_CREATOR_FEE.to_vec(),
    };
    invoke_signed(
        &ix,
        &[
            a.creator.clone(),
            a.authority.clone(),
            a.pool_state.clone(),
            a.amm_config.clone(),
            a.token_0_vault.clone(),
            a.token_1_vault.clone(),
            a.vault_0_mint.clone(),
            a.vault_1_mint.clone(),
            a.creator_token_0.clone(),
            a.creator_token_1.clone(),
            a.token_0_program.clone(),
            a.token_1_program.clone(),
            a.associated_token_program.clone(),
            a.system_program.clone(),
            a.cpmm_program.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}

/// Accounts of CPMM `swap_base_input`, in IDL order.
pub struct SwapBaseInput<'a, 'info> {
    /// Owner of `input_token_account` — the router authority PDA.
    pub payer: &'a AccountInfo<'info>,
    pub authority: &'a AccountInfo<'info>,
    pub amm_config: &'a AccountInfo<'info>,
    pub pool_state: &'a AccountInfo<'info>,
    pub input_token_account: &'a AccountInfo<'info>,
    pub output_token_account: &'a AccountInfo<'info>,
    pub input_vault: &'a AccountInfo<'info>,
    pub output_vault: &'a AccountInfo<'info>,
    pub input_token_program: &'a AccountInfo<'info>,
    pub output_token_program: &'a AccountInfo<'info>,
    pub input_token_mint: &'a AccountInfo<'info>,
    pub output_token_mint: &'a AccountInfo<'info>,
    pub observation_state: &'a AccountInfo<'info>,
    pub cpmm_program: &'a AccountInfo<'info>,
}

pub fn swap_base_input(a: SwapBaseInput<'_, '_>, amount_in: u64, minimum_amount_out: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
    let mut data = Vec::with_capacity(24);
    data.extend_from_slice(&IX_CPMM_SWAP_BASE_INPUT);
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&minimum_amount_out.to_le_bytes());
    let ix = Instruction {
        program_id: CPMM_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new_readonly(a.payer.key(), true),
            AccountMeta::new_readonly(a.authority.key(), false),
            AccountMeta::new_readonly(a.amm_config.key(), false),
            AccountMeta::new(a.pool_state.key(), false),
            AccountMeta::new(a.input_token_account.key(), false),
            AccountMeta::new(a.output_token_account.key(), false),
            AccountMeta::new(a.input_vault.key(), false),
            AccountMeta::new(a.output_vault.key(), false),
            AccountMeta::new_readonly(a.input_token_program.key(), false),
            AccountMeta::new_readonly(a.output_token_program.key(), false),
            AccountMeta::new_readonly(a.input_token_mint.key(), false),
            AccountMeta::new_readonly(a.output_token_mint.key(), false),
            AccountMeta::new(a.observation_state.key(), false),
        ],
        data,
    };
    invoke_signed(
        &ix,
        &[
            a.payer.clone(),
            a.authority.clone(),
            a.amm_config.clone(),
            a.pool_state.clone(),
            a.input_token_account.clone(),
            a.output_token_account.clone(),
            a.input_vault.clone(),
            a.output_vault.clone(),
            a.input_token_program.clone(),
            a.output_token_program.clone(),
            a.input_token_mint.clone(),
            a.output_token_mint.clone(),
            a.observation_state.clone(),
            a.cpmm_program.clone(),
        ],
        signer_seeds,
    )?;
    Ok(())
}
