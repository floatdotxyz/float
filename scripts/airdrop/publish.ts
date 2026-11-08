/**
 * Commits an airdrop round on chain: moves `total` USDC from the traders
 * vault into the round escrow and stores the merkle root.
 *
 *   node scripts/airdrop/publish.ts --file airdrop-2.json [--expires-days 30] [--send]
 */
import { readFileSync } from "node:fs";
import { deserializeTree, verifyProof } from "@float-community/sdk";
import { execute, flags, keypair, log, need, routerClient, rpc, str } from "../lib/runtime.ts";

const f = flags();
const conn = rpc(f);
const operator = keypair(f);
const client = routerClient(f);

const tree = deserializeTree(JSON.parse(readFileSync(need(f, "file"), "utf8")));
const bad = tree.leaves.filter((l) => !verifyProof(l.proof, tree.root, l.leaf));
if (bad.length) throw new Error(`${bad.length} proofs do not verify — refusing to publish`);

const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(str(f, "expires-days", "30")) * 86_400);
await execute(conn, operator, [client.createAirdrop(operator.publicKey, tree.roundId, tree.root, tree.total, expiresAt)], {
  send: Boolean(f.send),
  label: `create_airdrop round ${tree.roundId} (${tree.leaves.length} claims)`,
});
log("info", `round PDA ${client.pda.airdrop(tree.roundId).toBase58()}`);
