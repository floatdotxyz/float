# float-core

`no_std`, zero-dependency Rust crate with the rules and math shared by the
`float-router` program and its keepers. Everything is pure and deterministic,
so it is unit-tested on the host.

| Module | Decides |
| --- | --- |
| `split` | 15 / 5 / 35 / 35 / 10 fee split (exact; dust → treasury) |
| `ticker` | Ticker normalisation, 1 SOL reuse fee, 48 h graduation refund |
| `cpmm` | Raydium CPMM `swap_base_input` (port of `CurveCalculator`) and price-impact check |
| `cpmm_state` | Zero-copy CPMM `PoolState` / `AmmConfig` reads |
| `launchlab` | Zero-copy LaunchLab `PoolState` reads |
| `buyback` | 5 SOL / 4 h trigger and ≤ 1 % impact sizing |
| `guard` | Q64.64 reference-price guard (2 %) |
| `merkle` | Domain-separated sha256 merkle proofs for airdrops |

```bash
cargo test -p float-core
```

Cross-language vectors (the split, CPMM swaps and the merkle fixture) are
shared with the TypeScript SDK tests.
