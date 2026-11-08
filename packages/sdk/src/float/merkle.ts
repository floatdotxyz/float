/**
 * Merkle trees for trader airdrops, byte-compatible with
 * `crates/float-core/src/merkle.rs` and the `float_router::claim_airdrop`
 * instruction.
 *
 *   leaf = sha256(0x00 ‖ round_id:u64le ‖ index:u64le ‖ wallet:32 ‖ amount:u64le)
 *   node = sha256(0x01 ‖ min(a,b) ‖ max(a,b))
 */

import { createHash } from "node:crypto";
import { Writer } from "../core/borsh.ts";
import { PublicKey } from "../core/pubkey.ts";

export interface AirdropEntry {
  wallet: PublicKey;
  /** USDC raw units. */
  amount: bigint;
}

export interface AirdropLeaf extends AirdropEntry {
  index: number;
  leaf: Uint8Array;
  proof: Uint8Array[];
}

const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

export function airdropLeaf(roundId: bigint, index: number, wallet: PublicKey, amount: bigint): Uint8Array {
  const body = new Writer().u8(0).u64(roundId).u64(BigInt(index)).pubkey(wallet).u64(amount).toBytes();
  return sha256(body);
}

export function merkleNode(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? [a, b] : [b, a];
  return sha256(Uint8Array.of(1), lo, hi);
}

export function verifyProof(proof: Uint8Array[], root: Uint8Array, leaf: Uint8Array): boolean {
  let acc = leaf;
  for (const p of proof) acc = merkleNode(acc, p);
  return Buffer.from(acc).equals(Buffer.from(root));
}

export interface AirdropTree {
  roundId: bigint;
  root: Uint8Array;
  total: bigint;
  leaves: AirdropLeaf[];
}

/**
 * Builds a tree. An odd node at any level is carried up unchanged, so proofs
 * have variable length (at most ceil(log2(n))).
 */
export function buildAirdropTree(roundId: bigint, entries: AirdropEntry[]): AirdropTree {
  if (entries.length === 0) throw new Error("Airdrop needs at least one entry");
  const leaves = entries.map((e, i) => airdropLeaf(roundId, i, e.wallet, e.amount));
  const proofs: Uint8Array[][] = entries.map(() => []);
  let level = leaves.map((h, i) => ({ h, members: [i] }));

  while (level.length > 1) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i]!;
      const b = level[i + 1];
      if (!b) {
        next.push(a);
        continue;
      }
      for (const m of a.members) proofs[m]!.push(b.h);
      for (const m of b.members) proofs[m]!.push(a.h);
      next.push({ h: merkleNode(a.h, b.h), members: [...a.members, ...b.members] });
    }
    level = next;
  }

  return {
    roundId,
    root: level[0]!.h,
    total: entries.reduce((s, e) => s + e.amount, 0n),
    leaves: entries.map((e, i) => ({ ...e, index: i, leaf: leaves[i]!, proof: proofs[i]! })),
  };
}

export const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
export const fromHex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));

/** JSON-serialisable form, as written by `scripts/airdrop/build.ts`. */
export function serializeTree(t: AirdropTree) {
  return {
    roundId: t.roundId.toString(),
    root: toHex(t.root),
    total: t.total.toString(),
    claims: t.leaves.map((l) => ({
      index: l.index,
      wallet: l.wallet.toBase58(),
      amount: l.amount.toString(),
      proof: l.proof.map(toHex),
    })),
  };
}

export function deserializeTree(j: ReturnType<typeof serializeTree>): AirdropTree {
  const roundId = BigInt(j.roundId);
  return {
    roundId,
    root: fromHex(j.root),
    total: BigInt(j.total),
    leaves: j.claims.map((c) => {
      const wallet = new PublicKey(c.wallet);
      const amount = BigInt(c.amount);
      return { index: c.index, wallet, amount, leaf: airdropLeaf(roundId, c.index, wallet, amount), proof: c.proof.map(fromHex) };
    }),
  };
}
