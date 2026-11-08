/**
 * On-chain history readers: $FLOAT burns and holder payouts.
 *
 * Both work from plain RPC (`getSignaturesForAddress` + `getTransaction`
 * jsonParsed), so anyone can audit them independently of the Float site.
 */

import { PublicKey } from "../core/pubkey.ts";
import type { Connection, ParsedInstruction, ParsedTransaction } from "../core/rpc.ts";
import { FLOAT } from "../programs/addresses.ts";

function allInstructions(tx: ParsedTransaction): ParsedInstruction[] {
  const outer = tx.transaction.message.instructions;
  const inner = tx.meta?.innerInstructions?.flatMap((x) => x.instructions) ?? [];
  return [...outer, ...inner];
}

async function* walkSignatures(conn: Connection, address: PublicKey, limit: number, until?: string) {
  let before: string | undefined;
  let seen = 0;
  while (seen < limit) {
    const page = await conn.getSignaturesForAddress(address, { before, until, limit: Math.min(1000, limit - seen) });
    if (page.length === 0) return;
    for (const s of page) {
      seen++;
      yield s;
    }
    before = page[page.length - 1]!.signature;
  }
}

export interface BurnRecord {
  signature: string;
  blockTime: number | null;
  amount: bigint;
}

/** Lists $FLOAT burns performed through the buyback & burn vault. */
export async function listBurns(
  conn: Connection,
  opts: { limit?: number; until?: string; mint?: PublicKey; source?: PublicKey } = {},
): Promise<BurnRecord[]> {
  const mint = (opts.mint ?? FLOAT.flagshipMint).toBase58();
  const out: BurnRecord[] = [];
  for await (const sig of walkSignatures(conn, opts.source ?? FLOAT.buybackBurnVault, opts.limit ?? 200, opts.until)) {
    if (sig.err) continue;
    const tx = await conn.getParsedTransaction(sig.signature);
    if (!tx) continue;
    let amount = 0n;
    for (const ix of allInstructions(tx)) {
      const p = ix.parsed;
      if (!p || (p.type !== "burn" && p.type !== "burnChecked")) continue;
      if (p.info.mint !== mint) continue;
      const raw = (p.info.amount as string | undefined) ?? (p.info.tokenAmount as { amount: string } | undefined)?.amount;
      if (raw) amount += BigInt(raw);
    }
    if (amount > 0n) out.push({ signature: sig.signature, blockTime: tx.blockTime, amount });
  }
  return out;
}

export interface PayoutRecord {
  signature: string;
  blockTime: number | null;
  mint: string;
  /** Wallet that owns the receiving token account. */
  recipient: string;
  amount: bigint;
}

/**
 * Lists token transfers sent by the holder payout bot. Optionally filters to
 * a single recipient wallet.
 */
export async function listPayouts(
  conn: Connection,
  opts: { limit?: number; until?: string; recipient?: PublicKey; bot?: PublicKey } = {},
): Promise<PayoutRecord[]> {
  const bot = (opts.bot ?? FLOAT.holderPayoutBot).toBase58();
  const want = opts.recipient?.toBase58();
  const out: PayoutRecord[] = [];
  for await (const sig of walkSignatures(conn, new PublicKey(bot), opts.limit ?? 200, opts.until)) {
    if (sig.err) continue;
    const tx = await conn.getParsedTransaction(sig.signature);
    if (!tx?.meta) continue;
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
    const owners = new Map<string, { owner?: string; mint: string }>();
    for (const b of tx.meta.postTokenBalances ?? []) {
      owners.set(keys[b.accountIndex]!, { owner: b.owner, mint: b.mint });
    }
    for (const ix of allInstructions(tx)) {
      const p = ix.parsed;
      if (!p || (p.type !== "transfer" && p.type !== "transferChecked")) continue;
      const authority = (p.info.authority ?? p.info.multisigAuthority) as string | undefined;
      if (authority !== bot) continue;
      const dest = p.info.destination as string;
      const meta = owners.get(dest);
      if (!meta?.owner) continue;
      if (want && meta.owner !== want) continue;
      const raw = (p.info.amount as string | undefined) ?? (p.info.tokenAmount as { amount: string } | undefined)?.amount;
      if (!raw) continue;
      out.push({ signature: sig.signature, blockTime: tx.blockTime, mint: (p.info.mint as string) ?? meta.mint, recipient: meta.owner, amount: BigInt(raw) });
    }
  }
  return out;
}

/** Sums payout records by (recipient, mint). */
export function summarizePayouts(records: PayoutRecord[]): { recipient: string; mint: string; total: bigint; count: number }[] {
  const m = new Map<string, { recipient: string; mint: string; total: bigint; count: number }>();
  for (const r of records) {
    const k = `${r.recipient}:${r.mint}`;
    const cur = m.get(k) ?? { recipient: r.recipient, mint: r.mint, total: 0n, count: 0 };
    cur.total += r.amount;
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => (b.total > a.total ? 1 : -1));
}
