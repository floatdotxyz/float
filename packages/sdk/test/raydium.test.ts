import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PublicKey,
  Writer,
  Keypair,
  MINTS,
  RAYDIUM,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  launchLab,
  cpmm,
  burnAndEarn,
  FEE_RATE_DENOMINATOR,
  type Idl,
} from "../src/index.ts";

const sighash = (ns: string, name: string) => [...createHash("sha256").update(`${ns}:${name}`).digest().subarray(0, 8)];

for (const [label, coder] of [["LaunchLab", launchLab.launchLabCoder], ["CPMM", cpmm.cpmmCoder]] as const) {
  test(`${label} IDL: instruction discriminators match sha256("global:<name>")`, () => {
    for (const ix of coder.idl.instructions) assert.deepEqual(ix.discriminator, sighash("global", ix.name), ix.name);
  });
  test(`${label} IDL: account discriminators match sha256("account:<Name>")`, () => {
    for (const a of coder.idl.accounts ?? []) assert.deepEqual(a.discriminator, sighash("account", a.name), a.name);
  });
}

test("IDL program ids match the addresses Float documents", () => {
  assert.ok(launchLab.LAUNCHLAB_PROGRAM_ID.equals(RAYDIUM.launchLab));
  assert.ok(cpmm.CPMM_PROGRAM_ID.equals(RAYDIUM.cpmm));
  assert.ok(burnAndEarn.BURN_AND_EARN_PROGRAM_ID.equals(RAYDIUM.burnAndEarn));
});

test("PDA helpers agree with IDL-declared authorities", () => {
  assert.ok(launchLab.launchLabPda.authority().equals(RAYDIUM.launchLabAuthority));
  assert.ok(cpmm.cpmmPda.authority().equals(RAYDIUM.cpmmAuthority));
  assert.ok(burnAndEarn.lockPda.authority().equals(RAYDIUM.burnAndEarnAuthority));
});

// ---------------------------------------------------------------- LaunchLab

const coin = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const platformConfig = Keypair.generate().publicKey;
const globalConfig = Keypair.generate().publicKey;

function samplePool(overrides: Partial<launchLab.LaunchLabPool> = {}): launchLab.LaunchLabPool {
  const pool = launchLab.launchLabPda.pool(coin, MINTS.WSOL);
  return {
    epoch: 800n,
    auth_bump: 255,
    status: 0,
    base_decimals: 6,
    quote_decimals: 9,
    migrate_type: 1,
    supply: 1_000_000_000_000_000n,
    total_base_sell: 793_100_000_000_000n,
    virtual_base: 1_073_025_605_596_382n,
    virtual_quote: 30_000_852_951n,
    real_base: 0n,
    real_quote: 0n,
    total_quote_fund_raising: 85_000_000_000n,
    quote_protocol_fee: 0n,
    platform_fee: 0n,
    migrate_fee: 0n,
    vesting_schedule: { total_locked_amount: 0n, cliff_period: 0n, unlock_period: 0n, start_time: 0n, allocated_share_amount: 0n },
    global_config: globalConfig,
    platform_config: platformConfig,
    base_mint: coin,
    quote_mint: MINTS.WSOL,
    base_vault: launchLab.launchLabPda.vault(pool, coin),
    quote_vault: launchLab.launchLabPda.vault(pool, MINTS.WSOL),
    creator,
    token_program_flag: 0,
    amm_creator_fee_on: { kind: "QuoteToken" },
    platform_vesting_share: 0n,
    ...overrides,
  };
}

const rates: launchLab.FeeRates = { protocol: 2_500n, platform: 7_500n, creator: 0n, share: 0n };

test("LaunchLab PoolState encode → decode round-trip via the IDL", () => {
  const coder = launchLab.launchLabCoder;
  const p = samplePool({ real_base: 5n, platform_fee: 42n });
  const w = new Writer().bytes(coder.accountDiscriminator("PoolState"));
  coder.encodeType({ defined: { name: "PoolState" } }, { ...p, amm_creator_fee_on: { kind: "QuoteToken" }, padding: new Uint8Array(54) }, w);
  const decoded = launchLab.decodeLaunchLabPool(w.toBytes());
  assert.equal(decoded.platform_fee, 42n);
  assert.equal(decoded.real_base, 5n);
  assert.ok(decoded.creator.equals(creator));
  assert.equal(decoded.amm_creator_fee_on.kind, "QuoteToken");
  assert.equal(coder.identifyAccount(w.toBytes()), "PoolState");
});

test("LaunchLab fee split is pro rata and sums to the total", () => {
  const s = launchLab.splitLaunchLabFee(1_000_003n, { protocol: 2_500n, platform: 7_500n, creator: 1_000n, share: 0n });
  assert.equal(s.protocol + s.platform + s.creator + s.share, 1_000_003n);
  assert.equal(s.platform, (1_000_003n * 7_500n) / 11_000n);
});

test("LaunchLab buy quote charges ceil fees on input and moves price up", () => {
  const pool = samplePool();
  const q = launchLab.quoteBuyExactIn(pool, 1_000_000_000n, rates);
  assert.equal(q.fees.total, 10_000_000n); // 1% of 1 SOL
  assert.equal(q.fees.platform, 7_500_000n);
  assert.ok(q.amountOut > 0n);
  assert.ok(q.priceAfter > q.priceBefore);
  assert.equal(q.capped, false);
});

test("LaunchLab buy is capped at the remaining curve allocation", () => {
  const pool = samplePool({ real_base: 793_000_000_000_000n, real_quote: 84_000_000_000n });
  const q = launchLab.quoteBuyExactIn(pool, 50_000_000_000n, rates);
  assert.equal(q.capped, true);
  assert.equal(q.amountOut, pool.total_base_sell - pool.real_base);
  assert.ok(q.amountIn < 50_000_000_000n);
});

test("LaunchLab sell takes fees from output", () => {
  const pool = samplePool({ real_base: 100_000_000_000_000n, real_quote: 3_200_000_000n });
  const q = launchLab.quoteSellExactIn(pool, 1_000_000_000_000n, rates);
  assert.ok(q.fees.total > 0n);
  assert.ok(q.priceAfter < q.priceBefore);
});

test("buy_exact_in instruction resolves accounts from the IDL", () => {
  const payer = Keypair.generate().publicKey;
  const pool = samplePool();
  const poolAddr = launchLab.launchLabPda.pool(coin, MINTS.WSOL);
  const ix = launchLab.buyExactInIx({ payer, pool: poolAddr, poolState: pool }, 1_000_000_000n, 1n);
  const names = launchLab.launchLabCoder.instruction("buy_exact_in").accounts.map((a) => a.name);
  assert.equal(ix.keys.length, names.length);
  const at = (n: string) => ix.keys[names.indexOf(n)]!;
  assert.ok(at("payer").pubkey.equals(payer) && at("payer").isSigner);
  assert.ok(at("authority").pubkey.equals(RAYDIUM.launchLabAuthority));
  assert.ok(at("event_authority").pubkey.equals(launchLab.launchLabPda.eventAuthority()));
  assert.ok(at("program").pubkey.equals(RAYDIUM.launchLab));
  assert.ok(at("quote_token_program").pubkey.equals(TOKEN_PROGRAM_ID));
  assert.ok(at("user_quote_token").pubkey.equals(getAssociatedTokenAddress(payer, MINTS.WSOL)));
  assert.deepEqual([...ix.data.subarray(0, 8)], sighash("global", "buy_exact_in"));
  assert.equal(ix.data.length, 8 + 24);
});

test("claim_platform_fee resolves the recipient ATA PDA declared in the IDL", () => {
  const wallet = Keypair.generate().publicKey;
  const pool = samplePool();
  const ix = launchLab.claimPlatformFeeIx(wallet, launchLab.launchLabPda.pool(coin, MINTS.WSOL), pool);
  const names = launchLab.launchLabCoder.instruction("claim_platform_fee").accounts.map((a) => a.name);
  assert.ok(ix.keys[names.indexOf("recipient_token_account")]!.pubkey.equals(getAssociatedTokenAddress(wallet, MINTS.WSOL)));
});

test("claim_creator_fee targets the creator fee vault PDA", () => {
  const ix = launchLab.claimCreatorFeeIx(creator, MINTS.WSOL);
  const names = launchLab.launchLabCoder.instruction("claim_creator_fee").accounts.map((a) => a.name);
  assert.ok(ix.keys[names.indexOf("creator_fee_vault")]!.pubkey.equals(launchLab.launchLabPda.creatorFeeVault(creator, MINTS.WSOL)));
});

test("bonding progress", () => {
  assert.equal(launchLab.bondingProgress(samplePool({ real_quote: 42_500_000_000n })), 0.5);
});

// --------------------------------------------------------------------- CPMM

test("CPMM swap_base_input matches the Rust calculator (fee on input)", () => {
  const r = cpmm.swapBaseInput({
    amountIn: 1_000_000n,
    inputReserve: 100_000_000n,
    outputReserve: 50_000_000n,
    tradeFeeRate: 2_500n,
    creatorFeeRate: 500n,
    protocolFeeRate: 120_000n,
    fundFeeRate: 40_000n,
    creatorFeeOnInput: true,
  });
  // total fee = ceil(1e6 * 3000 / 1e6) = 3000; creator = floor(3000*500/3000) = 500
  assert.equal(r.creatorFee, 500n);
  assert.equal(r.tradeFee, 2_500n);
  assert.equal(r.protocolFee, 300n);
  assert.equal(r.fundFee, 100n);
  // out = floor(997000 * 5e7 / (1e8 + 997000))
  assert.equal(r.outputAmount, (997_000n * 50_000_000n) / 100_997_000n);
});

test("CPMM swap_base_input (creator fee on output)", () => {
  const r = cpmm.swapBaseInput({
    amountIn: 1_000_000n,
    inputReserve: 100_000_000n,
    outputReserve: 50_000_000n,
    tradeFeeRate: 2_500n,
    creatorFeeRate: 500n,
    protocolFeeRate: 0n,
    fundFeeRate: 0n,
    creatorFeeOnInput: false,
  });
  const swapped = (997_500n * 50_000_000n) / 100_997_500n;
  const creatorFee = (swapped * 500n + FEE_RATE_DENOMINATOR - 1n) / FEE_RATE_DENOMINATOR;
  assert.equal(r.creatorFee, creatorFee);
  assert.equal(r.outputAmount, swapped - creatorFee);
});

test("CPMM invariant never decreases", () => {
  for (const amt of [1n, 10n, 12_345n, 9_999_999n]) {
    const r = cpmm.swapBaseInput({
      amountIn: amt, inputReserve: 7_777_777n, outputReserve: 3_333_333n,
      tradeFeeRate: 2_500n, creatorFeeRate: 0n, protocolFeeRate: 0n, fundFeeRate: 0n, creatorFeeOnInput: true,
    });
    assert.ok(r.newInputReserve * r.newOutputReserve >= 7_777_777n * 3_333_333n);
  }
});

test("creator_fee_on direction rules", () => {
  assert.equal(cpmm.isCreatorFeeOnInput(0, true), true);
  assert.equal(cpmm.isCreatorFeeOnInput(1, true), true);
  assert.equal(cpmm.isCreatorFeeOnInput(1, false), false);
  assert.equal(cpmm.isCreatorFeeOnInput(2, false), true);
});

test("CPMM mints sort by byte order and pool PDA depends on config", () => {
  const [a, b] = cpmm.sortMints(MINTS.WSOL, MINTS.USDC);
  assert.ok(a.compare(b) < 0);
  const cfg0 = cpmm.cpmmPda.ammConfig(0);
  const cfg1 = cpmm.cpmmPda.ammConfig(1);
  assert.ok(!cpmm.cpmmPda.pool(cfg0, a, b).equals(cpmm.cpmmPda.pool(cfg1, a, b)));
});

function sampleCpmmBundle(): cpmm.CpmmPoolBundle {
  const address = Keypair.generate().publicKey;
  const [m0, m1] = cpmm.sortMints(MINTS.WSOL, coin);
  return {
    address,
    pool: {
      amm_config: cpmm.cpmmPda.ammConfig(0),
      pool_creator: creator,
      token_0_vault: cpmm.cpmmPda.vault(address, m0),
      token_1_vault: cpmm.cpmmPda.vault(address, m1),
      lp_mint: cpmm.cpmmPda.lpMint(address),
      token_0_mint: m0,
      token_1_mint: m1,
      token_0_program: TOKEN_PROGRAM_ID,
      token_1_program: TOKEN_PROGRAM_ID,
      observation_key: cpmm.cpmmPda.observation(address),
      auth_bump: 253, status: 0, lp_mint_decimals: 9, mint_0_decimals: 9, mint_1_decimals: 6,
      lp_supply: 1_000_000n,
      protocol_fees_token_0: 10n, protocol_fees_token_1: 10n, fund_fees_token_0: 5n, fund_fees_token_1: 5n,
      open_time: 0n, recent_epoch: 0n, creator_fee_on: 0, enable_creator_fee: true,
      creator_fees_token_0: 100n, creator_fees_token_1: 0n,
    },
    config: {
      bump: 255, disable_create_pool: false, index: 0, trade_fee_rate: 2_500n, protocol_fee_rate: 120_000n,
      fund_fee_rate: 40_000n, create_pool_fee: 0n, protocol_owner: PublicKey.default, fund_owner: PublicKey.default, creator_fee_rate: 500n,
    },
    vault0: 1_000_000_000n,
    vault1: 2_000_000_000n,
  };
}

test("tradable reserves exclude owed fees", () => {
  const b = sampleCpmmBundle();
  const r = cpmm.tradableReserves(b);
  assert.equal(r.reserve0, 1_000_000_000n - 115n);
  assert.equal(r.reserve1, 2_000_000_000n - 15n);
});

test("swap_base_input instruction follows the IDL account order", () => {
  const b = sampleCpmmBundle();
  const payer = Keypair.generate().publicKey;
  const ix = cpmm.swapBaseInputIx(payer, b, b.pool.token_1_mint, 1_000n, 1n);
  const names = cpmm.cpmmCoder.instruction("swap_base_input").accounts.map((a) => a.name);
  assert.equal(ix.keys.length, names.length);
  assert.ok(ix.keys[names.indexOf("authority")]!.pubkey.equals(RAYDIUM.cpmmAuthority));
  assert.ok(ix.keys[names.indexOf("input_vault")]!.pubkey.equals(b.pool.token_1_vault));
  assert.ok(ix.keys[names.indexOf("output_vault")]!.pubkey.equals(b.pool.token_0_vault));
});

test("permissionless creator-fee collection uses the documented discriminator and 16 accounts", () => {
  const b = sampleCpmmBundle();
  const ix = cpmm.collectCreatorFeePermissionlessIx(Keypair.generate().publicKey, b);
  assert.deepEqual([...ix.data], sighash("global", "collect_creator_fee_permissionless"));
  assert.equal(ix.keys.length, 16);
});

test("Burn & Earn collect_cp_fees layout", () => {
  const b = sampleCpmmBundle();
  const owner = Keypair.generate().publicKey;
  const nft = Keypair.generate().publicKey;
  const ix = burnAndEarn.collectCpFeesIx({ nftOwner: owner, nftMint: nft, pool: b, lpFeeAmount: 1234n });
  assert.deepEqual([...ix.data.subarray(0, 8)], sighash("global", "collect_cp_fees"));
  assert.equal(ix.data.length, 16);
  assert.ok(ix.keys[3]!.pubkey.equals(burnAndEarn.lockPda.lockedLiquidity(nft)));
  assert.equal(ix.keys.length, 18);
});

test("IDL coder decodes enums with tuple fields", () => {
  const coder = launchLab.launchLabCoder;
  const w = new Writer();
  coder.encodeType({ defined: { name: "PlatformConfigParam" } }, { kind: "FeeRate", 0: 5_000n } as unknown, w);
  // FeeRate is variant index 3 with a single u64
  assert.equal(w.toBytes()[0], 3);
  assert.equal(w.toBytes().length, 9);
  void ({} as Idl);
});

test("CPMM PoolState/AmmConfig byte offsets used by float-core match the IDL encoding", () => {
  const b = sampleCpmmBundle();
  const coder = cpmm.cpmmCoder;
  const w = new Writer().bytes(coder.accountDiscriminator("PoolState"));
  coder.encodeType({ defined: { name: "PoolState" } }, { ...b.pool, padding1: new Uint8Array(6), padding: Array(28).fill(0n) }, w);
  const d = Buffer.from(w.toBytes());
  assert.equal(d.length, 637);
  assert.deepEqual(d.subarray(40, 72), Buffer.from(b.pool.pool_creator.bytes));
  assert.deepEqual(d.subarray(72, 104), Buffer.from(b.pool.token_0_vault.bytes));
  assert.deepEqual(d.subarray(168, 200), Buffer.from(b.pool.token_0_mint.bytes));
  assert.deepEqual(d.subarray(296, 328), Buffer.from(b.pool.observation_key.bytes));
  assert.equal(d.readBigUInt64LE(341), b.pool.protocol_fees_token_0);
  assert.equal(d.readBigUInt64LE(357), b.pool.fund_fees_token_0);
  assert.equal(d[389], b.pool.creator_fee_on);
  assert.equal(d[390], 1);
  assert.equal(d.readBigUInt64LE(397), b.pool.creator_fees_token_0);

  const wc = new Writer().bytes(coder.accountDiscriminator("AmmConfig"));
  coder.encodeType({ defined: { name: "AmmConfig" } }, { ...b.config, padding: Array(15).fill(0n) }, wc);
  const c = Buffer.from(wc.toBytes());
  assert.equal(c.readBigUInt64LE(12), b.config.trade_fee_rate);
  assert.equal(c.readBigUInt64LE(20), b.config.protocol_fee_rate);
  assert.equal(c.readBigUInt64LE(28), b.config.fund_fee_rate);
  assert.equal(c.readBigUInt64LE(108), b.config.creator_fee_rate);
});
