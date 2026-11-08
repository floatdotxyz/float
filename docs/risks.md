# Risks

Read this before launching, buying or holding a Float coin.

## Markets

- **Coins are highly speculative. You can lose everything.**
- Site prices and stats can be **delayed or wrong**. Check on-chain data for
  anything that matters.

## Paired tokens

- **Tokenized stocks are issued by third parties**, who can **pause, move or
  burn** tokens and **change transfer rules**. **Trading and rewards stop while
  an issuer pauses.**
- Float is **not affiliated with or endorsed by** the companies behind the
  stocks. **Coins are not shares.**
- Some **pre-IPO tokens charge transfer fees**: **1%** (PreStocks) and **0.2%**
  (Tessera). The fee applies to payouts and swaps too.
- **ZEC and XMR on Solana are bridged tokens.** **XMR pools are thinner**, so
  large trades move its price more.
- **xSOL, XBTC and XHYPE are leveraged Hylo tokens** that move several times
  more than their underlying assets. **XBTC and XHYPE lack a Raydium pool into
  SOL or USDC**, so their **buyback and airdrop shares wait in vaults** until
  one exists.

See [Pairs](mechanics/pairs.md).

## Smart contracts

- **The Float program has not been audited.**
- **Upgrade authority** over the Float program is held by **the team's deployer
  key**, until it moves to a multisig. An upgradeable program can be changed.
- Float builds on Raydium LaunchLab, CPMM and Burn & Earn. Their risks apply too.

Check the program's current upgrade authority yourself on
[Solscan](https://solscan.io/account/3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX),
or with the Solana CLI:

```bash
solana program show 3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX
```

## Fee cycling

- Fee cycling uses a **price guard**, but a trader can capture **up to about 2%
  of a swap** by moving the price beforehand.
- **Some tokens are swapped only by the payout bot** on older Raydium pools.

See [Fee cycling](mechanics/fee-cycling.md).

## Other apps

- **Other apps can launch coins on Float's LaunchLab fee tiers, but those coins
  don't get Float's split or rewards.** A coin's LaunchLab `platform_config`
  being Float's does not mean it was launched on Float.

## This repository

This is an **unofficial** community project. The SDK and CLI are provided
as-is, under the MIT license and with no warranty. Always simulate
transactions before sending them. The CLI simulates by default.
