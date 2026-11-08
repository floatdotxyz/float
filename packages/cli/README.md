# @float-community/cli

`float`, a command-line tool for Float coins on Solana. *Unofficial; not
affiliated with the Float team.*

```bash
npm run float -- help                 # from the repository root
npm link -w packages/cli && float help  # or install the `float` command globally
```

| Command | Does |
| --- | --- |
| `addresses` | Float + Raydium addresses with Solscan links |
| `split <amount>` | Five-way fee split of an amount |
| `ticker <T>` | Ticker validity, launch cost, refund window |
| `pool <mint>` | Curve status, progress, fee rates, CPMM pool once graduated |
| `quote buy\|sell <mint> <amt>` | Curve quote with fee breakdown |
| `cycle <mint>` | Pending fees and how a cycle would route them |
| `inspect <addr>` | Decode LaunchLab / CPMM / SPL accounts |
| `holders <mint>` | Holder snapshot and reward shares |
| `burns` | $FLOAT buyback burns |
| `payouts [--wallet]` | Holder payouts from the payout bot |
| `airdrop --trades f.csv` | Airdrop ranking and USDC allocation |
| `buyback <sol>` | ≤ 1%-impact buyback plan |
| `buy` / `sell` | Bonding-curve trades: simulate, or `--send` |

Reference: [`docs/developers/cli.md`](../../docs/developers/cli.md).
