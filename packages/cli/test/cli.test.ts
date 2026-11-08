/**
 * End-to-end CLI tests against an in-process mock JSON-RPC server that serves
 * LaunchLab / CPMM / SPL accounts encoded with the vendored Raydium IDLs.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, MINTS, PublicKey, TOKEN_PROGRAM_ID, Writer, cpmm, launchLab, type IdlCoder } from "@float-community/sdk";
import { run } from "../src/main.ts";

const coin = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const platformAdmin = Keypair.generate().publicKey;
const platformConfig = launchLab.launchLabPda.platformConfig(platformAdmin);
const globalConfig = launchLab.launchLabPda.globalConfig(MINTS.WSOL, 0, 0);
const poolAddr = launchLab.launchLabPda.pool(coin, MINTS.WSOL);

function encodeAccount(coder: IdlCoder, name: string, value: Record<string, unknown>): Uint8Array {
  const w = new Writer().bytes(coder.accountDiscriminator(name));
  coder.encodeType({ defined: { name } }, value, w);
  return w.toBytes();
}

const fixed = (s: string, n: number) => {
  const b = new Uint8Array(n);
  b.set(new TextEncoder().encode(s));
  return b;
};

function poolData(overrides: Record<string, unknown> = {}) {
  return encodeAccount(launchLab.launchLabCoder, "PoolState", {
    epoch: 800n, auth_bump: 255, status: 0, base_decimals: 6, quote_decimals: 9, migrate_type: 1,
    supply: 1_000_000_000_000_000n, total_base_sell: 793_100_000_000_000n,
    virtual_base: 1_073_025_605_596_382n, virtual_quote: 30_000_852_951n,
    real_base: 200_000_000_000_000n, real_quote: 10_000_000_000n,
    total_quote_fund_raising: 85_000_000_000n, quote_protocol_fee: 1_000n, platform_fee: 2_000_000_000n, migrate_fee: 0n,
    vesting_schedule: { total_locked_amount: 0n, cliff_period: 0n, unlock_period: 0n, start_time: 0n, allocated_share_amount: 0n },
    global_config: globalConfig, platform_config: platformConfig, base_mint: coin, quote_mint: MINTS.WSOL,
    base_vault: launchLab.launchLabPda.vault(poolAddr, coin), quote_vault: launchLab.launchLabPda.vault(poolAddr, MINTS.WSOL),
    creator, token_program_flag: 0, amm_creator_fee_on: { kind: "QuoteToken" }, platform_vesting_share: 0n,
    padding: new Uint8Array(54),
    ...overrides,
  });
}

const globalData = encodeAccount(launchLab.launchLabCoder, "GlobalConfig", {
  epoch: 1n, curve_type: 0, index: 0, migrate_fee: 0n, trade_fee_rate: 2_500n, max_share_fee_rate: 10_000n,
  min_base_supply: 10_000_000n, max_lock_rate: 300_000n, min_base_sell_rate: 200_000n, min_base_migrate_rate: 200_000n,
  min_quote_fund_raising: 30_000_000_000n, quote_mint: MINTS.WSOL, protocol_fee_owner: PublicKey.default,
  migrate_fee_owner: PublicKey.default, migrate_to_amm_wallet: PublicKey.default, migrate_to_cpswap_wallet: PublicKey.default,
  requires_platform_auth: 0, padding_alignment: new Uint8Array(7), padding: Array(15).fill(0n),
});

const platformData = encodeAccount(launchLab.launchLabCoder, "PlatformConfig", {
  epoch: 1n, platform_fee_wallet: platformAdmin, platform_nft_wallet: platformAdmin, platform_scale: 0n, creator_scale: 0n,
  burn_scale: 1_000_000n, fee_rate: 7_500n, name: fixed("Float", 64), web: fixed("https://www.floatlaunch.xyz", 256),
  img: fixed("", 256), cpswap_config: cpmm.cpmmPda.ammConfig(0), creator_fee_rate: 0n,
  transfer_fee_extension_auth: PublicKey.default, platform_vesting_wallet: PublicKey.default, platform_vesting_scale: 0n,
  platform_cp_creator: PublicKey.default, padding: new Uint8Array(108), curve_params: [],
});

const mintData = (() => {
  const w = new Writer().u32(0).bytes(new Uint8Array(32)).u64(0n).u8(9).bool(true).u32(0).bytes(new Uint8Array(32));
  return w.toBytes();
})();

const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>([
  [poolAddr.toBase58(), { owner: launchLab.LAUNCHLAB_PROGRAM_ID, data: poolData() }],
  [globalConfig.toBase58(), { owner: launchLab.LAUNCHLAB_PROGRAM_ID, data: globalData }],
  [platformConfig.toBase58(), { owner: launchLab.LAUNCHLAB_PROGRAM_ID, data: platformData }],
  [MINTS.WSOL.toBase58(), { owner: TOKEN_PROGRAM_ID, data: mintData }],
]);

function rawAccount(addr: string) {
  const a = accounts.get(addr);
  if (!a) return null;
  return { data: [Buffer.from(a.data).toString("base64"), "base64"], owner: a.owner.toBase58(), lamports: 2_039_280, executable: false, rentEpoch: 0 };
}

let server: Server;
let rpc = "";

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      let result: unknown;
      if (method === "getAccountInfo") result = { context: { slot: 1 }, value: rawAccount(params[0]) };
      else if (method === "getMultipleAccounts") result = { context: { slot: 1 }, value: params[0].map(rawAccount) };
      else result = null;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  rpc = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(() => server.close());

async function cli(...argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await run([...argv, "--rpc", rpc], (s) => lines.push(s));
  return { code, out: lines.join("\n") };
}

test("pool: decodes LaunchLab pool, global and platform configs", async () => {
  const { code, out } = await cli("pool", coin.toBase58());
  assert.equal(code, 0, out);
  const j = JSON.parse(out);
  assert.equal(j.platform, "Float");
  assert.equal(j.stage, "bonding");
  assert.equal(j.bondingProgress, "11.76%");
  assert.equal(j.feeRates.platform, "0.750%");
  assert.equal(j.pendingPlatformFee, "2");
});

test("quote buy: 1 SOL pays 1% total fee", async () => {
  const { code, out } = await cli("quote", "buy", coin.toBase58(), "1");
  assert.equal(code, 0, out);
  const j = JSON.parse(out);
  assert.equal(j.fees.total, "0.01");
  assert.equal(j.fees.platform, "0.0075");
  assert.equal(j.graduatesOnThisBuy, false);
});

test("cycle: pending platform fee is routed through the Float split", async () => {
  const { code, out } = await cli("cycle", coin.toBase58(), "--json");
  assert.equal(code, 0, out);
  const j = JSON.parse(out);
  assert.equal(j.stage, "bonding");
  assert.equal(j.totalPending, "2000000000");
  assert.equal(j.split.flagship, "700000000");
  assert.equal(j.split.holders, "300000000");
  assert.equal(j.split.creator, "100000000");
});

test("cycle (table output) names every bucket", async () => {
  const { out } = await cli("cycle", coin.toBase58());
  for (const b of ["Holders", "Creator", "Flagship", "Traders", "Treasury"]) assert.match(out, new RegExp(b));
});

test("inspect: identifies a LaunchLab PlatformConfig by discriminator", async () => {
  const { out } = await cli("inspect", platformConfig.toBase58());
  const j = JSON.parse(out);
  assert.equal(j.type, "PlatformConfig");
  assert.equal(j.data.name, "Float");
  assert.equal(j.data.web, "https://www.floatlaunch.xyz");
});

test("inspect: decodes SPL mints", async () => {
  const { out } = await cli("inspect", MINTS.WSOL.toBase58());
  assert.equal(JSON.parse(out).data.decimals, 9);
});

test("airdrop: ranks a CSV of trades", async () => {
  const dir = mkdtempSync(join(tmpdir(), "float-"));
  const f = join(dir, "trades.csv");
  writeFileSync(f, [
    "wallet,coin,pair,side,timestamp,volume_usd",
    "alice,C1,SOL,buy,2026-11-05T10:00:00Z,500",
    "bob,C1,SOL,buy,2026-11-05T10:05:00Z,300",
    "alice,C2,SOL,sell,2026-11-06T09:00:00Z,250",
    "early,C1,SOL,buy,2026-11-03T09:00:00Z,99999",
  ].join("\n"));
  const { code, out } = await cli("airdrop", "--trades", f, "--round", "2", "--pot", "1000", "--csv");
  assert.equal(code, 0, out);
  const rows = out.split("\n");
  assert.equal(rows[0], "rank,wallet,volumeUsd,trades,usdc");
  assert.equal(rows[1], "1,alice,750.00,2,714.285714");
  assert.equal(rows[2], "2,bob,300.00,1,285.714285");
  assert.equal(rows.length, 3);
});

test("unknown command and usage errors return exit code 2", async () => {
  assert.equal((await cli("nope")).code, 2);
  assert.equal((await cli("airdrop")).code, 2);
});
