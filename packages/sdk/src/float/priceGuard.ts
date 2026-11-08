/**
 * Fee-cycling price guard.
 *
 * When fees are cycled, paired-token amounts are swapped (e.g. to SOL for the
 * flagship share, to USDC for the trader share). Each swap carries a minimum
 * output derived from a reference price. A trader who moves the price right
 * before the cycle can capture at most the guard tolerance — about 2% of the
 * swap — before the swap reverts.
 */

export const CYCLE_PRICE_GUARD_BPS = 200;

/** Minimum acceptable output for an expected output and tolerance in bps. */
export function minOutWithGuard(expectedOut: bigint, toleranceBps = CYCLE_PRICE_GUARD_BPS): bigint {
  if (toleranceBps < 0 || toleranceBps > 10_000) throw new RangeError("toleranceBps out of range");
  return (expectedOut * BigInt(10_000 - toleranceBps)) / 10_000n;
}

/** Worst-case value a front-runner can extract from a guarded swap of `expectedOut`. */
export function maxExtractable(expectedOut: bigint, toleranceBps = CYCLE_PRICE_GUARD_BPS): bigint {
  return expectedOut - minOutWithGuard(expectedOut, toleranceBps);
}

/**
 * Checks a fresh quote against a reference (e.g. TWAP from the CPMM
 * observation account or the last cycle's price). Returns false when the pool
 * has drifted beyond the tolerance and the swap should be skipped.
 */
export function withinGuard(quotedOut: bigint, referenceOut: bigint, toleranceBps = CYCLE_PRICE_GUARD_BPS): boolean {
  return quotedOut >= minOutWithGuard(referenceOut, toleranceBps);
}
