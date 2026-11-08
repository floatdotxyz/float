/**
 * Holder rewards.
 *
 * The holders' 15% share is paid in the coin's paired token by a payout bot
 * that runs every few minutes, wherever the holder bought (Float, a DEX
 * aggregator, another wallet...). Rules:
 *
 * - Payouts go to the holder's token account for the paired token.
 * - If the account does not exist, the bot creates it once the wallet is owed
 *   at least $2. Smaller amounts roll over to the next run.
 * - Selling before a payout returns whatever was still owed to the coin's
 *   holders.
 *
 * This module provides (1) on-chain holder snapshots and (2) a deterministic
 * reference model of a payout round, so anyone can reproduce and check the
 * numbers the bot pays out.
 */

import { PublicKey } from "../core/pubkey.ts";
import type { Connection } from "../core/rpc.ts";
import { RAYDIUM, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../programs/addresses.ts";
import { TOKEN_ACCOUNT_SIZE, decodeTokenAccount } from "../programs/spl.ts";
import { lockPda } from "../raydium/lock.ts";

export const ATA_CREATION_THRESHOLD_USD = 2;

/** Owners whose balances are pool liquidity, not holders. */
export function defaultExcludedOwners(): PublicKey[] {
  return [
    RAYDIUM.launchLabAuthority,
    RAYDIUM.cpmmAuthority,
    RAYDIUM.burnAndEarnAuthority,
    lockPda.authority(),
    new PublicKey("1nc1nerator11111111111111111111111111111111"),
  ];
}

export interface HolderBalance {
  owner: PublicKey;
  /** Sum across all token accounts this owner holds for the mint. */
  amount: bigint;
}

/** Snapshots every non-zero holder of `mint` (SPL Token and Token-2022). */
export async function snapshotHolders(
  conn: Connection,
  mint: PublicKey,
  exclude: PublicKey[] = defaultExcludedOwners(),
): Promise<HolderBalance[]> {
  const mintFilter = { memcmp: { offset: 0, bytes: mint.toBase58() } };
  const [classic, t22] = await Promise.all([
    conn.getProgramAccounts(TOKEN_PROGRAM_ID, [{ dataSize: TOKEN_ACCOUNT_SIZE }, mintFilter]),
    conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, [mintFilter]),
  ]);
  const skip = new Set(exclude.map((e) => e.toBase58()));
  const byOwner = new Map<string, bigint>();
  for (const acc of [...classic, ...t22]) {
    if (acc.data.length < TOKEN_ACCOUNT_SIZE) continue;
    const ta = decodeTokenAccount(acc.data);
    if (ta.amount === 0n || !ta.mint.equals(mint)) continue;
    const owner = ta.owner.toBase58();
    if (skip.has(owner)) continue;
    byOwner.set(owner, (byOwner.get(owner) ?? 0n) + ta.amount);
  }
  return [...byOwner.entries()]
    .map(([owner, amount]) => ({ owner: new PublicKey(owner), amount }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

// ------------------------------------------------------- payout reference model

export interface HolderState {
  owner: string;
  /** Coin balance at this payout. */
  balance: bigint;
  /** Coin balance at the previous payout (for detecting sells). */
  previousBalance: bigint;
  /** Paired-token amount owed but not yet paid (rolled over). */
  carried: bigint;
  /** Whether the wallet already has a token account for the paired token. */
  hasTokenAccount: boolean;
}

export interface PayoutRoundInput {
  /** Paired-token amount (raw units) available for this round. */
  amount: bigint;
  holders: HolderState[];
  /** USD value of one raw unit of the paired token. */
  usdPerUnit: number;
  /** Minimum USD owed before creating a token account. Default $2. */
  ataThresholdUsd?: number;
}

export interface PayoutLine {
  owner: string;
  pay: bigint;
  createTokenAccount: boolean;
  carriedForward: bigint;
}

export interface PayoutRoundResult {
  lines: PayoutLine[];
  totalPaid: bigint;
  totalCarried: bigint;
  /** Owed amounts forfeited by sellers and redistributed this round. */
  forfeited: bigint;
  /** Undistributable rounding dust kept for the next round. */
  dust: bigint;
}

/**
 * Reference model of one payout round.
 *
 * 1. Sellers forfeit carried balances in proportion to the coins they sold
 *    since the previous round; forfeits are added back to the round's pot.
 * 2. The pot is distributed pro rata to current balances (floored).
 * 3. Wallets with a token account are paid in full; wallets without one are
 *    paid (and an account is created) only when owed >= the $2 threshold,
 *    otherwise the amount rolls over.
 */
export function computePayoutRound(input: PayoutRoundInput): PayoutRoundResult {
  const thresholdUsd = input.ataThresholdUsd ?? ATA_CREATION_THRESHOLD_USD;

  let forfeited = 0n;
  const kept = input.holders.map((h) => {
    if (h.carried === 0n || h.balance >= h.previousBalance) return h.carried;
    if (h.previousBalance === 0n) return 0n;
    const keep = (h.carried * h.balance) / h.previousBalance;
    forfeited += h.carried - keep;
    return keep;
  });

  const pot = input.amount + forfeited;
  const supply = input.holders.reduce((s, h) => s + h.balance, 0n);

  let distributed = 0n;
  const lines: PayoutLine[] = input.holders.map((h, i) => {
    const share = supply === 0n ? 0n : (pot * h.balance) / supply;
    distributed += share;
    const owed = kept[i]! + share;
    if (owed === 0n) return { owner: h.owner, pay: 0n, createTokenAccount: false, carriedForward: 0n };

    if (h.hasTokenAccount) return { owner: h.owner, pay: owed, createTokenAccount: false, carriedForward: 0n };

    const owedUsd = Number(owed) * input.usdPerUnit;
    if (owedUsd >= thresholdUsd) return { owner: h.owner, pay: owed, createTokenAccount: true, carriedForward: 0n };
    return { owner: h.owner, pay: 0n, createTokenAccount: false, carriedForward: owed };
  });

  const totalPaid = lines.reduce((s, l) => s + l.pay, 0n);
  const totalCarried = lines.reduce((s, l) => s + l.carriedForward, 0n);
  return { lines, totalPaid, totalCarried, forfeited, dust: pot - distributed };
}
