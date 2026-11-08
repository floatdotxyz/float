use anchor_lang::prelude::*;
use float_core::CoreError;

#[error_code]
pub enum RouterError {
    #[msg("Router is paused")]
    Paused,
    #[msg("Signer is not the admin")]
    NotAdmin,
    #[msg("Signer is not the operator")]
    NotOperator,
    #[msg("Signer is not the pending admin")]
    NotPendingAdmin,
    #[msg("Split must sum to 10000 bps")]
    InvalidSplit,
    #[msg("Guard or impact limit out of range")]
    InvalidLimit,
    #[msg("Ticker must be 1-10 ASCII letters or digits and passed upper-case")]
    InvalidTicker,
    #[msg("Account is not a LaunchLab pool for this coin and paired mint")]
    InvalidLaunchLabPool,
    #[msg("LaunchLab pool belongs to a different platform config")]
    WrongPlatform,
    #[msg("Only the LaunchLab pool creator can register the coin")]
    NotPoolCreator,
    #[msg("Account is not the CPMM pool for this coin")]
    InvalidCpmmPool,
    #[msg("CPMM pool creator is not the router authority")]
    WrongPoolCreator,
    #[msg("Coin has not graduated yet")]
    NotGraduated,
    #[msg("Coin already graduated")]
    AlreadyGraduated,
    #[msg("Ticker fee already settled")]
    AlreadySettled,
    #[msg("Ticker fee settlement window still open")]
    SettlementPending,
    #[msg("No fees to cycle")]
    NoFees,
    #[msg("Token account mint does not match")]
    MintMismatch,
    #[msg("Token account owner does not match")]
    OwnerMismatch,
    #[msg("Amount exceeds what is available")]
    InsufficientFunds,
    #[msg("Number of amounts does not match number of recipients")]
    LengthMismatch,
    #[msg("Too many recipients in one instruction")]
    TooManyRecipients,
    #[msg("Conversion target mint not allowed for this vault kind")]
    InvalidConversionTarget,
    #[msg("Output below the price-guard minimum")]
    PriceGuard,
    #[msg("Buyback not due yet")]
    BuybackNotDue,
    #[msg("Buyback price impact above limit")]
    PriceImpactTooHigh,
    #[msg("Invalid pool reserves")]
    InvalidReserves,
    #[msg("Invalid merkle proof")]
    InvalidProof,
    #[msg("Proof too long")]
    ProofTooLong,
    #[msg("Airdrop round closed")]
    AirdropClosed,
    #[msg("Airdrop round has not expired yet")]
    AirdropNotExpired,
    #[msg("Claims exceed the round total")]
    AirdropOverClaimed,
    #[msg("Invalid account data")]
    InvalidAccountData,
    #[msg("Math overflow")]
    MathOverflow,
}

impl From<CoreError> for RouterError {
    fn from(e: CoreError) -> Self {
        match e {
            CoreError::MathOverflow => RouterError::MathOverflow,
            CoreError::InvalidSplit => RouterError::InvalidSplit,
            CoreError::InvalidTicker => RouterError::InvalidTicker,
            CoreError::PriceGuard => RouterError::PriceGuard,
            CoreError::BuybackNotDue => RouterError::BuybackNotDue,
            CoreError::PriceImpactTooHigh => RouterError::PriceImpactTooHigh,
            CoreError::InvalidReserves => RouterError::InvalidReserves,
            CoreError::InvalidProof => RouterError::InvalidProof,
            CoreError::InvalidAccountData => RouterError::InvalidAccountData,
        }
    }
}

/// `float_core::Result<T>` → `anchor_lang::Result<T>`.
pub trait CoreResultExt<T> {
    fn core(self) -> Result<T>;
}

impl<T> CoreResultExt<T> for core::result::Result<T, CoreError> {
    fn core(self) -> Result<T> {
        self.map_err(|e| error!(RouterError::from(e)))
    }
}
