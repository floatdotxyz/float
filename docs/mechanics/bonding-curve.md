# Bonding curve & graduation

Every Float coin starts on a **Raydium LaunchLab** bonding curve and, once the
curve sells out, **graduates** to a Raydium CPMM pool.

## The curve

LaunchLab supports constant-product, fixed-price and linear curves
(`GlobalConfig.curve_type` 0 / 1 / 2). Each pool has:

| Field (`PoolState`) | Meaning |
| --- | --- |
| `supply` | Total supply of the coin |
| `total_base_sell` | How many coins the curve sells before graduating |
| `total_quote_fund_raising` | Paired-token amount raised at graduation |
| `virtual_base`, `virtual_quote` | Virtual reserves that define the starting price |
| `real_base`, `real_quote` | Coins sold and paired tokens raised so far |
| `status` | `0` funding · `1` waiting for migration · `2` migrated |
| `platform_fee` | Platform fees earned on the curve and not yet claimed |

For the constant-product curve, the price is

```text
price = (virtual_quote + real_quote) / (virtual_base − real_base)
```

and a buy of `Δq` paired tokens, after fees, returns

```text
Δb = Δq · (virtual_base − real_base) / (virtual_quote + real_quote + Δq)
```

Curve progress is `real_quote / total_quote_fund_raising`:

```bash
npm run float -- pool <coin-mint>
```

```json
{
  "stage": "bonding",
  "bondingProgress": "41.20%",
  "raised": "35.02 / 85",
  "feeRates": { "protocol": "0.250%", "platform": "…", "creator": "…" }
}
```

## Fees on the curve

LaunchLab charges one combined fee on every curve trade and splits it
pro rata between its buckets:

```text
total_rate = protocol_rate + platform_rate + creator_rate (+ share_rate)
fee        = ceil(amount × total_rate / 1_000_000)
platform   = fee × platform_rate / total_rate      ← this is what Float splits
```

On buys the fee is taken from the paired-token input. On sells it is taken
from the paired-token output.

## Graduation

The buy that would take more than the remaining `total_base_sell − real_base`
is capped at exactly the remainder. This completes the curve (`status → 1`).
LaunchLab then migrates the pool:

1. `migrate_to_cpswap` creates a **Raydium CPMM** pool with the raised paired
   tokens and the coins reserved for liquidity. It uses the CPMM config
   referenced by Float's platform config (`PlatformConfig.cpswap_config`).
2. The new LP is handled according to the platform's `burn_scale`,
   `platform_scale` and `creator_scale`. Burned LP is gone for good. The
   platform and creator portions are locked in **Burn & Earn**, which issues
   fee-bearing position NFTs.
3. The LaunchLab pool moves to `status = 2` and trading continues on CPMM.

The CPMM pool's address can be derived:

```ts
import { cpmm } from "@float-community/sdk";
const [m0, m1] = cpmm.sortMints(coinMint, pairedMint);
const pool = cpmm.cpmmPda.pool(platformConfig.cpswap_config, m0, m1);
```

## Why graduation matters for tickers

If you paid the 1 SOL ticker reuse fee, it is refunded when your coin
graduates within 48 hours of launch. See [Tickers](tickers.md).
