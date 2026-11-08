# Pairs

A coin's **paired token** is the token it trades against on its curve and
pool. Holders and the creator are **paid in that token**. Pick it carefully:
every pair has different risks.

| Family | Examples | What to know |
| --- | --- | --- |
| Native | SOL | Paid as wrapped SOL; unwrap it on the Profile page |
| Stable | USDC | The traders' share needs no conversion |
| Tokenized stocks | third-party stock tokens | Issuer can pause, move or burn tokens and change transfer rules |
| Pre-IPO | PreStocks, Tessera | Transfer fees: **1%** (PreStocks), **0.2%** (Tessera) |
| Bridged | ZEC, XMR | Bridged to Solana; **XMR pools are thinner**, so large trades move its price more |
| Leveraged (Hylo) | xSOL, XBTC, XHYPE | Move several times more than the underlying; XBTC and XHYPE have no Raydium pool into SOL or USDC yet |

## Tokenized stocks

Tokenized stocks are issued by third parties. The issuer controls the token
and can:

- **pause** transfers: while paused, the coin can't trade and **rewards stop**;
- **move or burn** tokens;
- **change transfer rules**.

Float is not affiliated with or endorsed by the companies behind the stocks.
**Coins are not shares.** Holding a coin paired with a tokenized stock gives
you no rights in the company.

## Pre-IPO tokens and transfer fees

Some pre-IPO tokens charge a fee on **every transfer**, including the payouts
you receive and the swaps made during fee cycling:

| Issuer | Transfer fee |
| --- | ---: |
| PreStocks | 1% |
| Tessera | 0.2% |

```ts
import { afterTransferFee } from "@float-community/sdk";
afterTransferFee(10_000n, 100); // 9_900n  — PreStocks
afterTransferFee(10_000n, 20);  // 9_980n  — Tessera
```

For Token-2022 mints the SDK reads the fee from the mint itself
(`decodeMint(...).transferFee`, `transferFeeFor(mint, amount)`).

## Bridged tokens

ZEC and XMR on Solana are **bridged** representations, so they also carry
the bridge's risk. XMR liquidity is thinner, and large trades move its price
more.

## Leveraged tokens (Hylo)

xSOL, XBTC and XHYPE are **leveraged** Hylo tokens. They move several times
more than SOL, BTC and HYPE.

XBTC and XHYPE **don't have a Raydium pool into SOL or USDC** yet. Their
flagship (buyback) and traders (airdrop) shares can't be converted, so they
**wait in the vaults** until a route exists. Holder and creator shares are paid
in the token itself and are unaffected.

## Newly added pairs and airdrops

Volume on coins with a **newly added pair** starts counting toward trader
airdrops **7 days after the pair is added**. See [Trader airdrops](../rewards/traders.md).

## Finding a coin's paired token

The coin's LaunchLab pool records it as `quote_mint`:

```bash
npm run float -- inspect <launchlab-pool-address>
```
