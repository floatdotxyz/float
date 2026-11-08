/**
 * Generates `packages/sdk/idl/float_router.json` (Anchor IDL spec 0.1.0)
 * straight from the program's Rust source, so the TypeScript client can never
 * drift from the on-chain account order, flags or arguments.
 *
 *   node scripts/dev/gen-router-idl.ts          # write
 *   node scripts/dev/gen-router-idl.ts --check  # fail if the committed IDL is stale
 *
 * After `anchor build`, `target/idl/float_router.json` is the canonical IDL;
 * `scripts/dev/check-anchor-idl.ts` diffs the two in CI.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const src = join(root, "programs/float-router/src");
const read = (p: string) => readFileSync(join(src, p), "utf8");

const disc = (ns: string, name: string) => [...createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8)];

// ------------------------------------------------------------- type mapping

type IdlType = string | Record<string, unknown>;

function mapType(t: string): IdlType {
  t = t.trim().replace(/^Box<(.*)>$/, "$1");
  const prim: Record<string, string> = { u8: "u8", u16: "u16", u32: "u32", u64: "u64", u128: "u128", i64: "i64", bool: "bool", Pubkey: "pubkey", String: "string" };
  if (prim[t]) return prim[t]!;
  let m = t.match(/^\[(.+);\s*(\d+)\]$/);
  if (m) return { array: [mapType(m[1]!), Number(m[2])] };
  m = t.match(/^Vec<(.+)>$/);
  if (m) return { vec: mapType(m[1]!) };
  m = t.match(/^Option<(.+)>$/);
  if (m) return { option: mapType(m[1]!) };
  return { defined: { name: t } };
}

/** Parses `pub struct Name { pub a: T, ... }` bodies (skipping attributes and comments). */
function structFields(body: string): { name: string; type: string; attrs: string }[] {
  const out: { name: string; type: string; attrs: string }[] = [];
  let attrs = "";
  let depth = 0;
  let cur = "";
  for (const line of body.split("\n")) {
    const l = line.trim();
    if (!l || l.startsWith("//")) continue;
    if (depth > 0 || l.startsWith("#[")) {
      cur += " " + l;
      depth += (l.match(/\[/g) ?? []).length - (l.match(/\]/g) ?? []).length;
      if (depth <= 0) {
        attrs += cur;
        cur = "";
        depth = 0;
      }
      continue;
    }
    const m = l.match(/^pub\s+(\w+)\s*:\s*(.+?),?$/);
    if (m) {
      out.push({ name: m[1]!, type: m[2]!.replace(/,$/, ""), attrs });
      attrs = "";
    }
  }
  return out;
}

function findStructs(code: string, filter: "all" | "accounts" | "plain" = "all"): Map<string, string> {
  const map = new Map<string, string>();
  const re = /pub struct (\w+)(<'info>)?\s*\{([\s\S]*?)\n\}/g;
  for (const m of code.matchAll(re)) {
    const isAccounts = Boolean(m[2]);
    if (filter === "accounts" && !isAccounts) continue;
    if (filter === "plain" && isAccounts) continue;
    map.set(m[1]!, m[3]!);
  }
  return map;
}

// ----------------------------------------------------------------- sources

const ixFiles = readdirSync(join(src, "instructions")).filter((f) => f.endsWith(".rs") && f !== "mod.rs");
const ixStructs = new Map<string, string>();
const typeStructs = new Map<string, string>();
for (const f of ixFiles) {
  const code = read(`instructions/${f}`);
  for (const [k, v] of findStructs(code, "accounts")) ixStructs.set(k, v);
  for (const [k, v] of findStructs(code, "plain")) typeStructs.set(k, v);
}
const stateCode = read("state/mod.rs");
const stateStructs = findStructs(stateCode);
const eventsCode = read("events.rs");
const errorsCode = read("errors.rs");
const libCode = read("lib.rs");
const constantsCode = read("constants.rs");

const FIXED: Record<string, string> = {
  system_program: "11111111111111111111111111111111",
  associated_token_program: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
};
const CONST_ADDR: Record<string, string> = {};
for (const m of constantsCode.matchAll(/pub const (\w+): Pubkey = pubkey!\("(\w+)"\)/g)) CONST_ADDR[m[1]!] = m[2]!;

// ------------------------------------------------------------ instructions

const programBody = libCode.split("pub mod float_router {")[1]!;
const instructions = [...programBody.matchAll(/pub fn (\w+)(?:<'info>)?\(\s*ctx: Context<(?:'_, '_, 'info, 'info, )?(\w+)(?:<'info>)?>,?([\s\S]*?)\) -> Result<\(\)>/g)].map((m) => {
  const [, name, accountsStruct, rawArgs] = m as unknown as [string, string, string, string];
  const body = ixStructs.get(accountsStruct);
  if (!body) throw new Error(`Accounts struct ${accountsStruct} not found`);
  const accounts = structFields(body).map((f) => {
    const writable = /#\[account\((?:[^)]*\b)?(mut|init|init_if_needed)\b/.test(f.attrs);
    const signer = /^Signer</.test(f.type);
    const acc: Record<string, unknown> = { name: f.name };
    if (writable) acc.writable = true;
    if (signer) acc.signer = true;
    const addr = f.attrs.match(/address = ([A-Z_]+)\b/);
    if (FIXED[f.name]) acc.address = FIXED[f.name];
    else if (addr && CONST_ADDR[addr[1]!]) acc.address = CONST_ADDR[addr[1]!];
    else if (/address = anchor_spl::token::ID/.test(f.attrs)) acc.address = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    return acc;
  });
  const args = rawArgs
    .split(/,(?![^<\[]*[>\]])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [n, t] = s.split(/:\s*/) as [string, string];
      return { name: n, type: mapType(t) };
    });
  return { name, discriminator: disc("global", name), accounts, args };
});

// ------------------------------------------------------------------- types

const typeDef = (name: string, body: string) => ({
  name,
  type: { kind: "struct", fields: structFields(body).map((f) => ({ name: f.name, type: mapType(f.type) })) },
});

const accountNames = [...stateCode.matchAll(/#\[account\]\s*#\[derive\(InitSpace\)\]\s*pub struct (\w+)/g)].map((m) => m[1]!);
const eventNames = [...eventsCode.matchAll(/#\[event\]\s*pub struct (\w+)/g)].map((m) => m[1]!);
const eventStructs = findStructs(eventsCode);

const types = [
  ...[...stateStructs].map(([n, b]) => typeDef(n, b)),
  ...[...typeStructs].map(([n, b]) => typeDef(n, b)),
  ...[...eventStructs].map(([n, b]) => typeDef(n, b)),
];

const errorBody = errorsCode.split("pub enum RouterError {")[1]!.split("\n}")[0]!;
const errors = [...errorBody.matchAll(/#\[msg\("([^"]+)"\)\]\s*(\w+),/g)].map((m, i) => ({ code: 6000 + i, name: m[2]!, msg: m[1]! }));

const programId = libCode.match(/declare_id!\("(\w+)"\)/)![1]!;
const version = readFileSync(join(root, "programs/float-router/Cargo.toml"), "utf8").match(/^version = "([^"]+)"/m)![1]!;

const idl = {
  address: programId,
  metadata: { name: "float_router", version, spec: "0.1.0", description: "Community reference implementation of Float's fee router" },
  instructions,
  accounts: accountNames.map((n) => ({ name: n, discriminator: disc("account", n) })),
  events: eventNames.map((n) => ({ name: n, discriminator: disc("event", n) })),
  errors,
  types,
};

const out = join(root, "packages/sdk/idl/float_router.json");
const json = JSON.stringify(idl, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const cur = readFileSync(out, "utf8");
  if (cur !== json) {
    console.error("packages/sdk/idl/float_router.json is stale — run: node scripts/dev/gen-router-idl.ts");
    process.exit(1);
  }
  console.log("float_router IDL is up to date");
} else {
  writeFileSync(out, json);
  console.log(`wrote ${out}: ${instructions.length} instructions, ${accountNames.length} accounts, ${eventNames.length} events, ${errors.length} errors`);
}
