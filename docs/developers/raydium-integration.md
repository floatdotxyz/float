# Raydium integration reference

Float coins live on Raydium. This page lists the accounts, seeds, instructions
and math the SDK uses, with their sources.

## Sources

| Program | Source used | Location here |
| --- | --- | --- |
| LaunchLab (`raydium_launchpad` 0.2.0) | Anchor IDL from [`raydium-io/raydium-idl`](https://github.com/raydium-io/raydium-idl) | `packages/sdk/idl/raydium_launchpad.json` |
| CPMM (`raydium_cp_swap` 0.2.0) | Anchor IDL from `raydium-io/raydium-idl`, Rust source from [`raydium-io/raydium-cp-swap`](https://github.com/raydium-io/raydium-cp-swap) | `packages/sdk/idl/raydium_cp_swap.json`, `vendor/raydium/cp-swap-src/` |
| Burn & Earn | Instruction layout from Raydium's public SDK; discriminators re-derived | `packages/sdk/src/raydium/lock.ts` |

Exact commits are recorded in [`vendor/raydium/README.md`](../../vendor/raydium/README.md).

The SDK reads the IDL JSON at runtime (`IdlCoder`). Account layouts,
discriminators and **instruction account order** therefore come straight from
the published interface instead of being retyped by hand. The test suite
asserts that every discriminator equals `sha256("global:<ix>")[..8]` /
`sha256("account:<Account>")[..8]`.

## LaunchLab

### PDAs

| Account | Seeds |
| --- | --- |
| Vault authority | `"vault_auth_seed"` → `WLHv2UAZ…VVh` |
| Event authority | `"__event_authority"` |
| Global config | `"global_config", quote_mint, u8 curve_type, u16le index` |
| Platform config | `"platform_config", platform_admin` |
| Pool | `"pool", base_mint, quote_mint` |
| Pool vault | `"pool_vault", pool, mint` |
| Vesting record | `"pool_vesting", pool, beneficiary` |
| Platform fee vault | `platform_config, quote_mint` |
| Platform fee vault authority | `"platform_fee_vault_auth_seed"` |
| Creator fee vault | `creator, quote_mint` |
| Creator fee vault authority | `"creator_fee_vault_auth_seed"` |

### Accounts

| Account | Key fields |
| --- | --- |
| `PoolState` | `status`, `supply`, `total_base_sell`, `virtual_base/quote`, `real_base/quote`, `total_quote_fund_raising`, `platform_fee`, `quote_protocol_fee`, `global_config`, `platform_config`, `base/quote_mint`, `base/quote_vault`, `creator` |
| `GlobalConfig` | `curve_type`, `trade_fee_rate`, `max_share_fee_rate`, `migrate_fee`, `quote_mint` |
| `PlatformConfig` | `platform_fee_wallet`, `fee_rate`, `creator_fee_rate`, `platform_scale`, `creator_scale`, `burn_scale`, `cpswap_config`, `name`, `web`, `img` |

### Instructions used

| Instruction | SDK helper | Signer |
| --- | --- | --- |
| `buy_exact_in` | `launchLab.buyExactInIx` | trader |
| `sell_exact_in` | `launchLab.sellExactInIx` | trader |
| `claim_platform_fee` | `launchLab.claimPlatformFeeIx` | `platform_fee_wallet` |
| `claim_platform_fee_from_vault` | `launchLab.claimPlatformFeeFromVaultIx` | `platform_fee_wallet` |
| `claim_creator_fee` | `launchLab.claimCreatorFeeIx` | creator |

The fee-claim instructions need the platform fee wallet's or the creator's
signature. They are included so platform operators and creators can claim
their own LaunchLab fees. Float's own cycling runs through the Float program.

### Curve math (constant product)

```text
reserve_base  = virtual_base − real_base
reserve_quote = virtual_quote + real_quote

buy_exact_in(Δq):
  fee  = ceil(Δq · total_rate / 1e6)
  Δb   = floor((Δq − fee) · reserve_base / (reserve_quote + Δq − fee))
  if Δb > total_base_sell − real_base: cap Δb, gross-up Δq   (graduating buy)

sell_exact_in(Δb):
  gross = floor(Δb · reserve_quote / (reserve_base + Δb))
  fee   = ceil(gross · total_rate / 1e6)
  out   = gross − fee

split(fee): platform = fee·platform_rate/total, creator = fee·creator_rate/total,
            share = fee·share_rate/total, protocol = remainder
```

### Events

Trades emit `TradeEvent` through Anchor's event CPI. `launchLab.decodeTradeEvent(innerIxData)`
decodes it (tag `e445a52e51cb9a1d` followed by the event discriminator). It
reports `protocol_fee`, `platform_fee`, `creator_fee` and `share_fee` per
trade, which is the most precise source for per-trade fee accounting.

## CPMM

### PDAs

| Account | Seeds |
| --- | --- |
| Authority | `"vault_and_lp_mint_auth_seed"` → `GpMZbSM2…bL` |
| AMM config | `"amm_config", u16be index` |
| Pool | `"pool", amm_config, token_0_mint, token_1_mint` (mints sorted by bytes) |
| LP mint | `"pool_lp_mint", pool` |
| Vault | `"pool_vault", pool, mint` |
| Observation | `"observation", pool` |
| Creator fee share | `"creator_fee_share", creator, amm_config` |

### Swap math

`cpmm.swapBaseInput` is a line-by-line port of
`curve/calculator.rs::CurveCalculator::swap_base_input`:

```text
if creator fee on input:
  total_fee   = ceil(in · (trade_rate + creator_rate) / 1e6)
  creator_fee = floor(total_fee · creator_rate / (trade_rate + creator_rate))
  trade_fee   = total_fee − creator_fee
  in_net      = in − total_fee
else:
  trade_fee   = ceil(in · trade_rate / 1e6)
  in_net      = in − trade_fee
protocol_fee  = floor(trade_fee · protocol_rate / 1e6)
fund_fee      = floor(trade_fee · fund_rate / 1e6)
out           = floor(in_net · R_out / (R_in + in_net))
if creator fee on output: creator_fee = ceil(out · creator_rate / 1e6); out −= creator_fee
```

Reserves exclude fees that are owed but not yet collected
(`vault − protocol_fees − fund_fees − creator_fees`); see `cpmm.tradableReserves`.
`creator_fee_on`: `0` both tokens (input side), `1` token_0 only, `2` token_1 only.

### Instructions used

| Instruction | SDK helper | Notes |
| --- | --- | --- |
| `swap_base_input` | `cpmm.swapBaseInputIx` | From the IDL |
| `collect_creator_fee` | `cpmm.collectCreatorFeeIx` | Signed by `pool_creator` |
| `collect_creator_fee_permissionless` | `cpmm.collectCreatorFeePermissionlessIx` | In the Rust source, not in the published IDL; the fee always goes to the pool creator. Simulate first |

## Burn & Earn

| Item | Value |
| --- | --- |
| Authority | `"lock_cp_authority_seed"` → `3f7GcQFG…xH` |
| Locked liquidity state | `"locked_liquidity", nft_mint` |
| Locked LP vault | ATA(authority, lp_mint) |
| `lock_cp_liquidity` | `d89d1d4e26331f1a` |
| `collect_cp_fees` | `081e33c7d1b8f785` + `u64 lp_fee_amount` |

`burnAndEarn.collectCpFeesIx` builds the 18-account harvest instruction for the
holder of a position NFT.
