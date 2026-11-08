# Trading Float coins

You can trade a Float coin on its page on floatlaunch.xyz or anywhere that
routes to its Raydium pool: Raydium itself, Jupiter and other aggregators,
wallets with built-in swaps.

**Holder rewards are paid wherever you bought.** The payout bot pays whoever
holds the coin at payout time. It does not track where you bought.

## Before graduation: the bonding curve

Until a coin graduates, it trades on its Raydium LaunchLab bonding curve.

- Price rises as the curve sells and falls as coins are sold back.
- Each trade pays a fee in the paired token, taken from the input on buys and
  from the output on sells. The fee is the sum of LaunchLab's protocol rate,
  Float's platform rate and the creator rate. Float's split applies to the
  platform part.
- The buy that sells out the curve is capped at the remaining allocation and
  graduates the coin.

Quote a curve trade with the full fee breakdown:

```bash
npm run float -- quote buy <coin-mint> 1      # spend 1 unit of the paired token
npm run float -- quote sell <coin-mint> 1000000
```

## After graduation: Raydium CPMM

A graduated coin trades on a constant-product Raydium CPMM pool. The CPMM
trade fee rate comes from the pool's AMM config. Float's share keeps arriving
through the pool's creator fee and the locked-liquidity fee position.

## Trading from the CLI

The CLI can build, simulate and send curve trades with a local keypair file:

```bash
# simulate (default)
npm run float -- buy <coin-mint> 0.5 --keypair ~/.config/solana/id.json

# broadcast
npm run float -- buy <coin-mint> 0.5 --keypair ~/.config/solana/id.json --send --slippage-bps 150
```

For SOL pairs the CLI wraps exactly the SOL needed, buys, and closes the
temporary wSOL account in the same transaction.

## Things that affect what you receive

- **Slippage and price impact.** Thin curves and pools move a lot on large orders.
- **Issuer transfer fees.** Some pre-IPO paired tokens charge a fee on every
  transfer: 1% for PreStocks and 0.2% for Tessera.
- **Issuer pauses.** Tokenized-stock issuers can pause their tokens. While
  paused, the coin can't trade and rewards stop.

See [Risks](../risks.md).

## Airdrop eligibility

Trading volume on Float coins counts toward [trader airdrops](../rewards/traders.md).
Bot-like activity and wash trading are excluded.
