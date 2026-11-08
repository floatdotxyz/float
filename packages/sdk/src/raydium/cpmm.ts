/**
 * Raydium CPMM (`raydium_cp_swap`) integration.
 *
 * When a Float coin graduates, LaunchLab migrates its liquidity into a CPMM
 * pool. Trading fees on that pool keep flowing to Float through the CPMM
 * creator fee and the Burn & Earn position NFTs (see `lock.ts`).
 *
 * The swap math below is a line-by-line port of
 * `vendor/raydium/cp-swap-src/curve/calculator.rs::swap_base_input`.
 */

import idlJson from "../../idl/raydium_cp_swap.json" with { type: "json" };
import { IdlCoder, type Idl } from "../core/idl.ts";
import { PublicKey, findProgramAddress } from "../core/pubkey.ts";
import type { Connection } from "../core/rpc.ts";
import type { Instruction } from "../core/tx.ts";
import { ASSOCIATED_TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from "../programs/addresses.ts";
import { decodeTokenAccount, getAssociatedTokenAddress } from "../programs/spl.ts";
import { FEE_RATE_DENOMINATOR, ceilDiv, cpAmountOut, floorDiv } from "./math.ts";

export const cpmmCoder = new IdlCoder(idlJson as unknown as Idl);
export const CPMM_PROGRAM_ID = cpmmCoder.programId;

const enc = (s: string) => new TextEncoder().encode(s);
const u16be = (n: number) => Uint8Array.of((n >> 8) & 0xff, n & 0xff);

export const cpmmPda = {
  authority: () => findProgramAddress([enc("vault_and_lp_mint_auth_seed")], CPMM_PROGRAM_ID).address,
  ammConfig: (index: number) => findProgramAddress([enc("amm_config"), u16be(index)], CPMM_PROGRAM_ID).address,
  pool: (ammConfig: PublicKey, mint0: PublicKey, mint1: PublicKey) =>
    findProgramAddress([enc("pool"), ammConfig, mint0, mint1], CPMM_PROGRAM_ID).address,
  lpMint: (pool: PublicKey) => findProgramAddress([enc("pool_lp_mint"), pool], CPMM_PROGRAM_ID).address,
  vault: (pool: PublicKey, mint: PublicKey) => findProgramAddress([enc("pool_vault"), pool, mint], CPMM_PROGRAM_ID).address,
  observation: (pool: PublicKey) => findProgramAddress([enc("observation"), pool], CPMM_PROGRAM_ID).address,
  creatorFeeShare: (creator: PublicKey, ammConfig: PublicKey) =>
    findProgramAddress([enc("creator_fee_share"), creator, ammConfig], CPMM_PROGRAM_ID).address,
};

/** Raydium orders pool mints by raw byte value: token_0 < token_1. */
export function sortMints(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return a.compare(b) < 0 ? [a, b] : [b, a];
}

export interface CpmmPool {
  amm_config: PublicKey;
  pool_creator: PublicKey;
  token_0_vault: PublicKey;
  token_1_vault: PublicKey;
  lp_mint: PublicKey;
  token_0_mint: PublicKey;
  token_1_mint: PublicKey;
  token_0_program: PublicKey;
  token_1_program: PublicKey;
  observation_key: PublicKey;
  auth_bump: number;
  status: number;
  lp_mint_decimals: number;
  mint_0_decimals: number;
  mint_1_decimals: number;
  lp_supply: bigint;
  protocol_fees_token_0: bigint;
  protocol_fees_token_1: bigint;
  fund_fees_token_0: bigint;
  fund_fees_token_1: bigint;
  open_time: bigint;
  recent_epoch: bigint;
  /** 0 both, 1 only token_0, 2 only token_1 */
  creator_fee_on: number;
  enable_creator_fee: boolean;
  creator_fees_token_0: bigint;
  creator_fees_token_1: bigint;
}

export interface CpmmAmmConfig {
  bump: number;
  disable_create_pool: boolean;
  index: number;
  trade_fee_rate: bigint;
  protocol_fee_rate: bigint;
  fund_fee_rate: bigint;
  create_pool_fee: bigint;
  protocol_owner: PublicKey;
  fund_owner: PublicKey;
  creator_fee_rate: bigint;
}

export function decodeCpmmPool(data: Uint8Array): CpmmPool {
  return cpmmCoder.decodeAccount<CpmmPool>("PoolState", data);
}

export function decodeCpmmAmmConfig(data: Uint8Array): CpmmAmmConfig {
  return cpmmCoder.decodeAccount<CpmmAmmConfig>("AmmConfig", data);
}

export interface CpmmPoolBundle {
  address: PublicKey;
  pool: CpmmPool;
  config: CpmmAmmConfig;
  vault0: bigint;
  vault1: bigint;
}

export async function fetchCpmmPool(conn: Connection, address: PublicKey): Promise<CpmmPoolBundle> {
  const acc = await conn.getAccountInfo(address);
  if (!acc) throw new Error(`CPMM pool ${address.toBase58()} not found`);
  if (!acc.owner.equals(CPMM_PROGRAM_ID)) throw new Error("Account is not owned by Raydium CPMM");
  const pool = decodeCpmmPool(acc.data);
  const [cfg, v0, v1] = await conn.getMultipleAccounts([pool.amm_config, pool.token_0_vault, pool.token_1_vault]);
  if (!cfg || !v0 || !v1) throw new Error("Missing CPMM pool accounts");
  return {
    address,
    pool,
    config: decodeCpmmAmmConfig(cfg.data),
    vault0: decodeTokenAccount(v0.data).amount,
    vault1: decodeTokenAccount(v1.data).amount,
  };
}

/** Vault balances excluding protocol/fund/creator fees still owed (the tradable reserves). */
export function tradableReserves(b: CpmmPoolBundle): { reserve0: bigint; reserve1: bigint } {
  const p = b.pool;
  return {
    reserve0: b.vault0 - p.protocol_fees_token_0 - p.fund_fees_token_0 - p.creator_fees_token_0,
    reserve1: b.vault1 - p.protocol_fees_token_1 - p.fund_fees_token_1 - p.creator_fees_token_1,
  };
}

export interface CpmmSwapResult {
  inputAmount: bigint;
  outputAmount: bigint;
  tradeFee: bigint;
  protocolFee: bigint;
  fundFee: bigint;
  creatorFee: bigint;
  newInputReserve: bigint;
  newOutputReserve: bigint;
  /** Relative price impact of the trade on the pool spot price. */
  priceImpact: number;
}

export function isCreatorFeeOnInput(creatorFeeOn: number, zeroForOne: boolean): boolean {
  if (creatorFeeOn === 0) return true;
  if (creatorFeeOn === 1) return zeroForOne;
  if (creatorFeeOn === 2) return !zeroForOne;
  throw new RangeError(`Invalid creator_fee_on ${creatorFeeOn}`);
}

/** Port of `CurveCalculator::swap_base_input`. */
export function swapBaseInput(params: {
  amountIn: bigint;
  inputReserve: bigint;
  outputReserve: bigint;
  tradeFeeRate: bigint;
  creatorFeeRate: bigint;
  protocolFeeRate: bigint;
  fundFeeRate: bigint;
  creatorFeeOnInput: boolean;
}): CpmmSwapResult {
  const { amountIn, inputReserve, outputReserve, tradeFeeRate, creatorFeeRate, protocolFeeRate, fundFeeRate } = params;
  let creatorFee = 0n;
  let tradeFee: bigint;
  let amountLessFees: bigint;

  if (params.creatorFeeOnInput) {
    const totalFee = ceilDiv(amountIn, tradeFeeRate + creatorFeeRate, FEE_RATE_DENOMINATOR);
    creatorFee = tradeFeeRate + creatorFeeRate === 0n ? 0n : floorDiv(totalFee, creatorFeeRate, tradeFeeRate + creatorFeeRate);
    tradeFee = totalFee - creatorFee;
    amountLessFees = amountIn - totalFee;
  } else {
    tradeFee = ceilDiv(amountIn, tradeFeeRate, FEE_RATE_DENOMINATOR);
    amountLessFees = amountIn - tradeFee;
  }
  const protocolFee = floorDiv(tradeFee, protocolFeeRate, FEE_RATE_DENOMINATOR);
  const fundFee = floorDiv(tradeFee, fundFeeRate, FEE_RATE_DENOMINATOR);

  const swapped = cpAmountOut(amountLessFees, inputReserve, outputReserve);
  let outputAmount = swapped;
  if (!params.creatorFeeOnInput) {
    creatorFee = ceilDiv(swapped, creatorFeeRate, FEE_RATE_DENOMINATOR);
    outputAmount = swapped - creatorFee;
  }

  const newIn = inputReserve + amountLessFees;
  const newOut = outputReserve - swapped;
  const before = Number(outputReserve) / Number(inputReserve);
  const after = Number(newOut) / Number(newIn);

  return {
    inputAmount: amountIn,
    outputAmount,
    tradeFee,
    protocolFee,
    fundFee,
    creatorFee,
    newInputReserve: newIn,
    newOutputReserve: newOut,
    priceImpact: before === 0 ? 0 : 1 - after / before,
  };
}

/** Quotes a swap on a fetched pool. `inputMint` selects the direction. */
export function quoteCpmmSwap(b: CpmmPoolBundle, inputMint: PublicKey, amountIn: bigint): CpmmSwapResult {
  const zeroForOne = inputMint.equals(b.pool.token_0_mint);
  if (!zeroForOne && !inputMint.equals(b.pool.token_1_mint)) throw new Error("Mint is not part of this pool");
  const { reserve0, reserve1 } = tradableReserves(b);
  return swapBaseInput({
    amountIn,
    inputReserve: zeroForOne ? reserve0 : reserve1,
    outputReserve: zeroForOne ? reserve1 : reserve0,
    tradeFeeRate: b.config.trade_fee_rate,
    creatorFeeRate: b.pool.enable_creator_fee ? b.config.creator_fee_rate : 0n,
    protocolFeeRate: b.config.protocol_fee_rate,
    fundFeeRate: b.config.fund_fee_rate,
    creatorFeeOnInput: isCreatorFeeOnInput(b.pool.creator_fee_on, zeroForOne),
  });
}

export function swapBaseInputIx(
  payer: PublicKey,
  b: CpmmPoolBundle,
  inputMint: PublicKey,
  amountIn: bigint,
  minimumAmountOut: bigint,
): Instruction {
  const p = b.pool;
  const zeroForOne = inputMint.equals(p.token_0_mint);
  const [inMint, outMint] = zeroForOne ? [p.token_0_mint, p.token_1_mint] : [p.token_1_mint, p.token_0_mint];
  const [inProg, outProg] = zeroForOne ? [p.token_0_program, p.token_1_program] : [p.token_1_program, p.token_0_program];
  const [inVault, outVault] = zeroForOne ? [p.token_0_vault, p.token_1_vault] : [p.token_1_vault, p.token_0_vault];
  return cpmmCoder.buildInstruction(
    "swap_base_input",
    {
      payer,
      amm_config: p.amm_config,
      pool_state: b.address,
      input_token_account: getAssociatedTokenAddress(payer, inMint, inProg),
      output_token_account: getAssociatedTokenAddress(payer, outMint, outProg),
      input_vault: inVault,
      output_vault: outVault,
      input_token_program: inProg,
      output_token_program: outProg,
      input_token_mint: inMint,
      output_token_mint: outMint,
      observation_state: p.observation_key,
    },
    { amount_in: amountIn, minimum_amount_out: minimumAmountOut },
  );
}

/** `collect_creator_fee`: must be signed by the pool creator. */
export function collectCreatorFeeIx(b: CpmmPoolBundle): Instruction {
  const p = b.pool;
  return cpmmCoder.buildInstruction("collect_creator_fee", {
    creator: p.pool_creator,
    pool_state: b.address,
    amm_config: p.amm_config,
    token_0_vault: p.token_0_vault,
    token_1_vault: p.token_1_vault,
    vault_0_mint: p.token_0_mint,
    vault_1_mint: p.token_1_mint,
    token_0_program: p.token_0_program,
    token_1_program: p.token_1_program,
  });
}

/**
 * `collect_creator_fee_permissionless`: anyone can call it; fees always go
 * to the pool creator's ATAs, the payer only funds ATA creation.
 *
 * This instruction is present in the CPMM source vendored at
 * `vendor/raydium/cp-swap-src` but not in the published IDL, so the account
 * list is written out by hand from `instructions/collect_creator_fee_permissionless.rs`.
 * Simulate before sending to confirm the deployed program supports it.
 */
export function collectCreatorFeePermissionlessIx(payer: PublicKey, b: CpmmPoolBundle): Instruction {
  const p = b.pool;
  const discriminator = Uint8Array.from([202, 202, 34, 83, 226, 122, 145, 229]);
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: p.pool_creator, isSigner: false, isWritable: false },
    { pubkey: cpmmPda.authority(), isSigner: false, isWritable: false },
    { pubkey: b.address, isSigner: false, isWritable: true },
    { pubkey: p.token_0_vault, isSigner: false, isWritable: true },
    { pubkey: p.token_1_vault, isSigner: false, isWritable: true },
    { pubkey: p.token_0_mint, isSigner: false, isWritable: false },
    { pubkey: p.token_1_mint, isSigner: false, isWritable: false },
    { pubkey: getAssociatedTokenAddress(p.pool_creator, p.token_0_mint, p.token_0_program), isSigner: false, isWritable: true },
    { pubkey: getAssociatedTokenAddress(p.pool_creator, p.token_1_mint, p.token_1_program), isSigner: false, isWritable: true },
    { pubkey: p.token_0_program, isSigner: false, isWritable: false },
    { pubkey: p.token_1_program, isSigner: false, isWritable: false },
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: p.amm_config, isSigner: false, isWritable: false },
    { pubkey: cpmmPda.creatorFeeShare(p.pool_creator, p.amm_config), isSigner: false, isWritable: false },
  ];
  return { programId: CPMM_PROGRAM_ID, keys, data: discriminator };
}
