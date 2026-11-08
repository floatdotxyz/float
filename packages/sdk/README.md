# @float-community/sdk

Zero-dependency TypeScript SDK for **Float** coins on Solana. *Unofficial;
not affiliated with the Float team.*

- Raydium **LaunchLab**: PDAs, IDL-driven account decoding, constant-product
  curve quotes with the full fee split, `buy_exact_in` / `sell_exact_in` /
  fee-claim instructions.
- Raydium **CPMM**: PDAs, decoding, a port of the Rust swap calculator,
  `swap_base_input` and creator-fee instructions.
- Raydium **Burn & Earn**: locked-liquidity PDAs and `collect_cp_fees`.
- **Float mechanics**: the 15/5/35/35/10 fee split, fee-cycle preview, holder
  snapshots and the payout model ($2 account threshold, rollover, seller
  forfeits), airdrop schedule/bot rules/ranking/allocation, buyback trigger
  and ≤ 1% impact sizing, the cycle price guard, ticker rules and reuse fee,
  and the pair catalogue.
- **Core**: base58, ed25519 on-curve check, PDAs, borsh, Anchor IDL coder,
  JSON-RPC client, legacy transaction signing. It uses only Node built-ins.

Requires Node.js ≥ 22.18 (native TypeScript).

```ts
import { Connection, MINTS, PublicKey, launchLab, previewCycle } from "@float-community/sdk";

const conn = new Connection(process.env.SOLANA_RPC_URL!);
const coin = new PublicKey("<coin-mint>");

const bundle = await launchLab.fetchLaunchLabPool(conn, launchLab.launchLabPda.pool(coin, MINTS.WSOL));
const quote = launchLab.quoteBuyExactIn(bundle.pool, 1_000_000_000n, launchLab.feeRatesOf(bundle));
const cycle = await previewCycle(conn, coin, MINTS.WSOL);
```

Full guide: [`docs/developers/sdk.md`](../../docs/developers/sdk.md).
