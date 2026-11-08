# Operational scripts

All scripts are TypeScript, run natively by Node ≥ 22.18, and **simulate by
default**. Pass `--send` to broadcast. Common flags:

| Flag / env | Meaning |
| --- | --- |
| `--rpc` / `SOLANA_RPC_URL` | RPC endpoint |
| `--keypair` / `FLOAT_KEYPAIR` | Signer keypair file (default `~/.config/solana/id.json`) |
| `--program-id` / `FLOAT_ROUTER_PROGRAM_ID` | Router deployment, if not the default id |
| `LOG_JSON=1` | Structured JSON logs |
| `DEBUG=1` | Verbose logs, including simulation logs on failure |

## Router lifecycle

| Script | What it does |
| --- | --- |
| `scripts/router/deploy.sh <cluster> [--verify]` | `anchor keys sync`, build (optionally verifiable), IDL consistency check, deploy |
| `scripts/router/init.ts` | `initialize` + `init_mint_vaults` for WSOL, USDC, the flagship mint and every `--pairs` mint |

## Bots

### Keeper: `scripts/keeper/keeper.ts`

```bash
node scripts/keeper/keeper.ts --flagship-pool <FLOAT/SOL CPMM pool> [--route-config <amm_config>] [--interval 180] [--send]
```

On every tick, for each registered coin it runs `mark_graduated` →
`settle_ticker_fee` → `cycle_launchlab` → `cycle_cpmm` → `swap_base_fees`.
After the per-coin pass it runs `convert_vault` (flagship → WSOL, traders →
USDC) and `execute_buyback` when the trigger fires, sized with
`maxBuyWithinImpact` to the router's impact cap. Pairs with no CPMM route are
logged and left in their vaults, which is the XBTC/XHYPE behaviour.

### Payout bot: `scripts/keeper/payout-bot.ts`

```bash
node scripts/keeper/payout-bot.ts --prices prices.json --ledger payouts.ledger.json [--interval 300] [--send]
```

For each coin with `holders_unpaid > 0`, it snapshots holders, applies the
payout model (pro rata, $2 account threshold, rollover, seller forfeits),
creates ATAs for wallets that crossed $2 and sends `payout_holders` in batches
of 12. The carry ledger is a JSON file and is only updated after a successful
send.

`prices.json`: `{ "<paired mint>": <USD per whole token> }`.

## Airdrops

```bash
node scripts/airdrop/build.ts --trades trades.csv --round 2 --pot 25000 --pairs-added pairs-added.csv
node scripts/airdrop/publish.ts --file airdrop-2.json --expires-days 30 --send
node scripts/airdrop/distribute.ts --file airdrop-2.json --concurrency 4 --send
```

`build` ranks wallets (window, bot rules, wash filter, 7-day new-pair maturity),
allocates the USDC pot pro rata, and writes a merkle tree with every proof.
`publish` re-verifies every proof before committing the root. `distribute`
skips indexes that already have a `ClaimReceipt`.

## Developer tooling

| Script | Purpose |
| --- | --- |
| `scripts/dev/gen-router-idl.ts [--check]` | Generates `packages/sdk/idl/float_router.json` from the Rust source; `--check` fails when it's stale (runs in `npm test`) |
| `scripts/dev/check-anchor-idl.ts <target/idl/…>` | Diffs Anchor's generated IDL with the committed one (CI, after `anchor build`) |
| `scripts/dev/gen-fixtures.ts` | Regenerates cross-language fixtures for the Rust tests |

## Tests

`scripts/test/keeper.test.ts` runs the real keeper against a mock RPC and
decodes the simulated wire transaction to check the instruction and its
accounts.
