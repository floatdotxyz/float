# Vendored Raydium sources

Files here are copied **verbatim** from Raydium's public repositories so the
SDK can be checked against the exact interfaces and math it integrates with.
They are not modified.

| Content | Upstream | Commit | License |
| --- | --- | --- | --- |
| `cp-swap-src/` (CPMM program: `lib.rs`, `error.rs`, `curve/`, `states/`, `utils/`, `instructions/`) | [raydium-io/raydium-cp-swap](https://github.com/raydium-io/raydium-cp-swap) `programs/cp-swap/src` | `3d69122790e97cd6aff24e8ba95940793773f58c` | Apache-2.0 ([LICENSE](cp-swap-src/LICENSE)) |
| `../../packages/sdk/idl/raydium_launchpad.json` | [raydium-io/raydium-idl](https://github.com/raydium-io/raydium-idl) `raydium_launchpad/` | `e7e0c96fe77bcf6a020b84a44c47a722aac8e359` | Published interface |
| `../../packages/sdk/idl/raydium_cp_swap.json` | [raydium-io/raydium-idl](https://github.com/raydium-io/raydium-idl) `raydium_cpmm/` | `e7e0c96fe77bcf6a020b84a44c47a722aac8e359` | Published interface |

PDA seeds and the Burn & Earn instruction layout were cross-checked against
[raydium-io/raydium-sdk-V2](https://github.com/raydium-io/raydium-sdk-V2) at
`1cf5bb129dbbb1c76dab67819c3d478349c8ed25`. No code from that repository (GPL-3.0) is included. The SDK
re-implements those facts from scratch, and the tests verify them independently
(PDA derivations and `sha256` discriminators).

## Checksums

```text
963189409945069409f32e345d4adf2892e0b3ca1be504372577fe34a23c6cdb  packages/sdk/idl/raydium_launchpad.json
1202f6dc8e1c3216598f2ad5c620b9aa8c64ac584563fafed68125c27fb6df81  packages/sdk/idl/raydium_cp_swap.json
```

## Notes

- The CPMM source is newer than the published IDL. It contains
  `collect_creator_fee_permissionless`, `initialize_v2` and a
  `creator_fee_share_rate` in `AmmConfig`, none of which are in the IDL yet.
  The SDK hand-encodes `collect_creator_fee_permissionless` from
  `cp-swap-src/instructions/collect_creator_fee_permissionless.rs`.
- Updating: copy the new files, update the commit hashes and checksums above,
  and run `npm test`. The discriminator tests fail if an IDL is inconsistent.
