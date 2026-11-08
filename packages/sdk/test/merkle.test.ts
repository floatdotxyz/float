import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey, airdropLeaf, buildAirdropTree, deserializeTree, serializeTree, toHex, verifyProof, merkleNode, launchLab, MINTS, Writer } from "../src/index.ts";

const FIXTURE = fileURLToPath(new URL("../../../crates/float-core/tests/fixtures/airdrop-merkle.json", import.meta.url));

const wallets = [1, 2, 3, 4, 5].map((b) => new PublicKey(new Uint8Array(32).fill(b)));
const entries = wallets.map((w, i) => ({ wallet: w, amount: BigInt((i + 1) * 1_000_000) }));

test("every proof verifies, including the odd leaf", () => {
  const t = buildAirdropTree(2n, entries);
  for (const l of t.leaves) assert.ok(verifyProof(l.proof, t.root, l.leaf), `leaf ${l.index}`);
  assert.equal(t.total, 15_000_000n);
});

test("tampered amounts or rounds fail", () => {
  const t = buildAirdropTree(2n, entries);
  const l = t.leaves[0]!;
  assert.equal(verifyProof(l.proof, t.root, airdropLeaf(2n, 0, l.wallet, l.amount + 1n)), false);
  assert.equal(verifyProof(l.proof, t.root, airdropLeaf(3n, 0, l.wallet, l.amount)), false);
});

test("nodes are order-independent", () => {
  const a = new Uint8Array(32).fill(1);
  const b = new Uint8Array(32).fill(2);
  assert.deepEqual(merkleNode(a, b), merkleNode(b, a));
});

test("serialize / deserialize round-trip", () => {
  const t = buildAirdropTree(7n, entries);
  const back = deserializeTree(JSON.parse(JSON.stringify(serializeTree(t))));
  assert.deepEqual(back.root, t.root);
  for (const l of back.leaves) assert.ok(verifyProof(l.proof, back.root, l.leaf));
});

test("cross-language fixture matches what this module produces", () => {
  const t = buildAirdropTree(2n, entries.slice(0, 4));
  const fx = JSON.parse(readFileSync(FIXTURE, "utf8"));
  assert.equal(fx.root, toHex(t.root));
  assert.equal(fx.leaf0, toHex(t.leaves[0]!.leaf));
  assert.deepEqual(fx.proof0, t.leaves[0]!.proof.map(toHex));
  assert.equal(fx.wallet0, toHex(wallets[0]!.bytes));
});

test("LaunchLab PoolState byte offsets used by float-core match the IDL encoding", () => {
  const coder = launchLab.launchLabCoder;
  const k = (b: number) => new PublicKey(new Uint8Array(32).fill(b));
  const w = new Writer().bytes(coder.accountDiscriminator("PoolState"));
  coder.encodeType({ defined: { name: "PoolState" } }, {
    epoch: 1n, auth_bump: 2, status: 2, base_decimals: 6, quote_decimals: 9, migrate_type: 1,
    supply: 3n, total_base_sell: 4n, virtual_base: 5n, virtual_quote: 6n, real_base: 7n, real_quote: 8n,
    total_quote_fund_raising: 9n, quote_protocol_fee: 10n, platform_fee: 11n, migrate_fee: 12n,
    vesting_schedule: { total_locked_amount: 0n, cliff_period: 0n, unlock_period: 0n, start_time: 0n, allocated_share_amount: 0n },
    global_config: k(20), platform_config: k(21), base_mint: k(22), quote_mint: MINTS.WSOL, base_vault: k(24), quote_vault: k(25), creator: k(26),
    token_program_flag: 0, amm_creator_fee_on: { kind: "QuoteToken" }, platform_vesting_share: 0n, padding: new Uint8Array(54),
  }, w);
  const d = Buffer.from(w.toBytes());
  // offsets from crates/float-core/src/launchlab.rs
  assert.equal(d[17], 2);
  assert.equal(d[20], 1);
  assert.equal(d.readBigUInt64LE(61), 8n);
  assert.equal(d.readBigUInt64LE(69), 9n);
  assert.equal(d.readBigUInt64LE(85), 11n);
  assert.deepEqual(d.subarray(173, 205), Buffer.alloc(32, 21));
  assert.deepEqual(d.subarray(205, 237), Buffer.alloc(32, 22));
  assert.deepEqual(d.subarray(237, 269), Buffer.from(MINTS.WSOL.bytes));
  assert.deepEqual(d.subarray(301, 333), Buffer.alloc(32, 25));
  assert.deepEqual(d.subarray(333, 365), Buffer.alloc(32, 26));
});
