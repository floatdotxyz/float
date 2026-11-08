import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Keypair, MINTS, PublicKey, RAYDIUM, Writer, buildAirdropTree, cpmm, getAssociatedTokenAddress, router } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sighash = (ns: string, n: string) => [...createHash("sha256").update(`${ns}:${n}`).digest().subarray(0, 8)];
const k = () => Keypair.generate().publicKey;
const client = new router.RouterClient();

test("committed float_router IDL matches the Rust source", () => {
  const out = execFileSync(process.execPath, ["scripts/dev/gen-router-idl.ts", "--check"], { cwd: root, encoding: "utf8" });
  assert.match(out, /up to date/);
});

test("IDL discriminators are Anchor sighashes", () => {
  for (const ix of router.routerCoder.idl.instructions) assert.deepEqual(ix.discriminator, sighash("global", ix.name));
  for (const a of router.routerCoder.idl.accounts ?? []) assert.deepEqual(a.discriminator, sighash("account", a.name));
  for (const e of router.routerCoder.idl.events ?? []) assert.deepEqual(e.discriminator, sighash("event", e.name));
});

test("router program id is its own, not Float's deployed program", () => {
  assert.ok(!router.ROUTER_PROGRAM_ID.equals(new PublicKey("3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX")));
});

const coin: router.CoinRecord = {
  mint: k(), paired_mint: MINTS.WSOL, launchlab_pool: k(), launcher: k(), creator_wallet: k(),
  ticker: new Uint8Array(10), ticker_len: 4, launched_at: 1n, graduated_at: 0n, reuse_fee: 0n, reuse_fee_settled: true,
  total_cycled: 0n, total_holders: 0n, total_creator: 0n, total_flagship: 0n, total_traders: 0n, total_treasury: 0n,
  holders_unpaid: 0n, pending_base_fees: 0n, bump: 255,
};
const cfg = { treasury: k(), launchlab_platform_config: k() };
const poolAddr = k();
const [m0, m1] = cpmm.sortMints(coin.mint, MINTS.WSOL);
const pool = {
  amm_config: k(), pool_creator: client.pda.authority(), token_0_vault: k(), token_1_vault: k(), lp_mint: k(),
  token_0_mint: m0, token_1_mint: m1, token_0_program: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  token_1_program: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), observation_key: k(),
} as unknown as cpmm.CpmmPool;

const builders: [string, () => ReturnType<typeof client.setPaused>][] = [
  ["initialize", () => client.initialize(k(), { operator: k(), treasury: k(), flagship_mint: k(), launchlab_platform_config: k() })],
  ["update_config", () => client.updateConfig(k(), { guard_bps: 150 })],
  ["set_paused", () => client.setPaused(k(), true)],
  ["propose_admin", () => client.proposeAdmin(k(), k())],
  ["accept_admin", () => client.acceptAdmin(k())],
  ["init_mint_vaults", () => client.initMintVaults(k(), MINTS.USDC)],
  ["register_coin", () => client.registerCoin(k(), coin.mint, MINTS.WSOL, "PEPE", k())],
  ["mark_graduated", () => client.markGraduated(coin)],
  ["settle_ticker_fee", () => client.settleTickerFee(coin, cfg.treasury)],
  ["cycle_launchlab", () => client.cycleLaunchLab(k(), coin, cfg, k())],
  ["cycle_cpmm", () => client.cycleCpmm(k(), coin, cfg, poolAddr, pool)],
  ["swap_base_fees", () => client.swapBaseFees(k(), coin, cfg, poolAddr, pool, 10n, router.Q64)],
  ["convert_vault", () => client.convertVault(k(), 2, MINTS.WSOL, poolAddr, pool, 10n, router.Q64)],
  ["execute_buyback", () => client.executeBuyback(k(), coin.mint, poolAddr, pool, 10n, router.Q64)],
  ["payout_holders", () => client.payoutHolders(k(), coin, 1n, [{ tokenAccount: k(), amount: 5n }, { tokenAccount: k(), amount: 6n }])],
  ["create_airdrop", () => client.createAirdrop(k(), 2n, new Uint8Array(32), 100n, 2_000_000_000n)],
  ["claim_airdrop", () => client.claimAirdrop(k(), 2n, 0, k(), 100n, [new Uint8Array(32), new Uint8Array(32)])],
  ["close_airdrop", () => client.closeAirdrop(k(), 2n)],
];

test("every IDL instruction has a client builder", () => {
  assert.deepEqual(builders.map((b) => b[0]).sort(), router.routerCoder.idl.instructions.map((i) => i.name).sort());
});

for (const [name, build] of builders) {
  test(`${name}: account count, flags and discriminator follow the IDL`, () => {
    const ix = build();
    const spec = router.routerCoder.instruction(name);
    const extra = name === "payout_holders" ? 2 : 0;
    assert.equal(ix.keys.length, spec.accounts.length + extra);
    spec.accounts.forEach((a, i) => {
      assert.equal(ix.keys[i]!.isSigner, !!a.signer, `${name}.${a.name} signer`);
      assert.equal(ix.keys[i]!.isWritable, !!a.writable, `${name}.${a.name} writable`);
    });
    assert.deepEqual([...ix.data.subarray(0, 8)], sighash("global", name));
    assert.ok(ix.programId.equals(router.ROUTER_PROGRAM_ID));
  });
}

test("cycle_cpmm routes to the paired-token ATAs of creator and treasury", () => {
  const ix = client.cycleCpmm(k(), coin, cfg, poolAddr, pool);
  const names = router.routerCoder.instruction("cycle_cpmm").accounts.map((a) => a.name);
  assert.ok(ix.keys[names.indexOf("creator_token")]!.pubkey.equals(getAssociatedTokenAddress(coin.creator_wallet, MINTS.WSOL)));
  assert.ok(ix.keys[names.indexOf("cpmm_authority")]!.pubkey.equals(RAYDIUM.cpmmAuthority));
  assert.ok(ix.keys[names.indexOf("holders_vault")]!.pubkey.equals(client.pda.vault(0, MINTS.WSOL)));
});

test("claim_airdrop encodes the proof as a vec of 32-byte nodes", () => {
  const tree = buildAirdropTree(9n, [{ wallet: k(), amount: 1n }, { wallet: k(), amount: 2n }, { wallet: k(), amount: 3n }]);
  const l = tree.leaves[2]!;
  const ix = client.claimAirdrop(k(), 9n, l.index, l.wallet, l.amount, l.proof);
  assert.equal(ix.data.length, 8 + 8 + 8 + 8 + 4 + 32 * l.proof.length);
});

test("RouterConfig encode → decode round-trip", () => {
  const w = new Writer().bytes(router.routerCoder.accountDiscriminator("RouterConfig"));
  const value = {
    admin: k(), pending_admin: PublicKey.default, operator: k(), treasury: k(), flagship_mint: k(), launchlab_platform_config: k(),
    split: { holders: 1500, creator: 500, flagship: 3500, traders: 3500, treasury: 1000 }, guard_bps: 200, max_impact_bps: 100,
    buyback_target_lamports: 5_000_000_000n, buyback_interval_secs: 14_400n, last_buyback_ts: 0n, total_burned: 42n, total_sol_spent: 1n,
    coins_registered: 3n, payout_rounds: 7n, paused: false, bump: 254, authority_bump: 253, _reserved: new Uint8Array(64),
  };
  router.routerCoder.encodeType({ defined: { name: "RouterConfig" } }, value, w);
  const d = router.decodeRouterConfig(w.toBytes());
  assert.equal(d.total_burned, 42n);
  assert.equal(d.split.flagship, 3500);
  assert.ok(d.operator.equals(value.operator));
});

test("vault PDAs differ by kind and mint", () => {
  const a = client.pda.vault(0, MINTS.WSOL), b = client.pda.vault(1, MINTS.WSOL), c = client.pda.vault(0, MINTS.USDC);
  assert.ok(!a.equals(b) && !a.equals(c));
});
