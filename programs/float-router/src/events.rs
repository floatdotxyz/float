use anchor_lang::prelude::*;

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub operator: Pubkey,
    pub paused: bool,
}

#[event]
pub struct CoinRegistered {
    pub mint: Pubkey,
    pub paired_mint: Pubkey,
    pub ticker: String,
    pub launcher: Pubkey,
    pub creator_wallet: Pubkey,
    pub reuse_fee: u64,
    pub launch_index: u32,
}

#[event]
pub struct CoinGraduated {
    pub mint: Pubkey,
    pub graduated_at: i64,
}

#[event]
pub struct TickerFeeSettled {
    pub mint: Pubkey,
    pub amount: u64,
    pub refunded: bool,
}

#[event]
pub struct FeesCycled {
    pub mint: Pubkey,
    pub paired_mint: Pubkey,
    /// 0 = LaunchLab platform fee, 1 = CPMM creator fee, 2 = swapped coin-side fees.
    pub source: u8,
    pub amount: u64,
    pub holders: u64,
    pub creator: u64,
    pub flagship: u64,
    pub traders: u64,
    pub treasury: u64,
}

#[event]
pub struct VaultConverted {
    pub kind: u8,
    pub from_mint: Pubkey,
    pub to_mint: Pubkey,
    pub amount_in: u64,
    pub amount_out: u64,
}

#[event]
pub struct BuybackBurned {
    pub sol_in: u64,
    pub float_burned: u64,
    pub total_burned: u64,
    /// 0 = target reached, 1 = interval elapsed.
    pub trigger: u8,
}

#[event]
pub struct HoldersPaid {
    pub mint: Pubkey,
    pub round: u64,
    pub recipients: u16,
    pub total: u64,
}

#[event]
pub struct AirdropCreated {
    pub round_id: u64,
    pub root: [u8; 32],
    pub total: u64,
    pub expires_at: i64,
}

#[event]
pub struct AirdropClaimed {
    pub round_id: u64,
    pub index: u64,
    pub wallet: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AirdropClosed {
    pub round_id: u64,
    pub returned: u64,
}
