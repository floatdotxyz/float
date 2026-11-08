import { PublicKey } from "./pubkey.ts";

/** Little-endian cursor reader for borsh / bytemuck-packed account data. */
export class Reader {
  readonly data: Uint8Array;
  private readonly view: DataView;
  offset: number;

  constructor(data: Uint8Array, offset = 0) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = offset;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  private need(n: number): void {
    if (this.offset + n > this.data.length) {
      throw new RangeError(`Read of ${n} bytes at offset ${this.offset} exceeds buffer (${this.data.length})`);
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }
  i8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  u64(): bigint {
    this.need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }
  i64(): bigint {
    this.need(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }
  u128(): bigint {
    const lo = this.u64();
    const hi = this.u64();
    return (hi << 64n) | lo;
  }
  i128(): bigint {
    const v = this.u128();
    return v >= 1n << 127n ? v - (1n << 128n) : v;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }
  bytes(n: number): Uint8Array {
    this.need(n);
    const out = this.data.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  pubkey(): PublicKey {
    return new PublicKey(this.bytes(32));
  }
  string(): string {
    const len = this.u32();
    return new TextDecoder().decode(this.bytes(len));
  }
}

/** Growable little-endian writer. */
export class Writer {
  private chunks: number[] = [];

  u8(v: number): this {
    this.chunks.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.uint(BigInt(v), 2);
  }
  u32(v: number): this {
    return this.uint(BigInt(v), 4);
  }
  u64(v: bigint | number): this {
    return this.uint(BigInt(v), 8);
  }
  i64(v: bigint | number): this {
    const b = BigInt(v);
    return this.uint(b < 0n ? b + (1n << 64n) : b, 8);
  }
  u128(v: bigint | number): this {
    return this.uint(BigInt(v), 16);
  }
  bool(v: boolean): this {
    return this.u8(v ? 1 : 0);
  }
  bytes(b: Uint8Array): this {
    for (const x of b) this.chunks.push(x);
    return this;
  }
  pubkey(p: PublicKey): this {
    return this.bytes(p.bytes);
  }
  string(s: string): this {
    const b = new TextEncoder().encode(s);
    this.u32(b.length);
    return this.bytes(b);
  }

  private uint(v: bigint, size: number): this {
    if (v < 0n || v >= 1n << BigInt(size * 8)) {
      throw new RangeError(`Value ${v} does not fit in u${size * 8}`);
    }
    for (let i = 0; i < size; i++) {
      this.chunks.push(Number((v >> BigInt(8 * i)) & 0xffn));
    }
    return this;
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

/** Decodes a fixed-size, NUL-padded UTF-8 byte array (e.g. `[u8; 64]` names). */
export function decodeFixedString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}
