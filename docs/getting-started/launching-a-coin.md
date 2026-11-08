# Launching a coin

Coins are launched from the [Create](https://www.floatlaunch.xyz/create) page.

## What you choose at launch

| Field | Notes |
| --- | --- |
| **Ticker** | 1–10 letters or numbers, case-insensitive. See [Tickers](../mechanics/tickers.md). |
| **Name and metadata** | Passed to LaunchLab as `MintParams { decimals, name, symbol, uri }` and written to the token's Metaplex metadata at launch. |
| **Paired token** | The quote token the coin trades against and the token holders are paid in: SOL, USDC, tokenized stocks and more. See [Pairs](../mechanics/pairs.md). |
| **Creator wallet** | The wallet that receives the creator's 5% of fees, in the paired token. It does not need to be the wallet that pays for the launch. |

## What it costs

- **A new ticker is free to launch.** You only pay normal Solana network fees
  and rent for the accounts LaunchLab creates.
- **Reusing a ticker that has already been launched costs 1 SOL**, which is
  sent to the treasury. If your coin graduates within 48 hours of launch, the
  1 SOL is refunded. This applies to coins launched from Nov 4, 2026 at
  10:01 PM CST.

Check a ticker before launching:

```bash
npm run float -- ticker '$MYCOIN' --taken PEPE,DOGE
```

## What happens on chain

1. LaunchLab `initialize` creates the coin's mint, its metadata and a
   bonding-curve pool. The pool uses Float's platform config and fee tier.
2. The coin trades on the curve. Every buy and sell pays a fee in the paired
   token, and LaunchLab splits it into protocol, platform and creator buckets.
   The platform bucket is what Float's split is made of.
3. When the curve is sold out, the coin **graduates**. LaunchLab migrates the
   raised liquidity into a Raydium CPMM pool and locks the LP through Burn & Earn.
4. From then on the coin trades on CPMM. Its fees keep reaching Float through
   the CPMM creator fee and the Burn & Earn fee position. They are still split
   the same way.

See [Bonding curve & graduation](../mechanics/bonding-curve.md) for the
details.

## After launch

- Share the coin's page. Holders earn from the first trade.
- Fees sit in Raydium's vaults until they are [cycled](../mechanics/fee-cycling.md).
  The payout bot cycles automatically, and anyone can press **Cycle fees** on
  the coin's page.
- Your 5% arrives at the creator wallet in the paired token every time the
  coin's fees are cycled.

> [!NOTE]
> Other apps can launch coins on Float's LaunchLab fee tiers, but those coins
> don't get Float's split or rewards. Launch from Float to get them.
