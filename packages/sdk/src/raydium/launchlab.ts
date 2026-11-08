/**
 * Raydium LaunchLab (`raydium_launchpad`) integration.
 *
 * Every Float coin starts life as a LaunchLab bonding-curve pool created on
 * Float's platform config. Trading fees on the curve are split by LaunchLab
 * into protocol / platform / creator buckets; the platform and creator
 * buckets are what Float later "cycles" into its fee split.
 *
 * Account layouts, discriminators and account ordering come from the vendored
 * IDL in `idl/raydium_launchpad.json`.
 */

import idlJson from "../../idl/raydium_launchpad.json" with { type: "json" };
import { IdlCoder, type Idl } from "../core/idl.ts";
import { PublicKey, findProgramAddress } from "../core/pubkey.ts";
import type { Connection } from "../core/rpc.ts";
import type { Instruction } from "../core/tx.ts";
import { decodeFixedString } from "../core/borsh.ts";
import { RAYDIUM, TOKEN_PROGRAM_ID } from "../programs/addresses.ts";
import { getAssociatedTokenAddress } from "../programs/spl.ts";
import { FEE_RATE_DENOMINATOR, ceilDiv, cpAmountIn, cpAmountOut, preFeeAmount } from "./math.ts";

export const launchLabCoder = new IdlCoder(idlJson as unknown as Idl);
export const LAUNCHLAB_PROGRAM_ID = launchLabCoder.programId;

// ------------------------------------------------------------------- PDAs

const enc = (s: string) => new TextEncoder().encode(s);
const u16le = (n: number) => Uint8Array.of(n & 0xff, (n >> 8) & 0xff);

export const launchLabPda = {
  authority: () => findProgramAddress([enc("vault_auth_seed")], LAUNCHLAB_PROGRAM_ID).address,
  eventAuthority: () => findProgramAddress([enc("__event_authority")], LAUNCHLAB_PROGRAM_ID).address,
  globalConfig: (quoteMint: PublicKey, curveType: number, index: number) =>
    findProgramAddress([enc("global_config"), quoteMint, Uint8Array.of(curveType), u16le(index)], LAUNCHLAB_PROGRAM_ID).address,
  platformConfig: (platformAdmin: PublicKey) =>
    findProgramAddress([enc("platform_config"), platformAdmin], LAUNCHLAB_PROGRAM_ID).address,
  pool: (baseMint: PublicKey, quoteMint: PublicKey) =>
    findProgramAddress([enc("pool"), baseMint, quoteMint], LAUNCHLAB_PROGRAM_ID).address,
  vault: (pool: PublicKey, mint: PublicKey) =>
    findProgramAddress([enc("pool_vault"), pool, mint], LAUNCHLAB_PROGRAM_ID).address,
  vesting: (pool: PublicKey, beneficiary: PublicKey) =>
    findProgramAddress([enc("pool_vesting"), pool, beneficiary], LAUNCHLAB_PROGRAM_ID).address,
  /** Per-platform fee vault (post-migration platform fees accumulate here). */
  platformFeeVault: (platformConfig: PublicKey, quoteMint: PublicKey) =>
    findProgramAddress([platformConfig, quoteMint], LAUNCHLAB_PROGRAM_ID).address,
  platformFeeVaultAuthority: () =>
    findProgramAddress([enc("platform_fee_vault_auth_seed")], LAUNCHLAB_PROGRAM_ID).address,
  /** Per-creator fee vault, keyed by creator wallet and quote mint. */
  creatorFeeVault: (creator: PublicKey, quoteMint: PublicKey) =>
    findProgramAddress([creator, quoteMint], LAUNCHLAB_PROGRAM_ID).address,
  creatorFeeVaultAuthority: () =>
    findProgramAddress([enc("creator_fee_vault_auth_seed")], LAUNCHLAB_PROGRAM_ID).address,
};

// --------------------------------------------------------------- accounts

export const PoolStatus = { Fund: 0, Migrate: 1, Trade: 2 } as const;
export type PoolStatusName = keyof typeof PoolStatus;

export interface LaunchLabVestingSchedule {
  total_locked_amount: bigint;
  cliff_period: bigint;
  unlock_period: bigint;
  start_time: bigint;
  allocated_share_amount: bigint;
}

export interface LaunchLabPool {
  epoch: bigint;
  auth_bump: number;
  /** 0 funding, 1 waiting for migration, 2 migrated */
  status: number;
  base_decimals: number;
  quote_decimals: number;
  /** 0 = Raydium AMM v4, 1 = CPMM */
  migrate_type: number;
  supply: bigint;
  total_base_sell: bigint;
  virtual_base: bigint;
  virtual_quote: bigint;
  real_base: bigint;
  real_quote: bigint;
  total_quote_fund_raising: bigint;
  quote_protocol_fee: bigint;
  platform_fee: bigint;
  migrate_fee: bigint;
  vesting_schedule: LaunchLabVestingSchedule;
  global_config: PublicKey;
  platform_config: PublicKey;
  base_mint: PublicKey;
  quote_mint: PublicKey;
  base_vault: PublicKey;
  quote_vault: PublicKey;
  creator: PublicKey;
  token_program_flag: number;
  amm_creator_fee_on: { kind: "QuoteToken" | "BothToken" };
  platform_vesting_share: bigint;
}

export interface LaunchLabGlobalConfig {
  epoch: bigint;
  curve_type: number;
  index: number;
  migrate_fee: bigint;
  trade_fee_rate: bigint;
  max_share_fee_rate: bigint;
  min_base_supply: bigint;
  max_lock_rate: bigint;
  min_base_sell_rate: bigint;
  min_base_migrate_rate: bigint;
  min_quote_fund_raising: bigint;
  quote_mint: PublicKey;
  protocol_fee_owner: PublicKey;
  migrate_fee_owner: PublicKey;
  migrate_to_amm_wallet: PublicKey;
  migrate_to_cpswap_wallet: PublicKey;
}

export interface LaunchLabPlatformConfig {
  epoch: bigint;
  platform_fee_wallet: PublicKey;
  platform_nft_wallet: PublicKey;
  platform_scale: bigint;
  creator_scale: bigint;
  burn_scale: bigint;
  fee_rate: bigint;
  name: string;
  web: string;
  img: string;
  cpswap_config: PublicKey;
  creator_fee_rate: bigint;
  transfer_fee_extension_auth: PublicKey;
  platform_vesting_wallet: PublicKey;
  platform_vesting_scale: bigint;
  platform_cp_creator: PublicKey;
  curve_params: unknown[];
}

export function decodeLaunchLabPool(data: Uint8Array): LaunchLabPool {
  return launchLabCoder.decodeAccount<LaunchLabPool>("PoolState", data);
}

export function decodeLaunchLabGlobalConfig(data: Uint8Array): LaunchLabGlobalConfig {
  return launchLabCoder.decodeAccount<LaunchLabGlobalConfig>("GlobalConfig", data);
}

export function decodeLaunchLabPlatformConfig(data: Uint8Array): LaunchLabPlatformConfig {
  const raw = launchLabCoder.decodeAccount<Record<string, unknown>>("PlatformConfig", data);
  return {
    ...(raw as unknown as LaunchLabPlatformConfig),
    name: decodeFixedString(raw.name as Uint8Array),
    web: decodeFixedString(raw.web as Uint8Array),
    img: decodeFixedString(raw.img as Uint8Array),
  };
}

export interface LaunchLabPoolBundle {
  address: PublicKey;
  pool: LaunchLabPool;
  globalConfig: LaunchLabGlobalConfig;
  platformConfig: LaunchLabPlatformConfig;
}

/** Fetches a pool together with the global and platform configs it references. */
export async function fetchLaunchLabPool(conn: Connection, address: PublicKey): Promise<LaunchLabPoolBundle> {
  const acc = await conn.getAccountInfo(address);
  if (!acc) throw new Error(`LaunchLab pool ${address.toBase58()} not found`);
  if (!acc.owner.equals(LAUNCHLAB_PROGRAM_ID)) throw new Error("Account is not owned by LaunchLab");
  const pool = decodeLaunchLabPool(acc.data);
  const [g, p] = await conn.getMultipleAccounts([pool.global_config, pool.platform_config]);
  if (!g || !p) throw new Error("Missing LaunchLab config accounts");
  return {
    address,
    pool,
    globalConfig: decodeLaunchLabGlobalConfig(g.data),
    platformConfig: decodeLaunchLabPlatformConfig(p.data),
  };
}

// ----------------------------------------------------------------- quoting

export interface FeeRates {
  /** LaunchLab protocol fee (GlobalConfig.trade_fee_rate). */
  protocol: bigint;
  /** Platform fee (PlatformConfig.fee_rate). For Float coins this funds the Float split. */
  platform: bigint;
  /** Creator fee (PlatformConfig.creator_fee_rate). */
  creator: bigint;
  /** Optional referral/share fee passed per trade. */
  share: bigint;
}

export function feeRatesOf(bundle: LaunchLabPoolBundle, shareFeeRate = 0n): FeeRates {
  return {
    protocol: bundle.globalConfig.trade_fee_rate,
    platform: bundle.platformConfig.fee_rate,
    creator: bundle.platformConfig.creator_fee_rate,
    share: shareFeeRate,
  };
}

export function totalFeeRate(r: FeeRates): bigint {
  const t = r.protocol + r.platform + r.creator + r.share;
  if (t > FEE_RATE_DENOMINATOR) throw new RangeError("Total fee rate exceeds 100%");
  return t;
}

export interface FeeBreakdown {
  total: bigint;
  protocol: bigint;
  platform: bigint;
  creator: bigint;
  share: bigint;
}

/** Splits a total fee pro-rata between buckets; protocol absorbs rounding dust. */
export function splitLaunchLabFee(totalFee: bigint, r: FeeRates): FeeBreakdown {
  const t = totalFeeRate(r);
  if (t === 0n) return { total: 0n, protocol: 0n, platform: 0n, creator: 0n, share: 0n };
  const platform = (totalFee * r.platform) / t;
  const creator = (totalFee * r.creator) / t;
  const share = (totalFee * r.share) / t;
  return { total: totalFee, platform, creator, share, protocol: totalFee - platform - creator - share };
}

export interface CurveQuote {
  amountIn: bigint;
  amountOut: bigint;
  fees: FeeBreakdown;
  /** Spot price (quote per base, raw units) before and after the trade. */
  priceBefore: number;
  priceAfter: number;
  /** True if the buy was capped by the remaining curve allocation (pool will graduate). */
  capped: boolean;
}

function reserves(pool: Pick<LaunchLabPool, "virtual_base" | "virtual_quote" | "real_base" | "real_quote">) {
  return {
    base: pool.virtual_base - pool.real_base,
    quote: pool.virtual_quote + pool.real_quote,
  };
}

export function spotPrice(pool: LaunchLabPool): number {
  const r = reserves(pool);
  return Number(r.quote) / Number(r.base);
}

/**
 * Quotes `buy_exact_in` on a constant-product LaunchLab curve (curve_type 0).
 * Fees are taken from the quote input before it hits the curve.
 */
export function quoteBuyExactIn(pool: LaunchLabPool, amountIn: bigint, rates: FeeRates): CurveQuote {
  const r = reserves(pool);
  const feeRate = totalFeeRate(rates);
  const fee = ceilDiv(amountIn, feeRate, FEE_RATE_DENOMINATOR);
  let out = cpAmountOut(amountIn - fee, r.quote, r.base);

  const remaining = pool.total_base_sell - pool.real_base;
  let realIn = amountIn;
  let totalFee = fee;
  let capped = false;
  if (out > remaining) {
    capped = true;
    out = remaining;
    const netIn = cpAmountIn(out, r.quote, r.base);
    realIn = preFeeAmount(netIn, feeRate);
    totalFee = realIn - netIn;
  }
  const after = { base: r.base - out, quote: r.quote + (realIn - totalFee) };
  return {
    amountIn: realIn,
    amountOut: out,
    fees: splitLaunchLabFee(totalFee, rates),
    priceBefore: Number(r.quote) / Number(r.base),
    priceAfter: Number(after.quote) / Number(after.base),
    capped,
  };
}

/** Quotes `sell_exact_in`: fees are taken from the quote output. */
export function quoteSellExactIn(pool: LaunchLabPool, amountIn: bigint, rates: FeeRates): CurveQuote {
  const r = reserves(pool);
  const gross = cpAmountOut(amountIn, r.base, r.quote);
  const fee = ceilDiv(gross, totalFeeRate(rates), FEE_RATE_DENOMINATOR);
  const after = { base: r.base + amountIn, quote: r.quote - gross };
  return {
    amountIn,
    amountOut: gross - fee,
    fees: splitLaunchLabFee(fee, rates),
    priceBefore: Number(r.quote) / Number(r.base),
    priceAfter: Number(after.quote) / Number(after.base),
    capped: false,
  };
}

/** Fraction of the curve sold so far (0..1); the coin graduates at 1. */
export function bondingProgress(pool: LaunchLabPool): number {
  if (pool.total_quote_fund_raising === 0n) return 0;
  return Math.min(1, Number(pool.real_quote) / Number(pool.total_quote_fund_raising));
}

// ------------------------------------------------------------ instructions

export interface TradeAccounts {
  payer: PublicKey;
  pool: PublicKey;
  poolState: LaunchLabPool;
  baseTokenProgram?: PublicKey;
}

function tradeAccounts(a: TradeAccounts): Record<string, PublicKey> {
  const baseProgram = a.baseTokenProgram ?? TOKEN_PROGRAM_ID;
  return {
    payer: a.payer,
    global_config: a.poolState.global_config,
    platform_config: a.poolState.platform_config,
    pool_state: a.pool,
    user_base_token: getAssociatedTokenAddress(a.payer, a.poolState.base_mint, baseProgram),
    user_quote_token: getAssociatedTokenAddress(a.payer, a.poolState.quote_mint, TOKEN_PROGRAM_ID),
    base_vault: a.poolState.base_vault,
    quote_vault: a.poolState.quote_vault,
    base_token_mint: a.poolState.base_mint,
    quote_token_mint: a.poolState.quote_mint,
    base_token_program: baseProgram,
  };
}

export function buyExactInIx(a: TradeAccounts, amountIn: bigint, minimumAmountOut: bigint, shareFeeRate = 0n): Instruction {
  return launchLabCoder.buildInstruction("buy_exact_in", tradeAccounts(a), {
    amount_in: amountIn,
    minimum_amount_out: minimumAmountOut,
    share_fee_rate: shareFeeRate,
  });
}

export function sellExactInIx(a: TradeAccounts, amountIn: bigint, minimumAmountOut: bigint, shareFeeRate = 0n): Instruction {
  return launchLabCoder.buildInstruction("sell_exact_in", tradeAccounts(a), {
    amount_in: amountIn,
    minimum_amount_out: minimumAmountOut,
    share_fee_rate: shareFeeRate,
  });
}

/** Claims the platform fee still held in a pool's quote vault (pre-migration). */
export function claimPlatformFeeIx(platformFeeWallet: PublicKey, pool: PublicKey, poolState: LaunchLabPool): Instruction {
  return launchLabCoder.buildInstruction("claim_platform_fee", {
    platform_fee_wallet: platformFeeWallet,
    pool_state: pool,
    platform_config: poolState.platform_config,
    quote_vault: poolState.quote_vault,
    quote_mint: poolState.quote_mint,
  });
}

/** Claims platform fees accumulated in the per-platform fee vault. */
export function claimPlatformFeeFromVaultIx(platformFeeWallet: PublicKey, platformConfig: PublicKey, quoteMint: PublicKey): Instruction {
  return launchLabCoder.buildInstruction("claim_platform_fee_from_vault", {
    platform_fee_wallet: platformFeeWallet,
    platform_config: platformConfig,
    fee_vault_authority: launchLabPda.platformFeeVaultAuthority(),
    platform_fee_vault: launchLabPda.platformFeeVault(platformConfig, quoteMint),
    quote_mint: quoteMint,
  });
}

/** Claims creator fees accumulated in the creator's fee vault. */
export function claimCreatorFeeIx(creator: PublicKey, quoteMint: PublicKey): Instruction {
  return launchLabCoder.buildInstruction("claim_creator_fee", {
    creator,
    fee_vault_authority: launchLabPda.creatorFeeVaultAuthority(),
    creator_fee_vault: launchLabPda.creatorFeeVault(creator, quoteMint),
    quote_mint: quoteMint,
  });
}

/** Decodes LaunchLab `TradeEvent`s from Anchor event-CPI instruction data. */
export function decodeTradeEvent(ixData: Uint8Array): Record<string, unknown> | undefined {
  // Event CPI data = EVENT_IX_TAG (8 bytes) || event discriminator || payload
  const EVENT_IX_TAG = Uint8Array.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);
  if (ixData.length < 16 || !Buffer.from(ixData.subarray(0, 8)).equals(Buffer.from(EVENT_IX_TAG))) return undefined;
  try {
    return launchLabCoder.decodeEvent("TradeEvent", ixData.subarray(8));
  } catch {
    return undefined;
  }
}

export { RAYDIUM };
