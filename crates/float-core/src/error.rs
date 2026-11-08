//! Error type shared by every module.

/// Errors returned by `float-core`. The on-chain program maps each variant
/// one-to-one onto its Anchor error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreError {
    /// Arithmetic overflowed or underflowed.
    MathOverflow,
    /// Split shares do not sum to 10 000 bps.
    InvalidSplit,
    /// Ticker is empty, longer than 10 characters or not alphanumeric.
    InvalidTicker,
    /// A swap's output is below the price-guard minimum.
    PriceGuard,
    /// A buyback is not allowed yet (below threshold and interval not elapsed).
    BuybackNotDue,
    /// A buyback would move the price by more than the allowed impact.
    PriceImpactTooHigh,
    /// The pool reserves are empty or inconsistent.
    InvalidReserves,
    /// A merkle proof does not verify against the root.
    InvalidProof,
    /// Account data is too short or carries the wrong discriminator.
    InvalidAccountData,
}

impl core::fmt::Display for CoreError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = match self {
            Self::MathOverflow => "math overflow",
            Self::InvalidSplit => "split must sum to 10000 bps",
            Self::InvalidTicker => "ticker must be 1-10 ASCII letters or digits",
            Self::PriceGuard => "output below price-guard minimum",
            Self::BuybackNotDue => "buyback not due yet",
            Self::PriceImpactTooHigh => "price impact above limit",
            Self::InvalidReserves => "invalid pool reserves",
            Self::InvalidProof => "invalid merkle proof",
            Self::InvalidAccountData => "invalid account data",
        };
        f.write_str(s)
    }
}

/// Result alias.
pub type Result<T> = core::result::Result<T, CoreError>;
