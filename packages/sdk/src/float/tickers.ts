/**
 * Ticker rules.
 *
 * - 1 to 10 letters or numbers, case-insensitive ($Pepe == $pepe == $PEPE).
 * - Each ticker can be launched once for free.
 * - Re-using an existing ticker costs 1 SOL, sent to the treasury.
 * - If that coin graduates within 48 hours of launch, the launcher is refunded.
 * - The reuse fee applies to coins launched from Nov 4, 2026 at 10:01 PM CST
 *   (2026-11-05T04:01:00Z).
 */

import { LAMPORTS_PER_SOL } from "../programs/addresses.ts";

export const TICKER_PATTERN = /^[A-Za-z0-9]{1,10}$/;
export const TICKER_REUSE_FEE_LAMPORTS = 1n * LAMPORTS_PER_SOL;
export const TICKER_REFUND_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Nov 4, 2026 22:01 CST (UTC-6). */
export const TICKER_REUSE_FEE_EFFECTIVE = new Date("2026-11-05T04:01:00Z");

export class TickerError extends Error {}

/** Strips a leading `$`, trims, validates and upper-cases a ticker. */
export function normalizeTicker(input: string): string {
  const t = input.trim().replace(/^\$/, "");
  if (!TICKER_PATTERN.test(t)) {
    throw new TickerError(`Invalid ticker "${input}": use 1-10 letters or numbers`);
  }
  return t.toUpperCase();
}

export function isValidTicker(input: string): boolean {
  try {
    normalizeTicker(input);
    return true;
  } catch {
    return false;
  }
}

export function sameTicker(a: string, b: string): boolean {
  return normalizeTicker(a) === normalizeTicker(b);
}

export interface LaunchCost {
  ticker: string;
  taken: boolean;
  /** Lamports payable to the treasury at launch. */
  feeLamports: bigint;
  refundable: boolean;
}

/**
 * Cost of launching `ticker` given the set of tickers already launched.
 * `existing` may contain tickers in any case.
 */
export function launchCost(ticker: string, existing: Iterable<string>, launchTime: Date = new Date()): LaunchCost {
  const t = normalizeTicker(ticker);
  const taken = new Set([...existing].map((x) => x.trim().replace(/^\$/, "").toUpperCase())).has(t);
  const feeApplies = taken && launchTime.getTime() >= TICKER_REUSE_FEE_EFFECTIVE.getTime();
  return {
    ticker: t,
    taken,
    feeLamports: feeApplies ? TICKER_REUSE_FEE_LAMPORTS : 0n,
    refundable: feeApplies,
  };
}

/** Whether a paid ticker reuse is refunded: the coin must graduate within 48h of launch. */
export function isReuseFeeRefunded(launchedAt: Date, graduatedAt: Date | null): boolean {
  if (launchedAt.getTime() < TICKER_REUSE_FEE_EFFECTIVE.getTime()) return false;
  if (!graduatedAt) return false;
  const dt = graduatedAt.getTime() - launchedAt.getTime();
  return dt >= 0 && dt <= TICKER_REFUND_WINDOW_MS;
}

/** Time left (ms) to graduate and still get the refund; 0 if expired. */
export function refundTimeLeft(launchedAt: Date, now: Date = new Date()): number {
  return Math.max(0, launchedAt.getTime() + TICKER_REFUND_WINDOW_MS - now.getTime());
}
