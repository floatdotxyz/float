//! # float-core
//!
//! Dependency-free, `no_std` rules and math shared by the `float-router`
//! on-chain program, the off-chain keepers and the test-suite.
//!
//! Everything here is pure and deterministic: no syscalls, no allocation, no
//! floating point. On-chain code calls into it so the exact same logic is unit
//! tested on the host (`cargo test -p float-core`).
//!
//! | Module | What it decides |
//! | --- | --- |
//! | [`split`] | How a fee amount divides into holders / creator / flagship / traders / treasury |
//! | [`ticker`] | Ticker normalisation, the reuse fee and the 48 h graduation refund |
//! | [`cpmm`] | Raydium CPMM `swap_base_input` math (port of `CurveCalculator`) |
//! | [`cpmm_state`] | Zero-copy reads of CPMM `PoolState` / `AmmConfig` |
//! | [`buyback`] | When a $FLOAT buyback may fire and how large it may be (≤ 1 % impact) |
//! | [`guard`] | Minimum outputs for guarded fee-cycle swaps |
//! | [`merkle`] | Leaf/node hashing and proof verification for trader airdrops |
//! | [`launchlab`] | Zero-copy reads of the LaunchLab `PoolState` fields the router needs |

#![cfg_attr(not(test), no_std)]
#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod buyback;
pub mod cpmm;
pub mod cpmm_state;
pub mod error;
pub mod guard;
pub mod launchlab;
pub mod merkle;
pub mod split;
pub mod ticker;

pub use error::CoreError;

/// Basis-point denominator (100 % = 10 000 bps).
pub const BPS: u64 = 10_000;

/// Raydium fee-rate denominator (rates are expressed in 1e-6 units).
pub const FEE_RATE_DENOMINATOR: u64 = 1_000_000;

/// Lamports in one SOL.
pub const LAMPORTS_PER_SOL: u64 = 1_000_000_000;
