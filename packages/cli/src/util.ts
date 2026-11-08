import { readFileSync } from "node:fs";
import { Connection, MINTS, PublicKey, type Trade } from "@float-community/sdk";

export interface Args {
  _: string[];
  flags: Record<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) out.flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) out.flags[k] = argv[++i]!;
      else out.flags[k] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return v === true ? undefined : v;
}

export function bool(args: Args, name: string): boolean {
  return args.flags[name] !== undefined;
}

export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export function connection(args: Args): Connection {
  return new Connection(flag(args, "rpc") ?? process.env.SOLANA_RPC_URL ?? DEFAULT_RPC);
}

export function requireArg(args: Args, index: number, name: string): string {
  const v = args._[index];
  if (!v) throw new UsageError(`Missing <${name}>`);
  return v;
}

export class UsageError extends Error {}

/** Resolves "SOL", "USDC" or a mint address. */
export function resolveMint(v: string | undefined, fallback = MINTS.WSOL): PublicKey {
  if (!v) return fallback;
  const u = v.toUpperCase();
  if (u === "SOL" || u === "WSOL") return MINTS.WSOL;
  if (u === "USDC") return MINTS.USDC;
  return new PublicKey(v);
}

export function json(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof PublicKey ? v.toBase58() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v),
    2,
  );
}

export function table(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(none)";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => (v instanceof PublicKey ? v.toBase58() : String(v ?? ""));
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(width[i]!)).join("  ");
  return [line(cols), line(width.map((w) => "-".repeat(w))), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join("\n");
}

export function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v instanceof PublicKey ? v.toBase58() : String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

/** Parses a simple CSV (no embedded newlines) into objects keyed by header. */
export function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const header = splitCsvLine(lines.shift() ?? "");
  return lines.map((l) => {
    const cells = splitCsvLine(l);
    return Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? "").trim()]));
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** CSV columns: wallet,coin,pair,side,timestamp,volume_usd[,signature] */
export function readTrades(path: string): Trade[] {
  return readCsv(path).map((r, i) => {
    const ts = /^\d+$/.test(r.timestamp ?? "") ? Number(r.timestamp) : Date.parse(r.timestamp ?? "");
    if (!Number.isFinite(ts)) throw new Error(`Row ${i + 2}: invalid timestamp "${r.timestamp}"`);
    const side = (r.side ?? "").toLowerCase();
    if (side !== "buy" && side !== "sell") throw new Error(`Row ${i + 2}: side must be buy or sell`);
    return {
      wallet: r.wallet!,
      coin: r.coin!,
      pair: r.pair || "SOL",
      side,
      timestamp: ts,
      volumeUsd: Number(r.volume_usd),
      signature: r.signature || undefined,
    };
  });
}

export function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function when(unixSeconds: number | null): string {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString().replace(".000Z", "Z") : "-";
}
