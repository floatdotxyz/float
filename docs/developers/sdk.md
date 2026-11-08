# SDK guide

`@float-community/sdk` is a TypeScript SDK with **no runtime dependencies**. It
uses Node's built-in `fetch`, `node:crypto` (sha256, ed25519) and native
TypeScript execution (Node ≥ 22.18).

```ts
import { Connection, PublicKey, MINTS, launchLab, cpmm, burnAndEarn, splitFees } from "@float-community/sdk";
```

## Modules

| Import | Contents |
| --- | --- |
| `PublicKey`, `findProgramAddress`, `createProgramAddress` | Addresses and PDAs, with a full ed25519 on-curve check |
| `Connection` | JSON-RPC client: accounts, program accounts, signatures, parsed transactions, send/simulate/confirm |
| `Keypair`, `compileLegacyMessage`, `signTransaction` | Build and sign legacy transactions |
| `IdlCoder` | Decode accounts/events, encode instructions and resolve accounts from an Anchor IDL |
| `FLOAT`, `RAYDIUM`, `MINTS`, program ids | Addresses |
| `getAssociatedTokenAddress`, `createAssociatedTokenAccountIdempotent`, `transferChecked`, `closeAccount`, `syncNative`, `burn`, `decodeTokenAccount`, `decodeMint` | SPL helpers (Token and Token-2022) |
| `launchLab.*` | LaunchLab PDAs, decoders, quotes, instructions |
| `cpmm.*` | CPMM PDAs, decoders, swap math, instructions |
| `burnAndEarn.*` | Burn & Earn PDAs and fee harvest |
| `splitFees`, `FEE_SPLIT_BPS` | Fee split |
| `previewCycle` | Pending fees per coin |
| `snapshotHolders`, `computePayoutRound` | Holder rewards |
| `rankTraders`, `allocateAirdrop`, `checkBot`, `detectWashTrades`, `AIRDROP_SCHEDULE` | Trader airdrops |
| `shouldBuyback`, `maxBuyWithinImpact`, `planBuybacks` | Buyback sizing |
| `minOutWithGuard`, `withinGuard` | Price guard |
| `launchCost`, `normalizeTicker`, `isReuseFeeRefunded` | Tickers |
| `listBurns`, `listPayouts`, `summarizePayouts` | History |
| `formatUnits`, `parseUnits` | Amount formatting without floating point |

All amounts are `bigint` in raw base units.

## Recipes

### Read a coin's curve

```ts
const conn = new Connection(process.env.SOLANA_RPC_URL!);
const poolAddr = launchLab.launchLabPda.pool(coinMint, MINTS.WSOL);
const { pool, platformConfig, globalConfig } = await launchLab.fetchLaunchLabPool(conn, poolAddr);

launchLab.bondingProgress(pool);     // 0..1
launchLab.spotPrice(pool);           // raw quote/base
platformConfig.fee_rate;             // platform fee rate, 1e-6 units
```

### Quote and build a buy

```ts
const bundle = await launchLab.fetchLaunchLabPool(conn, poolAddr);
const q = launchLab.quoteBuyExactIn(bundle.pool, 500_000_000n, launchLab.feeRatesOf(bundle)); // 0.5 SOL
const minOut = (q.amountOut * 99n) / 100n;
const ix = launchLab.buyExactInIx({ payer, pool: poolAddr, poolState: bundle.pool }, q.amountIn, minOut);
```

For SOL pairs, wrap first: create the wSOL ATA, `systemTransfer` the lamports,
`syncNative`, then close it afterwards. `packages/cli/src/commands.ts → trade`
shows the full transaction.

### Swap on a graduated pool

```ts
const b = await cpmm.fetchCpmmPool(conn, cpmmPoolAddr);
const r = cpmm.quoteCpmmSwap(b, MINTS.WSOL, 1_000_000_000n);
const ix = cpmm.swapBaseInputIx(payer, b, MINTS.WSOL, 1_000_000_000n, (r.outputAmount * 99n) / 100n);
```

### Send a transaction

```ts
import { Keypair, compileLegacyMessage, signTransaction, setComputeUnitLimit } from "@float-community/sdk";

const kp = Keypair.fromFile(`${process.env.HOME}/.config/solana/id.json`);
const { blockhash } = await conn.getLatestBlockhash();
const msg = compileLegacyMessage([setComputeUnitLimit(200_000), ix], kp.publicKey, blockhash);
const { wire, signature } = signTransaction(msg, [kp]);

const sim = await conn.simulateRawTransaction(wire);
if (!sim.err) {
  await conn.sendRawTransaction(wire);
  await conn.confirm(signature);
}
```

### Decode anything with an IDL

```ts
import { IdlCoder, launchLab, type Idl } from "@float-community/sdk";

const coder = launchLab.launchLabCoder;           // or: new IdlCoder(myIdlJson as Idl)
const acc = await conn.getAccountInfo(address);
const type = coder.identifyAccount(acc!.data);      // "PoolState" | "GlobalConfig" | ...
const decoded = coder.decodeAccount(type!, acc!.data);
```

`IdlCoder.buildInstruction(name, accounts, args)` fills fixed addresses, the
program account and PDA-derived accounts from the IDL. You only pass what
the IDL can't derive.

### Preview a fee cycle

```ts
const p = await previewCycle(conn, coinMint, MINTS.WSOL);
p.stage;         // "bonding" | "migrating" | "graduated"
p.totalPending;  // bigint
p.split;         // { holders, creator, flagship, traders, treasury }
```

## RPC notes

- `getProgramAccounts` (used by `snapshotHolders`) is disabled or rate-limited
  on many public RPCs. Use a provider that supports it.
- `listBurns` / `listPayouts` call `getTransaction` once per signature. Use
  `limit` and `until` to page through history.

## Testing

```bash
npm test
```

The SDK tests need no network. The CLI tests run against an in-process mock
RPC that serves IDL-encoded accounts.
