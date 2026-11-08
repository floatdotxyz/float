# FAQ

## Do I need to buy on Float to get holder rewards?

No. Payouts go to whoever holds the coin at payout time, wherever they bought.

## Why haven't I received a payout?

Usually one of these:

- You don't have a token account for the coin's paired token yet, and you're
  owed less than $2. The bot creates the account once you're owed at least $2;
  until then your share rolls over.
- You sold before the payout. What was still owed returned to the coin's holders.
- The coin's fees haven't been cycled recently. Press **Cycle fees** on its page.
- The paired token's issuer has paused it. Rewards stop during a pause.

Check with `npm run float -- payouts --wallet <your-wallet>`.

## What token are rewards paid in?

Holder and creator rewards are paid in the coin's **paired token**. Trader
airdrops are in **USDC**. The flagship share buys **$FLOAT** and burns it.

## How often are holders paid?

The payout bot runs every few minutes.

## Who can press "Cycle fees"? Do I get anything for it?

Anyone. The proceeds always go through the split, not to the caller.

## How much does launching a coin cost?

A new ticker is free. Reusing an already launched ticker costs 1 SOL to the
treasury, refunded if the coin graduates within 48 hours of launch. This
applies to coins launched from Nov 4, 2026 at 10:01 PM CST.

## Are `$PEPE` and `$pepe` different tickers?

No. Tickers are case-insensitive.

## When are trader airdrops?

The first was on Nov 4, 2026 at 17:00 UTC (top 100 wallets by volume since
launch). The second is on Nov 11, 2026 at 17:00 UTC (top 250 wallets by volume
since the first snapshot). Later timing is announced on X.

## Why was my wallet excluded from the airdrop?

Wallets with more than 300 trades in any hour, or more than 100 trades an hour
in 5 or more different hours, are treated as bots. Wash-trading volume is
excluded. Volume on newly added pairs only counts 7 days after the pair is added.

## Does $FLOAT get a share of its own trading fees?

No. $FLOAT's own trading fees go to the Float dev wallet.

## Why are XBTC / XHYPE buyback and airdrop shares stuck?

There is no Raydium pool from those tokens into SOL or USDC yet, so they can't
be converted. They wait in the vaults until a route exists.

## Is the Float program audited?

No. Its upgrade authority is held by the team's deployer key until it moves to
a multisig. See [Risks](risks.md).

## Is a coin paired with a tokenized stock a share of the company?

No. Coins are not shares, and Float is not affiliated with the companies
behind the stocks.

## Is this repository official?

No. It is a community project. The official docs are at
<https://www.floatlaunch.xyz/docs>.
