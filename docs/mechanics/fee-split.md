# Fee split

Every Float coin's platform fees are split into five buckets:

| Bucket | Share | Paid in | Where it goes |
| --- | ---: | --- | --- |
| **Holders** | 15% | Paired token | The coin's holders, pro rata to holdings ([details](../rewards/holders.md)) |
| **Creator** | 5% | Paired token | The wallet the creator chose at launch |
| **Flagship** | 35% | SOL → $FLOAT | Buys back and burns $FLOAT ([details](../rewards/flagship.md)) |
| **Traders** | 35% | USDC | Airdropped to top traders by volume ([details](../rewards/traders.md)) |
| **Treasury** | 10% | Paired token | Funds the platform |
| | **100%** | | |

The holders' 15% is what remains after the other four buckets (5 + 35 + 35 + 10 = 85).

## Worked example

A coin paired with SOL accumulates **12.5 SOL** of platform fees. When it is
cycled:

```text
$ npm run float -- split 12.5
bucket    share  amount     paidAs
--------  -----  ---------  ---------------------
Holders   15%    1.875 SOL  Paired token
Creator   5%     0.625 SOL  Paired token
Flagship  35%    4.375 SOL  SOL → $FLOAT (burned)
Traders   35%    4.375 SOL  USDC
Treasury  10%    1.25 SOL   Paired token
```

For a USDC-paired coin, the flagship share is swapped from USDC to SOL first
and the traders' share is already in USDC. For other pairs, both conversions
go through Raydium pools. See [Pairs](pairs.md) for pairs with no route yet.

## What "platform fee" means here

A trade on a Float coin pays several fees. Only one of them is split:

| Fee | Charged by | Split by Float? |
| --- | --- | --- |
| LaunchLab protocol fee (`GlobalConfig.trade_fee_rate`) | Raydium | No, it goes to Raydium |
| **Platform fee** (`PlatformConfig.fee_rate`) on the bonding curve | Float's LaunchLab platform | **Yes** |
| Fees reaching Float from the graduated CPMM pool and its locked liquidity | Raydium CPMM / Burn & Earn | **Yes** |
| Issuer transfer fees on some paired tokens | Token issuer | No |
| Solana network and priority fees | Validators | No |

## Rounding

The SDK floors each bucket and assigns the rounding remainder (at most a few
base units) to the treasury, so the parts always add up to the input. On-chain
rounding may differ by a few base units.

```ts
import { splitFees } from "@float-community/sdk";
splitFees(1_000_000_007n);
// { holders: 150000001n, creator: 50000000n, flagship: 350000002n, traders: 350000002n, treasury: 100000002n }
```

## Exceptions

- **$FLOAT itself.** $FLOAT's own trading fees go to the Float dev wallet, not
  to this split.
- **Coins launched by other apps.** Other apps can launch on Float's LaunchLab
  fee tiers, but those coins don't get Float's split or rewards.
- **Pairs without a route.** For XBTC and XHYPE there is no Raydium pool into
  SOL or USDC yet. Their flagship and trader shares wait in the vaults until
  one exists.
