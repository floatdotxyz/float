/**
 * Shared runtime for operational scripts: flags, RPC, keypairs, and a
 * simulate-by-default transaction sender.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  compileLegacyMessage,
  setComputeUnitLimit,
  setComputeUnitPrice,
  signTransaction,
  solscan,
  type Instruction,
  PublicKey,
  router,
} from "@float-community/sdk";

export interface Flags {
  _: string[];
  [k: string]: string | boolean | string[];
}

export function flags(argv = process.argv.slice(2)): Flags {
  const out: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) out[k] = argv[++i]!;
    else out[k] = true;
  }
  return out;
}

export const str = (f: Flags, k: string, d?: string): string | undefined => (typeof f[k] === "string" ? (f[k] as string) : d);
export const need = (f: Flags, k: string): string => {
  const v = str(f, k);
  if (!v) throw new Error(`--${k} is required`);
  return v;
};

export function rpc(f: Flags): Connection {
  return new Connection(str(f, "rpc") ?? process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com");
}

export function keypair(f: Flags, flag = "keypair"): Keypair {
  const path = (str(f, flag) ?? process.env.FLOAT_KEYPAIR ?? `${homedir()}/.config/solana/id.json`).replace(/^~/, homedir());
  return Keypair.fromFile(path);
}

export function routerClient(f: Flags): router.RouterClient {
  const id = str(f, "program-id") ?? process.env.FLOAT_ROUTER_PROGRAM_ID;
  return new router.RouterClient(id ? new PublicKey(id) : undefined);
}

export interface SendOptions {
  send: boolean;
  computeUnits?: number;
  priorityMicroLamports?: bigint;
  label?: string;
}

/** Simulates (default) or sends + confirms a transaction. Returns the signature when sent. */
export async function execute(conn: Connection, signer: Keypair, ixs: Instruction[], o: SendOptions): Promise<string | null> {
  const all = [setComputeUnitLimit(o.computeUnits ?? 400_000), setComputeUnitPrice(o.priorityMicroLamports ?? 25_000n), ...ixs];
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = compileLegacyMessage(all, signer.publicKey, blockhash);
  const { wire, signature } = signTransaction(msg, [signer]);
  const label = o.label ?? "tx";
  if (!o.send) {
    const sim = await conn.simulateRawTransaction(wire);
    log(sim.err ? "warn" : "info", `${label}: simulated ${sim.err ? `FAILED ${JSON.stringify(sim.err)}` : "ok"} (${sim.unitsConsumed ?? "?"} CU, ${wire.length} bytes)`);
    if (sim.err && sim.logs) for (const l of sim.logs.slice(-8)) log("debug", `  ${l}`);
    return null;
  }
  await conn.sendRawTransaction(wire);
  await conn.confirm(signature);
  log("info", `${label}: confirmed ${solscan(signature, "tx")}`);
  return signature;
}

export function log(level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>) {
  if (level === "debug" && !process.env.DEBUG) return;
  const line = { t: new Date().toISOString(), level, msg, ...extra };
  (level === "error" || level === "warn" ? console.error : console.log)(process.env.LOG_JSON ? JSON.stringify(line, bigintReplacer) : `${line.t} ${level.padEnd(5)} ${msg}`);
}

export const bigintReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v instanceof PublicKey ? v.toBase58() : v);

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, bigintReplacer, 2) + "\n");
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
