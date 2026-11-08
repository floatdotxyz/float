//! Hand-encoded CPIs into Raydium. Account order and discriminators follow the
//! vendored IDLs (`packages/sdk/idl/*.json`); the SDK tests assert the
//! discriminators equal `sha256("global:<name>")[..8]`.

pub mod cpmm;
pub mod launchlab;
