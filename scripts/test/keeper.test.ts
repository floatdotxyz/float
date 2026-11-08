/**
 * Runs `scripts/keeper/keeper.ts --once` against a mock JSON-RPC that serves a
 * router config, one registered coin and its LaunchLab pool with pending
 * platform fees, and checks that the keeper simulates a `cycle_launchlab`
 * transaction with the right accounts.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeBase58, encodeBase58, Keypair, MINTS, PublicKey, Reader, Writer, cpmm, launchLab, router, type IdlCoder } from "@float-community/sdk";

const root = fileURLToPath(new URL("../../", import.meta.url));
const client = new router.RouterClient();

function encode(coder: IdlCoder, name: string, value: Record<string, unknown>) {
  const w = new Writer().bytes(coder.accountDiscriminator(name));
  coder.encodeType({ defined: { name } }, value, w);
  return w.toBytes();
}
const k = () => Keypair.generate().publicKey;
const fixed = (s: string, n: number) => { const b = new Uint8Array(n); b.set(new TextEncoder().encode(s)); return b; };

const coinMint = k();
const platformConfig = k();
const treasury = k();
const creatorWallet = k();
const launcher = k();
const poolAddr = launchLab.launchLabPda.pool(coinMint, MINTS.WSOL);
const quoteVault = launchLab.launchLabPda.vault(poolAddr, MINTS.WSOL);

const config = encode(router.routerCoder, "RouterConfig", {
  admin: k(), pending_admin: PublicKey.default, operator: k(), treasury, flagship_mint: k(), launchlab_platform_config: platformConfig,
  split: { holders: 1500, creator: 500, flagship: 3500, traders: 3500, treasury: 1000 }, guard_bps: 200, max_impact_bps: 100,
  buyback_target_lamports: 5_000_000_000n, buyback_interval_secs: 14_400n, last_buyback_ts: 0n, total_burned: 0n, total_sol_spent: 0n,
  coins_registered: 1n, payout_rounds: 0n, paused: false, bump: 255, authority_bump: 255, _reserved: new Uint8Array(64),
});
const coin = encode(router.routerCoder, "CoinRecord", {
  mint: coinMint, paired_mint: MINTS.WSOL, launchlab_pool: poolAddr, launcher, creator_wallet: creatorWallet,
  ticker: fixed("PEPE", 10), ticker_len: 4, launched_at: BigInt(Math.floor(Date.now() / 1000)), graduated_at: 0n, reuse_fee: 0n,
  reuse_fee_settled: true, total_cycled: 0n, total_holders: 0n, total_creator: 0n, total_flagship: 0n, total_traders: 0n,
  total_treasury: 0n, holders_unpaid: 0n, pending_base_fees: 0n, bump: 255, _reserved: new Uint8Array(32),
});
const pool = encode(launchLab.launchLabCoder, "PoolState", {
  epoch: 1n, auth_bump: 255, status: 0, base_decimals: 6, quote_decimals: 9, migrate_type: 1, supply: 1_000_000_000_000_000n,
  total_base_sell: 793_100_000_000_000n, virtual_base: 1_073_025_605_596_382n, virtual_quote: 30_000_852_951n, real_base: 1n, real_quote: 1n,
  total_quote_fund_raising: 85_000_000_000n, quote_protocol_fee: 0n, platform_fee: 777_000n, migrate_fee: 0n,
  vesting_schedule: { total_locked_amount: 0n, cliff_period: 0n, unlock_period: 0n, start_time: 0n, allocated_share_amount: 0n },
  global_config: k(), platform_config: platformConfig, base_mint: coinMint, quote_mint: MINTS.WSOL,
  base_vault: launchLab.launchLabPda.vault(poolAddr, coinMint), quote_vault: quoteVault, creator: launcher,
  token_program_flag: 0, amm_creator_fee_on: { kind: "QuoteToken" }, platform_vesting_share: 0n, padding: new Uint8Array(54),
});
const platform = encode(launchLab.launchLabCoder, "PlatformConfig", {
  epoch: 1n, platform_fee_wallet: client.pda.authority(), platform_nft_wallet: k(), platform_scale: 0n, creator_scale: 0n, burn_scale: 1_000_000n,
  fee_rate: 7_500n, name: fixed("Router", 64), web: fixed("", 256), img: fixed("", 256), cpswap_config: cpmm.cpmmPda.ammConfig(0),
  creator_fee_rate: 0n, transfer_fee_extension_auth: PublicKey.default, platform_vesting_wallet: PublicKey.default, platform_vesting_scale: 0n,
  platform_cp_creator: client.pda.authority(), padding: new Uint8Array(108), curve_params: [],
});

const accounts = new Map<string, { owner: PublicKey; data: Uint8Array }>([
  [client.pda.config().toBase58(), { owner: router.ROUTER_PROGRAM_ID, data: config }],
  [poolAddr.toBase58(), { owner: launchLab.LAUNCHLAB_PROGRAM_ID, data: pool }],
  [platformConfig.toBase58(), { owner: launchLab.LAUNCHLAB_PROGRAM_ID, data: platform }],
]);
const raw = (addr: string) => {
  const a = accounts.get(addr);
  return a ? { data: [Buffer.from(a.data).toString("base64"), "base64"], owner: a.owner.toBase58(), lamports: 1, executable: false } : null;
};

const simulated: Buffer[] = [];
let server: Server;
let url = "";

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { id, method, params } = JSON.parse(body);
      const ok = (result: unknown) => res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      switch (method) {
        case "getAccountInfo": return ok({ value: raw(params[0]) });
        case "getMultipleAccounts": return ok({ value: params[0].map(raw) });
        case "getProgramAccounts":
          return ok(params[0] === router.ROUTER_PROGRAM_ID.toBase58()
            ? [{ pubkey: client.pda.coin(coinMint).toBase58(), account: { data: [Buffer.from(coin).toString("base64"), "base64"], owner: params[0], lamports: 1, executable: false } }]
            : []);
        case "getLatestBlockhash": return ok({ value: { blockhash: encodeBase58(new Uint8Array(32).fill(7)), lastValidBlockHeight: 1 } });
        case "simulateTransaction":
          simulated.push(Buffer.from(params[0], "base64"));
          return ok({ value: { err: null, logs: [], unitsConsumed: 54_321 } });
        default: return ok(null);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
after(() => server.close());

function keypairFile(): string {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const p = join(mkdtempSync(join(tmpdir(), "kp-")), "id.json");
  writeFileSync(p, JSON.stringify([...seed, ...pub]));
  return p;
}

/** Parses a legacy wire transaction into (programId, accountKeys, data) per instruction. */
function parseTx(wire: Buffer) {
  const r = new Reader(new Uint8Array(wire));
  const sv = () => { let n = 0, s = 0; for (;;) { const b = r.u8(); n |= (b & 0x7f) << s; if (!(b & 0x80)) return n; s += 7; } };
  const nsig = sv(); r.bytes(64 * nsig);
  r.u8(); r.u8(); r.u8();
  const keys = Array.from({ length: sv() }, () => r.pubkey());
  r.bytes(32);
  return Array.from({ length: sv() }, () => {
    const program = keys[r.u8()]!;
    const accs = Array.from({ length: sv() }, () => keys[r.u8()]!);
    const data = r.bytes(sv());
    return { program, accs, data };
  });
}

test("keeper --once simulates cycle_launchlab for a coin with pending platform fees", async () => {
  const out = await new Promise<string>((resolve, reject) =>
    execFile(process.execPath, ["scripts/keeper/keeper.ts", "--once", "--keypair", keypairFile()], { cwd: root, env: { ...process.env, SOLANA_RPC_URL: url } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout + stderr))));
  assert.match(out, /cycle_launchlab \(777000 raw\): simulated ok/);

  const ixs = simulated.flatMap(parseTx);
  const cycle = ixs.find((i) => i.program.equals(router.ROUTER_PROGRAM_ID));
  assert.ok(cycle, "router instruction present");
  assert.deepEqual([...cycle.data.subarray(0, 8)], router.routerCoder.instruction("cycle_launchlab").discriminator);
  const names = router.routerCoder.instruction("cycle_launchlab").accounts.map((a) => a.name);
  assert.ok(cycle.accs[names.indexOf("pool_quote_vault")]!.equals(quoteVault));
  assert.ok(cycle.accs[names.indexOf("launchlab_platform_config")]!.equals(platformConfig));
  assert.ok(cycle.accs[names.indexOf("authority")]!.equals(client.pda.authority()));
  // ATA creation for creator and treasury precedes the cycle.
  assert.equal(ixs.filter((i) => i.program.toBase58() === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").length, 2);
  void decodeBase58;
});
