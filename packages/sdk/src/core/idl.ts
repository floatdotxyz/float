/**
 * Anchor IDL (spec 0.1.0) coder.
 *
 * Decodes accounts, encodes instruction data and resolves instruction
 * accounts (fixed addresses + PDA seeds) directly from the IDL JSON files the
 * upstream programs publish. Using the IDL as the single source of truth keeps
 * account ordering and discriminators in lock-step with the on-chain program.
 */

import { Reader, Writer } from "./borsh.ts";
import { PublicKey, findProgramAddress } from "./pubkey.ts";
import type { AccountMeta, Instruction } from "./tx.ts";

export type IdlType =
  | "bool" | "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "u64" | "i64" | "u128" | "i128"
  | "f32" | "f64" | "bytes" | "string" | "pubkey"
  | { array: [IdlType, number] }
  | { vec: IdlType }
  | { option: IdlType }
  | { coption: IdlType }
  | { defined: { name: string } };

export interface IdlField {
  name: string;
  docs?: string[];
  type: IdlType;
}

export type IdlFields = IdlField[] | IdlType[];

export interface IdlTypeDef {
  name: string;
  docs?: string[];
  serialization?: string;
  repr?: { kind: string; packed?: boolean };
  type:
    | { kind: "struct"; fields?: IdlFields }
    | { kind: "enum"; variants: { name: string; fields?: IdlFields }[] };
}

export interface IdlSeed {
  kind: "const" | "account" | "arg";
  value?: number[];
  path?: string;
}

export interface IdlInstructionAccount {
  name: string;
  docs?: string[];
  writable?: boolean;
  signer?: boolean;
  optional?: boolean;
  address?: string;
  pda?: { seeds: IdlSeed[]; program?: IdlSeed };
  accounts?: IdlInstructionAccount[];
}

export interface IdlInstruction {
  name: string;
  docs?: string[];
  discriminator: number[];
  accounts: IdlInstructionAccount[];
  args: IdlField[];
}

export interface Idl {
  address: string;
  metadata: { name: string; version: string; spec: string; description?: string };
  instructions: IdlInstruction[];
  accounts?: { name: string; discriminator: number[] }[];
  events?: { name: string; discriminator: number[] }[];
  errors?: { code: number; name: string; msg?: string }[];
  types?: IdlTypeDef[];
}

export type Decoded = Record<string, unknown>;

export class IdlCoder {
  readonly idl: Idl;
  readonly programId: PublicKey;
  private readonly types: Map<string, IdlTypeDef>;

  constructor(idl: Idl) {
    this.idl = idl;
    this.programId = new PublicKey(idl.address);
    this.types = new Map((idl.types ?? []).map((t) => [t.name, t]));
  }

  // ---------------------------------------------------------------- accounts

  accountDiscriminator(name: string): Uint8Array {
    const acc = this.idl.accounts?.find((a) => a.name === name);
    if (!acc) throw new Error(`Account "${name}" not found in IDL ${this.idl.metadata.name}`);
    return Uint8Array.from(acc.discriminator);
  }

  /** Returns the account type name whose discriminator matches `data`, if any. */
  identifyAccount(data: Uint8Array): string | undefined {
    const head = Buffer.from(data.subarray(0, 8));
    return this.idl.accounts?.find((a) => head.equals(Buffer.from(a.discriminator)))?.name;
  }

  decodeAccount<T = Decoded>(name: string, data: Uint8Array): T {
    const disc = this.accountDiscriminator(name);
    if (!Buffer.from(data.subarray(0, 8)).equals(Buffer.from(disc))) {
      throw new Error(`Account discriminator mismatch: expected ${name}`);
    }
    const reader = new Reader(data, 8);
    return this.decodeDefined(name, reader) as T;
  }

  decodeEvent<T = Decoded>(name: string, data: Uint8Array): T {
    const ev = this.idl.events?.find((e) => e.name === name);
    if (!ev) throw new Error(`Event "${name}" not found`);
    if (!Buffer.from(data.subarray(0, 8)).equals(Buffer.from(ev.discriminator))) {
      throw new Error(`Event discriminator mismatch: expected ${name}`);
    }
    return this.decodeDefined(name, new Reader(data, 8)) as T;
  }

  errorFor(code: number): { code: number; name: string; msg?: string } | undefined {
    return this.idl.errors?.find((e) => e.code === code);
  }

  // ------------------------------------------------------------ instructions

  instruction(name: string): IdlInstruction {
    const ix = this.idl.instructions.find((i) => i.name === name);
    if (!ix) throw new Error(`Instruction "${name}" not found in IDL ${this.idl.metadata.name}`);
    return ix;
  }

  encodeInstructionData(name: string, args: Record<string, unknown>): Uint8Array {
    const ix = this.instruction(name);
    const w = new Writer().bytes(Uint8Array.from(ix.discriminator));
    for (const arg of ix.args) {
      if (!(arg.name in args)) throw new Error(`Missing argument "${arg.name}" for ${name}`);
      this.encodeType(arg.type, args[arg.name], w);
    }
    return w.toBytes();
  }

  /**
   * Builds a full instruction. Accounts not supplied in `accounts` are
   * resolved from the IDL when possible: fixed `address`, `program` (the
   * program itself, used by Anchor's event CPI) and PDA seeds.
   */
  buildInstruction(
    name: string,
    accounts: Record<string, PublicKey | string>,
    args: Record<string, unknown> = {},
    remainingAccounts: AccountMeta[] = [],
  ): Instruction {
    const ix = this.instruction(name);
    const resolved = new Map<string, PublicKey>();
    for (const [k, v] of Object.entries(accounts)) resolved.set(k, new PublicKey(v));

    const flat = flattenAccounts(ix.accounts);

    // Iterate until no more accounts can be resolved (PDAs may depend on each other).
    let progress = true;
    while (progress) {
      progress = false;
      for (const acc of flat) {
        if (resolved.has(acc.name)) continue;
        const key = this.tryResolve(acc, resolved, args);
        if (key) {
          resolved.set(acc.name, key);
          progress = true;
        }
      }
    }

    const keys: AccountMeta[] = flat.map((acc) => {
      const pubkey = resolved.get(acc.name);
      if (!pubkey) {
        if (acc.optional) {
          // Anchor encodes a missing optional account as the program id.
          return { pubkey: this.programId, isSigner: false, isWritable: false };
        }
        throw new Error(`Unable to resolve account "${acc.name}" for instruction ${name}`);
      }
      return { pubkey, isSigner: !!acc.signer, isWritable: !!acc.writable };
    });

    return {
      programId: this.programId,
      keys: [...keys, ...remainingAccounts],
      data: this.encodeInstructionData(name, args),
    };
  }

  private tryResolve(
    acc: IdlInstructionAccount,
    resolved: Map<string, PublicKey>,
    args: Record<string, unknown>,
  ): PublicKey | undefined {
    if (acc.address) return new PublicKey(acc.address);
    if (acc.name === "program") return this.programId;
    if (!acc.pda) return undefined;

    const seeds: Uint8Array[] = [];
    for (const seed of acc.pda.seeds) {
      const bytes = this.seedValue(seed, resolved, args);
      if (!bytes) return undefined;
      seeds.push(bytes);
    }
    let programId = this.programId;
    if (acc.pda.program) {
      const p = this.seedValue(acc.pda.program, resolved, args);
      if (!p) return undefined;
      programId = new PublicKey(p);
    }
    return findProgramAddress(seeds, programId).address;
  }

  private seedValue(
    seed: IdlSeed,
    resolved: Map<string, PublicKey>,
    args: Record<string, unknown>,
  ): Uint8Array | undefined {
    switch (seed.kind) {
      case "const":
        return Uint8Array.from(seed.value ?? []);
      case "account": {
        // Only plain account paths are supported (not `account.field`).
        if (!seed.path || seed.path.includes(".")) return undefined;
        return resolved.get(seed.path)?.bytes;
      }
      case "arg": {
        if (!seed.path) return undefined;
        const v = args[seed.path];
        if (v instanceof PublicKey) return v.bytes;
        if (typeof v === "string") return new TextEncoder().encode(v);
        if (v instanceof Uint8Array) return v;
        return undefined;
      }
    }
  }

  // ------------------------------------------------------------------- types

  private decodeDefined(name: string, r: Reader): unknown {
    const def = this.types.get(name);
    if (!def) throw new Error(`Type "${name}" not found in IDL`);
    if (def.type.kind === "struct") return this.decodeFields(def.type.fields ?? [], r);

    const tag = r.u8();
    const variant = def.type.variants[tag];
    if (!variant) throw new Error(`Invalid variant ${tag} for enum ${name}`);
    if (!variant.fields || variant.fields.length === 0) return { kind: variant.name };
    return { kind: variant.name, ...(this.decodeFields(variant.fields, r) as object) };
  }

  private decodeFields(fields: IdlFields, r: Reader): Decoded | unknown[] {
    if (fields.length > 0 && typeof fields[0] === "object" && fields[0] !== null && "name" in fields[0]) {
      const out: Decoded = {};
      for (const f of fields as IdlField[]) out[f.name] = this.decodeType(f.type, r);
      return out;
    }
    return (fields as IdlType[]).map((t) => this.decodeType(t, r));
  }

  decodeType(t: IdlType, r: Reader): unknown {
    if (typeof t === "string") {
      switch (t) {
        case "bool": return r.bool();
        case "u8": return r.u8();
        case "i8": return r.i8();
        case "u16": return r.u16();
        case "i16": return r.i16();
        case "u32": return r.u32();
        case "i32": return r.i32();
        case "u64": return r.u64();
        case "i64": return r.i64();
        case "u128": return r.u128();
        case "i128": return r.i128();
        case "f32": { const b = r.bytes(4); return new DataView(b.buffer).getFloat32(0, true); }
        case "f64": { const b = r.bytes(8); return new DataView(b.buffer).getFloat64(0, true); }
        case "pubkey": return r.pubkey();
        case "string": return r.string();
        case "bytes": return r.bytes(r.u32());
      }
    }
    if ("array" in t) {
      const [inner, len] = t.array;
      if (inner === "u8") return r.bytes(len);
      return Array.from({ length: len }, () => this.decodeType(inner, r));
    }
    if ("vec" in t) {
      const len = r.u32();
      if (t.vec === "u8") return r.bytes(len);
      return Array.from({ length: len }, () => this.decodeType(t.vec, r));
    }
    if ("option" in t) return r.u8() === 0 ? null : this.decodeType(t.option, r);
    if ("coption" in t) {
      const tag = r.u32();
      const v = this.decodeType(t.coption, r);
      return tag === 0 ? null : v;
    }
    if ("defined" in t) return this.decodeDefined(t.defined.name, r);
    throw new Error(`Unsupported IDL type ${JSON.stringify(t)}`);
  }

  encodeType(t: IdlType, v: unknown, w: Writer): void {
    if (typeof t === "string") {
      switch (t) {
        case "bool": w.bool(Boolean(v)); return;
        case "u8": w.u8(Number(v)); return;
        case "i8": w.u8(Number(v) & 0xff); return;
        case "u16": w.u16(Number(v)); return;
        case "u32": w.u32(Number(v)); return;
        case "u64": w.u64(BigInt(v as bigint)); return;
        case "i64": w.i64(BigInt(v as bigint)); return;
        case "u128": w.u128(BigInt(v as bigint)); return;
        case "pubkey": w.pubkey(new PublicKey(v as string | PublicKey)); return;
        case "string": w.string(String(v)); return;
        case "bytes": { const b = v as Uint8Array; w.u32(b.length).bytes(b); return; }
        default: throw new Error(`Encoding of ${t} not supported`);
      }
    }
    if ("array" in t) {
      const [inner, len] = t.array;
      const arr = v as ArrayLike<unknown>;
      if (arr.length !== len) throw new Error(`Expected array of length ${len}`);
      for (let i = 0; i < len; i++) this.encodeType(inner, arr[i], w);
      return;
    }
    if ("vec" in t) {
      const arr = v as unknown[];
      w.u32(arr.length);
      for (const x of arr) this.encodeType(t.vec, x, w);
      return;
    }
    if ("option" in t) {
      if (v === null || v === undefined) { w.u8(0); return; }
      w.u8(1);
      this.encodeType(t.option, v, w);
      return;
    }
    if ("defined" in t) {
      const def = this.types.get(t.defined.name);
      if (!def) throw new Error(`Type "${t.defined.name}" not found`);
      if (def.type.kind === "struct") {
        this.encodeFields(def.type.fields ?? [], v, w);
        return;
      }
      const obj = v as { kind: string } & Record<string, unknown>;
      const idx = def.type.variants.findIndex((x) => x.name === obj.kind);
      if (idx < 0) throw new Error(`Unknown variant ${obj.kind} for ${def.name}`);
      w.u8(idx);
      const fields = def.type.variants[idx]!.fields;
      if (fields) this.encodeFields(fields, obj, w);
      return;
    }
    throw new Error(`Unsupported IDL type ${JSON.stringify(t)}`);
  }

  private encodeFields(fields: IdlFields, v: unknown, w: Writer): void {
    if (fields.length > 0 && typeof fields[0] === "object" && fields[0] !== null && "name" in fields[0]) {
      const obj = v as Record<string, unknown>;
      for (const f of fields as IdlField[]) this.encodeType(f.type, obj[f.name], w);
      return;
    }
    // Tuple fields: accept an array, or an object keyed by position ({ 0: x, 1: y }).
    const obj = v as Record<number, unknown>;
    (fields as IdlType[]).forEach((t, i) => this.encodeType(t, Array.isArray(v) ? v[i] : obj[i], w));
  }
}

function flattenAccounts(accounts: IdlInstructionAccount[]): IdlInstructionAccount[] {
  return accounts.flatMap((a) => (a.accounts ? flattenAccounts(a.accounts) : [a]));
}
