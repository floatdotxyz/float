/**
 * Legacy transaction compilation, signing and serialization.
 * Uses Node's built-in ed25519 implementation (node:crypto).
 */

import { createPrivateKey, createPublicKey, sign as edSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { decodeBase58, encodeBase58 } from "./base58.ts";
import { Writer } from "./borsh.ts";
import { PublicKey } from "./pubkey.ts";

export interface AccountMeta {
  pubkey: PublicKey;
  isSigner: boolean;
  isWritable: boolean;
}

export interface Instruction {
  programId: PublicKey;
  keys: AccountMeta[];
  data: Uint8Array;
}

// PKCS#8 DER prefix for a raw 32-byte ed25519 seed.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export class Keypair {
  readonly publicKey: PublicKey;
  private readonly key: KeyObject;

  private constructor(seed: Uint8Array) {
    this.key = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]),
      format: "der",
      type: "pkcs8",
    });
    const spki = createPublicKey(this.key).export({ format: "der", type: "spki" });
    this.publicKey = new PublicKey(new Uint8Array(spki.subarray(spki.length - 32)));
  }

  /** From a 64-byte Solana secret key (seed || pubkey) or a 32-byte seed. */
  static fromSecretKey(secret: Uint8Array): Keypair {
    if (secret.length !== 64 && secret.length !== 32) throw new Error("Secret key must be 32 or 64 bytes");
    const kp = new Keypair(secret.subarray(0, 32));
    if (secret.length === 64 && !kp.publicKey.equals(new PublicKey(secret.subarray(32)))) {
      throw new Error("Secret key does not match its embedded public key");
    }
    return kp;
  }

  /** Reads a Solana CLI keypair file (JSON array of 64 numbers). */
  static fromFile(path: string): Keypair {
    const arr = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  static fromBase58(secret: string): Keypair {
    return Keypair.fromSecretKey(decodeBase58(secret));
  }

  static generate(): Keypair {
    const { privateKey } = generateKeyPairSync("ed25519");
    const der = privateKey.export({ format: "der", type: "pkcs8" });
    return new Keypair(new Uint8Array(der.subarray(der.length - 32)));
  }

  sign(message: Uint8Array): Uint8Array {
    return new Uint8Array(edSign(null, message, this.key));
  }
}

function shortVec(w: Writer, n: number): void {
  let rem = n;
  for (;;) {
    let elem = rem & 0x7f;
    rem >>= 7;
    if (rem === 0) {
      w.u8(elem);
      return;
    }
    elem |= 0x80;
    w.u8(elem);
  }
}

export interface CompiledMessage {
  bytes: Uint8Array;
  signers: PublicKey[];
}

/** Compiles instructions into a legacy message (fee payer first). */
export function compileLegacyMessage(
  instructions: Instruction[],
  feePayer: PublicKey,
  recentBlockhash: string,
): CompiledMessage {
  type Entry = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
  const metas = new Map<string, Entry>();
  const upsert = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => {
    const k = pubkey.toBase58();
    const prev = metas.get(k);
    if (prev) {
      prev.isSigner ||= isSigner;
      prev.isWritable ||= isWritable;
    } else {
      metas.set(k, { pubkey, isSigner, isWritable });
    }
  };

  upsert(feePayer, true, true);
  for (const ix of instructions) {
    for (const k of ix.keys) upsert(k.pubkey, k.isSigner, k.isWritable);
    upsert(ix.programId, false, false);
  }

  const payerKey = feePayer.toBase58();
  const all = [...metas.values()];
  const rank = (e: Entry) => (e.isSigner ? (e.isWritable ? 0 : 1) : e.isWritable ? 2 : 3);
  all.sort((a, b) => {
    if (a.pubkey.toBase58() === payerKey) return -1;
    if (b.pubkey.toBase58() === payerKey) return 1;
    return rank(a) - rank(b);
  });

  const numSigners = all.filter((e) => e.isSigner).length;
  const numReadonlySigned = all.filter((e) => e.isSigner && !e.isWritable).length;
  const numReadonlyUnsigned = all.filter((e) => !e.isSigner && !e.isWritable).length;
  const index = new Map(all.map((e, i) => [e.pubkey.toBase58(), i]));

  const w = new Writer();
  w.u8(numSigners).u8(numReadonlySigned).u8(numReadonlyUnsigned);
  shortVec(w, all.length);
  for (const e of all) w.pubkey(e.pubkey);
  w.bytes(decodeBase58(recentBlockhash));
  shortVec(w, instructions.length);
  for (const ix of instructions) {
    w.u8(index.get(ix.programId.toBase58())!);
    shortVec(w, ix.keys.length);
    for (const k of ix.keys) w.u8(index.get(k.pubkey.toBase58())!);
    shortVec(w, ix.data.length);
    w.bytes(ix.data);
  }

  return { bytes: w.toBytes(), signers: all.slice(0, numSigners).map((e) => e.pubkey) };
}

/** Signs a compiled message and returns the wire-format transaction. */
export function signTransaction(message: CompiledMessage, keypairs: Keypair[]): { wire: Uint8Array; signature: string } {
  const byKey = new Map(keypairs.map((k) => [k.publicKey.toBase58(), k]));
  const w = new Writer();
  shortVec(w, message.signers.length);
  let first = "";
  for (const s of message.signers) {
    const kp = byKey.get(s.toBase58());
    if (!kp) throw new Error(`Missing signer ${s.toBase58()}`);
    const sig = kp.sign(message.bytes);
    if (!first) first = encodeBase58(sig);
    w.bytes(sig);
  }
  w.bytes(message.bytes);
  return { wire: w.toBytes(), signature: first };
}

// ------------------------------------------------------------ compute budget

export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey("ComputeBudget111111111111111111111111111111");

export function setComputeUnitLimit(units: number): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: new Writer().u8(2).u32(units).toBytes() };
}

export function setComputeUnitPrice(microLamports: bigint | number): Instruction {
  return { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [], data: new Writer().u8(3).u64(microLamports).toBytes() };
}
