# Trader airdrops

**35%** of platform fees go to traders. The share is converted to **USDC**,
held in the trader airdrop vault (`JEK3WrPuiePy8vYmzN7Xfk6YoMChbsiqzBs7X43y3snH`)
and **airdropped to the wallets that traded Float coins, proportional to
volume**.

The live leaderboard is on the [Analytics](https://www.floatlaunch.xyz/analytics) page.

## Schedule

| Airdrop | Snapshot | Who qualifies | Volume window |
| --- | --- | --- | --- |
| #1 | **Nov 4, 2026, 17:00 UTC** | Top **100** wallets | Since launch |
| #2 | **Nov 11, 2026, 17:00 UTC** (11:00 AM CST) | Top **250** wallets | Since the first snapshot |
| Later | Announced on X | | |

## What counts

- **Volume** on Float coins: buys and sells, on the curve and after graduation.
- Within a round, each qualifying wallet's share of the round's USDC is its
  volume divided by the total volume of the qualifying wallets.

## What doesn't count

| Excluded | Rule |
| --- | --- |
| **Bots** | More than **300 trades in any single hour**, **or** more than **100 trades an hour in 5 or more different hours** |
| **Wash trading** | Volume from wash trading |
| **New pairs (first 7 days)** | Coins on a newly added pair count toward airdrop volume **7 days after the pair is added** |

The bot rule applies to the wallet as a whole. A wallet that trips it is
excluded from the round entirely, not just for the busy hours.

```ts
import { checkBot } from "@float-community/sdk";
checkBot(myTrades);
// { isBot: false, maxTradesInHour: 87, busyHourCount: 0 }
```

## Rank an airdrop yourself

Export trades (from your indexer of choice) to CSV:

```csv
wallet,coin,pair,side,timestamp,volume_usd
<wallet>,PEPE,SOL,buy,2026-11-05T14:02:11Z,1250.40
```

Then:

```bash
npm run float -- airdrop --trades trades.csv --round 2 --pot 25000 \
  --pairs-added pairs-added.csv
```

```text
Round 2 — snapshot 2026-11-11T17:00:00.000Z, top 250, window from 2026-11-04T17:00:00.000Z

rank  wallet          volumeUsd  trades  usdc
----  --------------  ---------  ------  -----------
1     …               2638.50    2       22369.648…
2     …               310.25     1       2630.351…

Excluded: 0 bot wallets, $1278.90 wash volume, $0.00 new-pair volume
```

The CLI's wash-trade filter is a conservative stand-in: same wallet, same coin,
opposite sides, within 60 s, sizes within 2%. Float's production filter isn't
published, so expect small differences from the official leaderboard. You can
plug in your own filter with `rankTraders(trades, { washFilter })`.

## Receiving the airdrop

Airdrops are sent in USDC to the qualifying wallet. You don't need to claim
anything.
