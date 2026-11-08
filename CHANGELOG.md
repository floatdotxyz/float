# Changelog

## 0.2.0 — 2026-11-08

### Added

- **programs/float-router**: Anchor reference implementation of the fee router.
  It has 18 instructions covering the coin registry, ticker escrow with a 48 h graduation refund,
  Raydium LaunchLab `claim_platform_fee` and CPMM `collect_creator_fee` CPIs,
  the exact 15/5/35/35/10 split, guarded conversions, buyback with on-chain
  impact cap and same-instruction burn, holder payouts and merkle airdrops.
- **crates/float-core**: `no_std`, zero-dependency Rust core shared by the
  program and the tests. It covers split, tickers, CPMM math, zero-copy LaunchLab/CPMM views,
  buyback, guard and merkle.
- **sdk**: `router` client with an IDL generated from the Rust source, plus merkle airdrop trees.
- **scripts**: deploy, init, keeper, payout bot, airdrop build/publish/distribute,
  IDL generator/checker, fixtures and README asset generator.
- **docs**: program specification, scripts guide, float-core README.
- Redesigned README with original animated artwork.

## 0.1.0 — 2026-11-08

Initial release: documentation, zero-dependency SDK, `float` CLI and vendored Raydium sources.
