# Auditing Float yourself

Every number that matters can be checked from public chain data. This page
shows how.

## 1. Are the addresses what they claim to be?

```bash
npm run float -- inspect 3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX   # executable program
npm run float -- inspect Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr   # $FLOAT mint: supply, decimals, authorities
solana program show 3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX        # upgrade authority
```

Check the $FLOAT mint's `mintAuthority`. If it is `null`, no new $FLOAT can be
minted and burns permanently reduce supply.

## 2. Is a coin really a Float coin?

Find its LaunchLab pool and look at `platform_config`:

```bash
npm run float -- pool <coin-mint>
```

Being on Float's LaunchLab platform config is necessary but **not sufficient**.
Other apps can launch on Float's fee tiers without getting Float's split or
rewards. The coin should also appear on [floatlaunch.xyz/tokens](https://www.floatlaunch.xyz/tokens).

## 3. Are fees being split 15 / 5 / 35 / 35 / 10?

Pick a cycle transaction (any transaction from the payout bot that touches a
coin's Raydium vaults) and compare the outgoing transfers:

1. The claimed amount out of the Raydium vault.
2. The transfers to the buyback vault, airdrop vault, treasury and creator
   wallet, and the amount kept for holders.

`splitFees(claimed)` gives the expected amounts to within a few base units.
Transfer-fee pairs (PreStocks 1%, Tessera 0.2%) reduce each leg by the
issuer's fee.

## 4. Are holders being paid?

```bash
npm run float -- payouts --limit 500 --summary
npm run float -- payouts --wallet <wallet>
```

To check a specific wallet's share, snapshot the holders and run the reference
model with the same payout amount:

```bash
node examples/simulate-payout-round.ts <coin-mint> <amount-raw> <usd-per-raw-unit> [paired-mint]
```

Remember that owed amounts under $2 roll over for wallets without a token
account, and that selling forfeits unpaid amounts.

## 5. Are buybacks within the 1% cap, and burned?

```bash
npm run float -- burns --limit 200
```

For any buy, read the $FLOAT pool's reserves just before the transaction and
run `cpmm.swapBaseInput` with the buy size. `priceImpact` should be ≤ 0.01.

## 6. Does the airdrop leaderboard add up?

Export trades on Float coins for the round's window from an indexer, then:

```bash
npm run float -- airdrop --trades trades.csv --round 2 --pot <usdc-airdropped>
```

Compare with the Analytics leaderboard. Differences usually come from
wash-trade detection, since the official filter is not public.

## Reporting a discrepancy

If on-chain data contradicts the official docs, report it to the Float team
through their official channels. For problems with this repository's tools,
open an issue here with the transaction signatures involved.
