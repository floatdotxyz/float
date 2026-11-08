# What is Float

Float is a coin launcher on Solana. Anyone can launch a coin from the
[Create](https://www.floatlaunch.xyz/create) page. The coin trades on a
bonding curve at first and then graduates to a regular Raydium pool. What
makes Float different is what happens to the trading fees.

On most launchpads the platform keeps its fee. On Float, the platform fee of
every coin is **split five ways**:

| Share | Goes to | Paid in |
| --- | --- | --- |
| 15% | **Holders** of that coin, pro rata to how much they hold | the coin's paired token |
| 5% | the **creator**, at the wallet chosen at launch | the paired token |
| 35% | **Flagship**: buys back and burns $FLOAT | SOL → $FLOAT |
| 35% | **Traders**: airdropped to the top wallets by volume | USDC |
| 10% | the platform **treasury** | the paired token |

Holding a Float coin therefore earns a stream of its paired token (SOL, USDC,
a tokenized stock…). The stream is paid automatically every few minutes,
wherever you bought the coin. Trading Float coins also earns a share of the
periodic USDC airdrops. Every coin's activity feeds the $FLOAT buyback.

## Building blocks

Float doesn't run its own AMM. It builds on Raydium's public, open-source
programs:

- **Raydium LaunchLab** runs the bonding curve each coin starts on. Float has its
  own platform configuration and fee tiers on LaunchLab.
- **Raydium CPMM** is the constant-product pool a coin migrates to when it
  graduates.
- **Raydium Burn & Earn** permanently locks the graduated pool's liquidity
  while the trading fees it earns can still be claimed.
- The **Float program** (`3KguFi7Y…JTqxX`) and a set of Float-controlled vaults
  and bots take the fees out of Raydium ("cycling") and route them through the split.

See [Architecture](../developers/architecture.md) for the full flow and
[Contracts](../contracts.md) for every address.

## $FLOAT

$FLOAT is the flagship token. It is not launched with special privileges.
What makes it the flagship is that 35% of the platform fees from **every**
coin on Float are used to buy it back and burn it on chain. Every buyback is
listed on the [Burns](https://www.floatlaunch.xyz/burns) page.

$FLOAT's own trading fees go to the Float dev wallet and are not split this way.

## Before you start

Coins on Float are highly speculative and you can lose everything. Read
[Risks](../risks.md) first. It covers third-party issuers of tokenized stocks,
transfer fees, bridged and leveraged pairs, and the fact that the Float program
has not been audited.
