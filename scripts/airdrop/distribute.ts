/**
 * Pushes every claim of a published round to its wallet (creating USDC ATAs
 * idempotently). Already-claimed indexes are skipped by checking receipts.
 *
 *   node scripts/airdrop/distribute.ts --file airdrop-2.json [--concurrency 4] [--send]
 */
import { readFileSync } from "node:fs";
import { MINTS, createAssociatedTokenAccountIdempotent, deserializeTree } from "@float-community/sdk";
import { chunk, execute, flags, keypair, log, need, routerClient, rpc, str } from "../lib/runtime.ts";

const f = flags();
const conn = rpc(f);
const payer = keypair(f);
const client = routerClient(f);
const send = Boolean(f.send);
const tree = deserializeTree(JSON.parse(readFileSync(need(f, "file"), "utf8")));
const concurrency = Number(str(f, "concurrency", "4"));

const receipts = await conn.getMultipleAccounts(tree.leaves.map((l) => client.pda.claim(tree.roundId, l.index)));
const pending = tree.leaves.filter((_, i) => receipts[i] === null);
log("info", `round ${tree.roundId}: ${tree.leaves.length - pending.length} already claimed, ${pending.length} to push`);

let done = 0;
for (const group of chunk(pending, concurrency)) {
  await Promise.all(group.map(async (l) => {
    try {
      await execute(conn, payer, [
        createAssociatedTokenAccountIdempotent(payer.publicKey, l.wallet, MINTS.USDC),
        client.claimAirdrop(payer.publicKey, tree.roundId, l.index, l.wallet, l.amount, l.proof),
      ], { send, label: `claim #${l.index} ${l.wallet.toBase58()} ${l.amount}`, computeUnits: 120_000 });
      done++;
    } catch (err) {
      log("error", `claim #${l.index}: ${(err as Error).message}`);
    }
  }));
}
log("info", `${send ? "sent" : "simulated"} ${done}/${pending.length}`);
