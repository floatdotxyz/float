# Contracts & addresses

All addresses are on **Solana mainnet**. Open any of them on Solscan:
`https://solscan.io/account/<address>`.

```bash
npm run float -- addresses        # same list, with links
```

## Float

| Name | Address | Role |
| --- | --- | --- |
| Float program | [`3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX`](https://solscan.io/account/3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX) | On-chain program: fee cycling and routing |
| Float config | [`AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV`](https://solscan.io/account/AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV) | Configuration account |
| $FLOAT (flagship) | [`Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr`](https://solscan.io/account/Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr) | Flagship token mint |
| Buyback & burn vault | [`8CskoMx4FaXjp7gzxNzaWQXGXGVBWYnNWXGcisXuDYAa`](https://solscan.io/account/8CskoMx4FaXjp7gzxNzaWQXGXGVBWYnNWXGcisXuDYAa) | Flagship share → $FLOAT buybacks and burns |
| Trader airdrop vault | [`JEK3WrPuiePy8vYmzN7Xfk6YoMChbsiqzBs7X43y3snH`](https://solscan.io/account/JEK3WrPuiePy8vYmzN7Xfk6YoMChbsiqzBs7X43y3snH) | Traders' share in USDC |
| Holder payout bot | [`6LYfrwR67XS8zJPxD2PTEHKocr3d2MBgkZX8umGTfw6E`](https://solscan.io/account/6LYfrwR67XS8zJPxD2PTEHKocr3d2MBgkZX8umGTfw6E) | Sends holder payouts, cycles fees |
| Treasury | [`2LMWFmbGBfw78ZEas2NFmAYfo4bhyBqYboYh9nk3mDFQ`](https://solscan.io/account/2LMWFmbGBfw78ZEas2NFmAYfo4bhyBqYboYh9nk3mDFQ) | Treasury share, ticker reuse fees |

## Raydium

| Name | Address | Role |
| --- | --- | --- |
| Raydium LaunchLab | [`LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`](https://solscan.io/account/LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj) | Bonding-curve launchpad every coin starts on |
| Raydium CPMM | [`CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`](https://solscan.io/account/CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C) | Constant-product AMM graduated coins trade on |
| Raydium Burn & Earn | [`LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE`](https://solscan.io/account/LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE) | Locks CPMM liquidity, keeps its fees claimable |

### Derived Raydium authorities

These PDAs own the Raydium vaults. The test suite derives them from the
program IDs and seeds:

| PDA | Seeds | Address |
| --- | --- | --- |
| LaunchLab vault authority | `["vault_auth_seed"]` | `WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh` |
| CPMM vault & LP authority | `["vault_and_lp_mint_auth_seed"]` | `GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL` |
| Burn & Earn authority | `["lock_cp_authority_seed"]` | `3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH` |

## Common tokens & programs

| Name | Address |
| --- | --- |
| Wrapped SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| Associated Token Account | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` |

## Program status

- The Float program **has not been audited**.
- Its **upgrade authority is the team's deployer key** until it moves to a
  multisig.

There is no public source repository or IDL for the Float program. Everything
this repository builds goes through the public Raydium programs and standard
SPL instructions. See the [Raydium integration reference](developers/raydium-integration.md).

## Verifying an address

```bash
npm run float -- inspect AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV
```

`inspect` prints the owner program and size of any account. It decodes the
account when it is a LaunchLab, CPMM or SPL account.
