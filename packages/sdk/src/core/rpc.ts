/**
 * Minimal Solana JSON-RPC client built on `fetch`.
 * Only the methods used by this SDK are implemented.
 */

import { PublicKey } from "./pubkey.ts";

export type Commitment = "processed" | "confirmed" | "finalized";

export interface AccountInfo {
  address: PublicKey;
  owner: PublicKey;
  lamports: bigint;
  executable: boolean;
  data: Uint8Array;
}

export interface RpcFilter {
  memcmp?: { offset: number; bytes: string };
  dataSize?: number;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  memo: string | null;
}

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(`RPC error ${code}: ${message}`);
    this.code = code;
    this.data = data;
  }
}

export interface ConnectionOptions {
  commitment?: Commitment;
  /** Max retries on HTTP 429 / 5xx. */
  retries?: number;
  headers?: Record<string, string>;
}

export class Connection {
  readonly endpoint: string;
  readonly commitment: Commitment;
  private readonly retries: number;
  private readonly headers: Record<string, string>;
  private nextId = 1;

  constructor(endpoint: string, opts: ConnectionOptions = {}) {
    this.endpoint = endpoint;
    this.commitment = opts.commitment ?? "confirmed";
    this.retries = opts.retries ?? 4;
    this.headers = opts.headers ?? {};
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const body = JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params });
    let attempt = 0;
    for (;;) {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        attempt++;
        await sleep(250 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${this.endpoint}`);
      const json = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
      if (json.error) throw new RpcError(json.error.code, json.error.message, json.error.data);
      return json.result as T;
    }
  }

  async getAccountInfo(address: PublicKey | string): Promise<AccountInfo | null> {
    const key = new PublicKey(address);
    const r = await this.call<{ value: RawAccount | null }>("getAccountInfo", [
      key.toBase58(),
      { encoding: "base64", commitment: this.commitment },
    ]);
    return r.value ? parseAccount(key, r.value) : null;
  }

  async getMultipleAccounts(addresses: (PublicKey | string)[]): Promise<(AccountInfo | null)[]> {
    const keys = addresses.map((a) => new PublicKey(a));
    const out: (AccountInfo | null)[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      const r = await this.call<{ value: (RawAccount | null)[] }>("getMultipleAccounts", [
        chunk.map((k) => k.toBase58()),
        { encoding: "base64", commitment: this.commitment },
      ]);
      r.value.forEach((v, j) => out.push(v ? parseAccount(chunk[j]!, v) : null));
    }
    return out;
  }

  async getProgramAccounts(programId: PublicKey | string, filters: RpcFilter[] = []): Promise<AccountInfo[]> {
    const r = await this.call<{ pubkey: string; account: RawAccount }[]>("getProgramAccounts", [
      new PublicKey(programId).toBase58(),
      { encoding: "base64", commitment: this.commitment, filters },
    ]);
    return r.map((x) => parseAccount(new PublicKey(x.pubkey), x.account));
  }

  async getBalance(address: PublicKey | string): Promise<bigint> {
    const r = await this.call<{ value: number }>("getBalance", [new PublicKey(address).toBase58(), { commitment: this.commitment }]);
    return BigInt(r.value);
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const r = await this.call<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [
      { commitment: this.commitment },
    ]);
    return r.value;
  }

  async getSlot(): Promise<number> {
    return this.call<number>("getSlot", [{ commitment: this.commitment }]);
  }

  async getSignaturesForAddress(
    address: PublicKey | string,
    opts: { before?: string; until?: string; limit?: number } = {},
  ): Promise<SignatureInfo[]> {
    return this.call<SignatureInfo[]>("getSignaturesForAddress", [
      new PublicKey(address).toBase58(),
      { commitment: this.commitment, limit: opts.limit ?? 1000, before: opts.before, until: opts.until },
    ]);
  }

  /** Returns the jsonParsed form of a transaction (v0 supported). */
  async getParsedTransaction(signature: string): Promise<ParsedTransaction | null> {
    return this.call<ParsedTransaction | null>("getTransaction", [
      signature,
      { encoding: "jsonParsed", commitment: this.commitment, maxSupportedTransactionVersion: 0 },
    ]);
  }

  async sendRawTransaction(wire: Uint8Array, opts: { skipPreflight?: boolean } = {}): Promise<string> {
    return this.call<string>("sendTransaction", [
      Buffer.from(wire).toString("base64"),
      { encoding: "base64", skipPreflight: opts.skipPreflight ?? false, preflightCommitment: this.commitment },
    ]);
  }

  async simulateRawTransaction(wire: Uint8Array): Promise<{ err: unknown; logs: string[] | null; unitsConsumed?: number }> {
    const r = await this.call<{ value: { err: unknown; logs: string[] | null; unitsConsumed?: number } }>("simulateTransaction", [
      Buffer.from(wire).toString("base64"),
      { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: this.commitment },
    ]);
    return r.value;
  }

  async confirm(signature: string, timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const r = await this.call<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>(
        "getSignatureStatuses",
        [[signature], { searchTransactionHistory: false }],
      );
      const s = r.value[0];
      if (s?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(s.err)}`);
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;
      await sleep(1_000);
    }
    throw new Error(`Timed out confirming ${signature}`);
  }
}

interface RawAccount {
  data: [string, string];
  owner: string;
  lamports: number;
  executable: boolean;
}

function parseAccount(address: PublicKey, raw: RawAccount): AccountInfo {
  return {
    address,
    owner: new PublicKey(raw.owner),
    lamports: BigInt(raw.lamports),
    executable: raw.executable,
    data: new Uint8Array(Buffer.from(raw.data[0], "base64")),
  };
}

export interface ParsedInstruction {
  programId: string;
  program?: string;
  parsed?: { type: string; info: Record<string, unknown> };
  accounts?: string[];
  data?: string;
}

export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

export interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: {
    err: unknown;
    fee: number;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { index: number; instructions: ParsedInstruction[] }[];
    logMessages?: string[];
  } | null;
  transaction: {
    signatures: string[];
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: ParsedInstruction[];
    };
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
