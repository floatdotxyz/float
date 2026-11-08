/**
 * Fee cycling preview.
 *
 * Fees accumulate in Raydium-owned vaults until someone triggers "Cycle fees"
 * on a coin's page (the payout bot also does this automatically). Cycling
 * claims the coin's pending fees and routes them through the Float split.
 *
 * `previewCycle` reads those vaults directly and shows what a cycle would move
 * right now — without sending anything.
 */

import { PublicKey } from "../core/pubkey.ts";
import type { Connection } from "../core/rpc.ts";
import { decodeTokenAccount } from "../programs/spl.ts";
import { cpmmPda, decodeCpmmPool, sortMints } from "../raydium/cpmm.ts";
import { PoolStatus, bondingProgress, fetchLaunchLabPool, launchLabPda, type LaunchLabPoolBundle } from "../raydium/launchlab.ts";
import { splitFees, type Split } from "./feeSplit.ts";

export type FeeSourceKind =
  | "launchlab-pool-platform-fee"
  | "launchlab-creator-fee-vault"
  | "cpmm-creator-fee";

export interface FeeSource {
  kind: FeeSourceKind;
  account: PublicKey;
  /** Pending amount in the paired (quote) token, raw units. */
  amount: bigint;
  note?: string;
}

export interface CyclePreview {
  coin: PublicKey;
  pairedMint: PublicKey;
  launchLabPool: PublicKey;
  stage: "bonding" | "migrating" | "graduated";
  bondingProgress: number;
  cpmmPool?: PublicKey;
  sources: FeeSource[];
  totalPending: bigint;
  split: Split;
  /** Platform-wide balances that are not attributable to a single coin. */
  platformWide: FeeSource[];
}

async function tokenBalance(conn: Connection, account: PublicKey): Promise<bigint | null> {
  const acc = await conn.getAccountInfo(account);
  if (!acc || acc.data.length < 165) return null;
  return decodeTokenAccount(acc.data).amount;
}

export async function previewCycle(conn: Connection, coinMint: PublicKey, pairedMint: PublicKey): Promise<CyclePreview> {
  const poolAddr = launchLabPda.pool(coinMint, pairedMint);
  const bundle: LaunchLabPoolBundle = await fetchLaunchLabPool(conn, poolAddr);
  const { pool, platformConfig } = bundle;

  const sources: FeeSource[] = [];
  const platformWide: FeeSource[] = [];

  if (pool.platform_fee > 0n) {
    sources.push({
      kind: "launchlab-pool-platform-fee",
      account: pool.quote_vault,
      amount: pool.platform_fee,
      note: "Platform fee earned on the bonding curve, still held in the pool's quote vault",
    });
  }

  const creatorVault = launchLabPda.creatorFeeVault(pool.creator, pool.quote_mint);
  const creatorBal = await tokenBalance(conn, creatorVault);
  if (creatorBal && creatorBal > 0n) {
    platformWide.push({
      kind: "launchlab-creator-fee-vault",
      account: creatorVault,
      amount: creatorBal,
      note: `LaunchLab creator-fee vault of ${pool.creator.toBase58()} (aggregates every pool with this creator)`,
    });
  }

  let stage: CyclePreview["stage"] = "bonding";
  let cpmmPool: PublicKey | undefined;
  if (pool.status === PoolStatus.Migrate) stage = "migrating";
  if (pool.status === PoolStatus.Trade) {
    stage = "graduated";
    if (pool.migrate_type === 1) {
      const [m0, m1] = sortMints(pool.base_mint, pool.quote_mint);
      cpmmPool = cpmmPda.pool(platformConfig.cpswap_config, m0, m1);
      const acc = await conn.getAccountInfo(cpmmPool);
      if (acc) {
        const cp = decodeCpmmPool(acc.data);
        const quoteIs0 = cp.token_0_mint.equals(pool.quote_mint);
        const pending = quoteIs0 ? cp.creator_fees_token_0 : cp.creator_fees_token_1;
        const pendingBase = quoteIs0 ? cp.creator_fees_token_1 : cp.creator_fees_token_0;
        if (pending > 0n || pendingBase > 0n) {
          sources.push({
            kind: "cpmm-creator-fee",
            account: cpmmPool,
            amount: pending,
            note: pendingBase > 0n ? `plus ${pendingBase} raw units of the coin itself (swapped to the paired token on cycle)` : undefined,
          });
        }
      }
    }
  }

  const totalPending = sources.reduce((s, x) => s + x.amount, 0n);
  return {
    coin: coinMint,
    pairedMint,
    launchLabPool: poolAddr,
    stage,
    bondingProgress: bondingProgress(pool),
    cpmmPool,
    sources,
    totalPending,
    split: splitFees(totalPending),
    platformWide,
  };
}
