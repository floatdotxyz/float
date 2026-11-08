import { createHash } from "node:crypto";
import { decodeBase58, encodeBase58 } from "./base58.ts";
import { isOnCurve } from "./ed25519.ts";

const PDA_MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const MAX_SEED_LENGTH = 32;
const MAX_SEEDS = 16;

/** A 32-byte Solana address. Immutable. */
export class PublicKey {
  readonly bytes: Uint8Array;

  constructor(value: string | Uint8Array | PublicKey) {
    if (value instanceof PublicKey) {
      this.bytes = value.bytes;
    } else if (typeof value === "string") {
      this.bytes = decodeBase58(value);
    } else {
      this.bytes = Uint8Array.from(value);
    }
    if (this.bytes.length !== 32) {
      throw new Error(`Invalid public key length ${this.bytes.length}, expected 32`);
    }
  }

  static readonly default = new PublicKey(new Uint8Array(32));

  toBase58(): string {
    return encodeBase58(this.bytes);
  }

  toString(): string {
    return this.toBase58();
  }

  toJSON(): string {
    return this.toBase58();
  }

  equals(other: PublicKey | string): boolean {
    const o = typeof other === "string" ? new PublicKey(other) : other;
    return Buffer.from(this.bytes).equals(Buffer.from(o.bytes));
  }

  isOnCurve(): boolean {
    return isOnCurve(this.bytes);
  }

  /** Lexicographic byte comparison (used by Raydium to order pool mints). */
  compare(other: PublicKey): number {
    return Buffer.compare(Buffer.from(this.bytes), Buffer.from(other.bytes));
  }

  static isValid(value: string): boolean {
    try {
      new PublicKey(value);
      return true;
    } catch {
      return false;
    }
  }
}

export type Seed = Uint8Array | string | PublicKey;

function seedBytes(seed: Seed): Uint8Array {
  if (seed instanceof PublicKey) return seed.bytes;
  if (typeof seed === "string") return new TextEncoder().encode(seed);
  return seed;
}

/** Equivalent of `Pubkey::create_program_address`. Throws if the result is on curve. */
export function createProgramAddress(seeds: Seed[], programId: PublicKey): PublicKey {
  if (seeds.length > MAX_SEEDS) throw new Error("Too many seeds");
  const hash = createHash("sha256");
  for (const s of seeds) {
    const b = seedBytes(s);
    if (b.length > MAX_SEED_LENGTH) throw new Error("Seed exceeds 32 bytes");
    hash.update(b);
  }
  hash.update(programId.bytes);
  hash.update(PDA_MARKER);
  const candidate = new Uint8Array(hash.digest());
  if (isOnCurve(candidate)) throw new Error("Derived address is on curve");
  return new PublicKey(candidate);
}

export interface ProgramAddress {
  address: PublicKey;
  bump: number;
}

/** Equivalent of `Pubkey::find_program_address`. */
export function findProgramAddress(seeds: Seed[], programId: PublicKey): ProgramAddress {
  for (let bump = 255; bump >= 0; bump--) {
    try {
      const address = createProgramAddress([...seeds, Uint8Array.of(bump)], programId);
      return { address, bump };
    } catch (err) {
      if (err instanceof Error && err.message === "Derived address is on curve") continue;
      throw err;
    }
  }
  throw new Error("Unable to find a viable program address bump");
}

export function pk(value: string | PublicKey): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}
