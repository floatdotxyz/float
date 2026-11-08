# Tickers

## Format

- **1 to 10 letters or numbers** (`A–Z`, `a–z`, `0–9`). No spaces, dashes or symbols.
- **Case-insensitive**: `$Pepe`, `$pepe` and `$PEPE` are the same ticker.
- The leading `$` is display only.

```ts
import { normalizeTicker, isValidTicker } from "@float-community/sdk";
normalizeTicker("$Pepe");      // "PEPE"
isValidTicker("ROCKET2026");   // true  (10 chars)
isValidTicker("TO-THE-MOON");  // false
```

## Cost

| Situation | Cost |
| --- | --- |
| Ticker never launched on Float | **Free** |
| Ticker already launched | **1 SOL**, sent to the treasury |
| …and the new coin graduates within 48 hours of launch | **1 SOL refunded** to the launcher |

Each ticker can be launched **once for free**. Every later launch with the same
ticker pays the reuse fee.

The reuse fee applies to coins launched from **Nov 4, 2026 at 10:01 PM CST**
(2026-11-05 04:01 UTC). Coins launched before that are unaffected.

```text
$ npm run float -- ticker '$pepe' --taken PEPE,DOGE
Ticker:   $PEPE
Status:   already launched
Cost:     1 SOL (to treasury)
Refund:   yes, if the coin graduates within 48 hours of launch
```

Check whether a paid launch has been or still can be refunded:

```bash
npm run float -- ticker PEPE --taken PEPE --launched 2026-11-06T12:00:00Z
# Refund window left: 31.4 h

npm run float -- ticker PEPE --taken PEPE --launched 2026-11-06T12:00:00Z --graduated 2026-11-07T20:00:00Z
# Refunded: yes
```

## In the SDK

```ts
import { launchCost, isReuseFeeRefunded } from "@float-community/sdk";

launchCost("pepe", ["PEPE", "DOGE"]);
// { ticker: "PEPE", taken: true, feeLamports: 1000000000n, refundable: true }

isReuseFeeRefunded(new Date("2026-11-06T12:00:00Z"), new Date("2026-11-08T11:59:00Z")); // true
```
