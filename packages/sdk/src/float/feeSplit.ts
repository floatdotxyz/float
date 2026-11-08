/**
 * Float fee split.
 *
 * Every Float coin's platform trading fees are divided into five buckets.
 * Shares are expressed in basis points (1 bp = 0.01%) and always sum to 10_000.
 *
 *   Holders   15%  paid to the coin's holders in the paired token, pro rata
 *   Creator    5%  paid to the creator's chosen wallet, in the paired token
 *   Flagship  35%  swapped to SOL, used to buy back and burn $FLOAT
 *   Traders   35%  converted to USDC, airdropped to top traders by volume
 *   Treasury  10%  funds the platform
 */

export type Bucket = "holders" | "creator" | "flagship" | "traders" | "treasury";

export const FEE_SPLIT_BPS: Readonly<Record<Bucket, number>> = Object.freeze({
  holders: 1_500,
  creator: 500,
  flagship: 3_500,
  traders: 3_500,
  treasury: 1_000,
});

export const BPS_DENOMINATOR = 10_000n;

export const BUCKET_INFO: Readonly<Record<Bucket, { label: string; payoutAsset: string; destination: string }>> = Object.freeze({
  holders: {
    label: "Holders",
    payoutAsset: "Paired token",
    destination: "Holder payout bot → each holder's token account, pro rata to holdings",
  },
  creator: {
    label: "Creator",
    payoutAsset: "Paired token",
    destination: "Wallet chosen by the creator at launch",
  },
  flagship: {
    label: "Flagship",
    payoutAsset: "SOL → $FLOAT (burned)",
    destination: "Buyback & burn vault",
  },
  traders: {
    label: "Traders",
    payoutAsset: "USDC",
    destination: "Trader airdrop vault → top wallets by volume",
  },
  treasury: {
    label: "Treasury",
    payoutAsset: "Paired token",
    destination: "Platform treasury",
  },
});

export type Split = Record<Bucket, bigint>;

/**
 * Splits a raw fee amount (in paired-token base units) across the buckets.
 * Each bucket is floored; rounding dust (at most 4 base units) is assigned to
 * the treasury so the parts always add back up to `amount`.
 */
export function splitFees(amount: bigint, bps: Readonly<Record<Bucket, number>> = FEE_SPLIT_BPS): Split {
  if (amount < 0n) throw new RangeError("amount must be >= 0");
  const sum = Object.values(bps).reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new Error(`Fee split must sum to 10000 bps, got ${sum}`);

  const out = {} as Split;
  let allocated = 0n;
  for (const k of Object.keys(bps) as Bucket[]) {
    out[k] = (amount * BigInt(bps[k])) / BPS_DENOMINATOR;
    allocated += out[k];
  }
  out.treasury += amount - allocated;
  return out;
}

/** Share of a bucket as a fraction (e.g. 0.35). */
export function shareOf(bucket: Bucket): number {
  return FEE_SPLIT_BPS[bucket] / 10_000;
}
