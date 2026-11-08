/**
 * $FLOAT buyback & burn.
 *
 * The flagship share (35%) of every coin's fees is swapped to SOL and used to
 * buy $FLOAT, which is then burned on chain.
 *
 * - A buy fires at ~5 SOL accumulated, or with whatever has accumulated once
 *   4 hours have passed since the last buy.
 * - No single buy may move the $FLOAT price by more than 1%; larger amounts
 *   are split across several buys.
 * - $FLOAT's own trading fees go to the Float dev wallet, not to this split.
 */

import { LAMPORTS_PER_SOL } from "../programs/addresses.ts";
import { swapBaseInput } from "../raydium/cpmm.ts";

export const BUYBACK_TARGET_LAMPORTS = 5n * LAMPORTS_PER_SOL;
export const BUYBACK_MAX_INTERVAL_MS = 4 * 60 * 60 * 1000;
export const BUYBACK_MAX_PRICE_IMPACT = 0.01;

export interface BuybackTriggerInput {
  accumulatedLamports: bigint;
  lastBuyAt: Date | null;
  now?: Date;
}

export type BuybackDecision =
  | { fire: true; reason: "target" | "interval"; lamports: bigint }
  | { fire: false; reason: "empty" | "waiting"; nextCheckAt?: Date };

export function shouldBuyback(i: BuybackTriggerInput): BuybackDecision {
  const now = i.now ?? new Date();
  if (i.accumulatedLamports <= 0n) return { fire: false, reason: "empty" };
  if (i.accumulatedLamports >= BUYBACK_TARGET_LAMPORTS) {
    return { fire: true, reason: "target", lamports: i.accumulatedLamports };
  }
  const elapsed = i.lastBuyAt ? now.getTime() - i.lastBuyAt.getTime() : Infinity;
  if (elapsed >= BUYBACK_MAX_INTERVAL_MS) return { fire: true, reason: "interval", lamports: i.accumulatedLamports };
  return { fire: false, reason: "waiting", nextCheckAt: new Date(i.lastBuyAt!.getTime() + BUYBACK_MAX_INTERVAL_MS) };
}

export interface PoolSide {
  /** SOL reserve of the $FLOAT pool (lamports). */
  solReserve: bigint;
  /** $FLOAT reserve (raw units). */
  floatReserve: bigint;
  tradeFeeRate: bigint;
  protocolFeeRate: bigint;
  fundFeeRate: bigint;
  creatorFeeRate: bigint;
  creatorFeeOnInput: boolean;
}

function impactOf(pool: PoolSide, amountIn: bigint): number {
  return swapBaseInput({
    amountIn,
    inputReserve: pool.solReserve,
    outputReserve: pool.floatReserve,
    tradeFeeRate: pool.tradeFeeRate,
    creatorFeeRate: pool.creatorFeeRate,
    protocolFeeRate: pool.protocolFeeRate,
    fundFeeRate: pool.fundFeeRate,
    creatorFeeOnInput: pool.creatorFeeOnInput,
  }).priceImpact;
}

/** Largest SOL input whose price impact stays within `maxImpact` (binary search). */
export function maxBuyWithinImpact(pool: PoolSide, maxImpact = BUYBACK_MAX_PRICE_IMPACT): bigint {
  let lo = 0n;
  // Upper bound: for x*y=k the spot-price impact of dx is ~ 2dx/x, so x*maxImpact is safely above the answer.
  let hi = (pool.solReserve * BigInt(Math.ceil(maxImpact * 1e6))) / 1_000_000n + 1n;
  while (impactOf(pool, hi) <= maxImpact) hi *= 2n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (impactOf(pool, mid) <= maxImpact) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export interface BuybackPlan {
  /** Successive buy sizes in lamports, each within the impact cap at the time it executes. */
  buys: bigint[];
  /** Lamports left over (if `maxBuys` was hit). */
  leftover: bigint;
}

/**
 * Splits `lamports` into consecutive buys that each respect the impact cap,
 * updating the simulated reserves after every buy.
 */
export function planBuybacks(pool: PoolSide, lamports: bigint, maxBuys = 20, maxImpact = BUYBACK_MAX_PRICE_IMPACT): BuybackPlan {
  const buys: bigint[] = [];
  let left = lamports;
  let state = { ...pool };
  while (left > 0n && buys.length < maxBuys) {
    const cap = maxBuyWithinImpact(state, maxImpact);
    if (cap === 0n) break;
    const size = left < cap ? left : cap;
    const r = swapBaseInput({
      amountIn: size,
      inputReserve: state.solReserve,
      outputReserve: state.floatReserve,
      tradeFeeRate: state.tradeFeeRate,
      creatorFeeRate: state.creatorFeeRate,
      protocolFeeRate: state.protocolFeeRate,
      fundFeeRate: state.fundFeeRate,
      creatorFeeOnInput: state.creatorFeeOnInput,
    });
    buys.push(size);
    left -= size;
    state = { ...state, solReserve: r.newInputReserve, floatReserve: r.newOutputReserve };
  }
  return { buys, leftover: left };
}
