/**
 * Trader airdrops.
 *
 * The traders' 35% share is converted to USDC and airdropped to the wallets
 * that traded Float coins, proportional to volume.
 *
 * - Airdrop #1: 2026-11-04 17:00 UTC, top 100 wallets by volume since launch.
 * - Airdrop #2: 2026-11-11 17:00 UTC (11:00 AM CST), top 250 wallets by
 *   volume since the first snapshot.
 * - Later airdrops are announced on X.
 * - Bots are excluded: more than 300 trades in any single hour, or more than
 *   100 trades an hour in 5 or more different hours.
 * - Wash-trading volume is excluded.
 * - Coins on a newly added pair only count toward airdrop volume 7 days after
 *   the pair is added.
 */

export interface AirdropRound {
  round: number;
  snapshot: Date;
  topN: number;
  /** Volume window start; `null` = since Float's launch. */
  windowStart: Date | null;
}

export const AIRDROP_SCHEDULE: readonly AirdropRound[] = Object.freeze([
  { round: 1, snapshot: new Date("2026-11-04T17:00:00Z"), topN: 100, windowStart: null },
  { round: 2, snapshot: new Date("2026-11-11T17:00:00Z"), topN: 250, windowStart: new Date("2026-11-04T17:00:00Z") },
]);

export const BOT_RULES = Object.freeze({
  /** A wallet with more than this many trades in any one hour is a bot. */
  maxTradesInAnyHour: 300,
  /** ...or more than `busyHourTrades` trades in at least `busyHours` distinct hours. */
  busyHourTrades: 100,
  busyHours: 5,
});

export const NEW_PAIR_MATURITY_MS = 7 * 24 * 60 * 60 * 1000;

export type TradeSide = "buy" | "sell";

export interface Trade {
  wallet: string;
  /** Coin (base mint) traded. */
  coin: string;
  /** Paired (quote) token of the coin. */
  pair: string;
  side: TradeSide;
  /** Unix ms. */
  timestamp: number;
  /** USD notional of the trade. */
  volumeUsd: number;
  /** Coin amount traded (raw units) — used by the wash-trade heuristic. */
  baseAmount?: bigint;
  signature?: string;
}

export interface BotCheck {
  isBot: boolean;
  maxTradesInHour: number;
  busyHourCount: number;
}

export function checkBot(trades: Trade[], rules = BOT_RULES): BotCheck {
  const perHour = new Map<number, number>();
  for (const t of trades) {
    const h = Math.floor(t.timestamp / 3_600_000);
    perHour.set(h, (perHour.get(h) ?? 0) + 1);
  }
  let max = 0;
  let busy = 0;
  for (const c of perHour.values()) {
    if (c > max) max = c;
    if (c > rules.busyHourTrades) busy++;
  }
  return {
    isBot: max > rules.maxTradesInAnyHour || busy >= rules.busyHours,
    maxTradesInHour: max,
    busyHourCount: busy,
  };
}

export interface WashTradeOptions {
  /** Max time between opposite-side legs to be considered a round trip. */
  windowMs: number;
  /** Max relative size difference between legs. */
  sizeTolerance: number;
}

export const DEFAULT_WASH_OPTIONS: WashTradeOptions = { windowMs: 60_000, sizeTolerance: 0.02 };

/**
 * Heuristic wash-trade detector: flags buy/sell pairs on the same coin by the
 * same wallet that close within `windowMs` with near-identical size. Both legs
 * of a flagged round trip are excluded. Returns the set of excluded trade
 * indexes (into the input array).
 *
 * Float's production filter is not public; this is a conservative stand-in
 * that you can replace via `rankTraders({ washFilter })`.
 */
export function detectWashTrades(trades: Trade[], opts: WashTradeOptions = DEFAULT_WASH_OPTIONS): Set<number> {
  const flagged = new Set<number>();
  const idx = trades.map((t, i) => ({ t, i })).sort((a, b) => a.t.timestamp - b.t.timestamp);
  const groups = new Map<string, { t: Trade; i: number }[]>();
  for (const x of idx) {
    const k = `${x.t.wallet}:${x.t.coin}`;
    const g = groups.get(k);
    if (g) g.push(x);
    else groups.set(k, [x]);
  }
  for (const g of groups.values()) {
    for (let a = 0; a < g.length; a++) {
      const A = g[a]!;
      if (flagged.has(A.i)) continue;
      for (let b = a + 1; b < g.length; b++) {
        const B = g[b]!;
        if (B.t.timestamp - A.t.timestamp > opts.windowMs) break;
        if (flagged.has(B.i) || B.t.side === A.t.side) continue;
        const big = Math.max(A.t.volumeUsd, B.t.volumeUsd);
        const diff = Math.abs(A.t.volumeUsd - B.t.volumeUsd);
        if (big > 0 && diff / big <= opts.sizeTolerance) {
          flagged.add(A.i);
          flagged.add(B.i);
          break;
        }
      }
    }
  }
  return flagged;
}

export interface RankOptions {
  topN: number;
  windowStart?: Date | null;
  snapshot: Date;
  /** Map of pair mint → time the pair was added to Float. Pairs not listed are mature. */
  pairAddedAt?: Map<string, Date>;
  washFilter?: (trades: Trade[]) => Set<number>;
  botRules?: typeof BOT_RULES;
}

export interface TraderRank {
  rank: number;
  wallet: string;
  volumeUsd: number;
  trades: number;
}

export interface RankResult {
  ranked: TraderRank[];
  excludedBots: { wallet: string; check: BotCheck }[];
  excludedWashVolumeUsd: number;
  excludedImmaturePairVolumeUsd: number;
}

/** Ranks wallets by eligible volume within the round's window. */
export function rankTraders(allTrades: Trade[], opts: RankOptions): RankResult {
  const start = opts.windowStart?.getTime() ?? -Infinity;
  const end = opts.snapshot.getTime();
  const trades = allTrades.filter((t) => t.timestamp >= start && t.timestamp < end);

  // Bots are evaluated on all their trades within the window.
  const byWallet = new Map<string, Trade[]>();
  for (const t of trades) {
    const arr = byWallet.get(t.wallet);
    if (arr) arr.push(t);
    else byWallet.set(t.wallet, [t]);
  }
  const excludedBots: RankResult["excludedBots"] = [];
  const bots = new Set<string>();
  for (const [w, ts] of byWallet) {
    const check = checkBot(ts, opts.botRules);
    if (check.isBot) {
      bots.add(w);
      excludedBots.push({ wallet: w, check });
    }
  }

  const wash = (opts.washFilter ?? detectWashTrades)(trades);
  let washVol = 0;
  let immatureVol = 0;
  const vol = new Map<string, { v: number; n: number }>();
  trades.forEach((t, i) => {
    if (bots.has(t.wallet)) return;
    if (wash.has(i)) {
      washVol += t.volumeUsd;
      return;
    }
    const added = opts.pairAddedAt?.get(t.pair);
    if (added && t.timestamp < added.getTime() + NEW_PAIR_MATURITY_MS) {
      immatureVol += t.volumeUsd;
      return;
    }
    const cur = vol.get(t.wallet) ?? { v: 0, n: 0 };
    cur.v += t.volumeUsd;
    cur.n += 1;
    vol.set(t.wallet, cur);
  });

  const ranked = [...vol.entries()]
    .filter(([, x]) => x.v > 0)
    .sort((a, b) => b[1].v - a[1].v || (a[0] < b[0] ? -1 : 1))
    .slice(0, opts.topN)
    .map(([wallet, x], i) => ({ rank: i + 1, wallet, volumeUsd: x.v, trades: x.n }));

  return { ranked, excludedBots, excludedWashVolumeUsd: washVol, excludedImmaturePairVolumeUsd: immatureVol };
}

export interface Allocation {
  rank: number;
  wallet: string;
  volumeUsd: number;
  /** USDC raw units (6 decimals). */
  usdc: bigint;
}

/**
 * Allocates a USDC pot (raw units) proportionally to volume among ranked
 * wallets. Floors each allocation; the remainder stays in the vault for the
 * next round.
 */
export function allocateAirdrop(ranked: TraderRank[], potUsdc: bigint): { allocations: Allocation[]; remainder: bigint } {
  // Work in micro-USD integers to keep the split deterministic.
  const weights = ranked.map((r) => BigInt(Math.round(r.volumeUsd * 1e6)));
  const total = weights.reduce((a, b) => a + b, 0n);
  let used = 0n;
  const allocations = ranked.map((r, i) => {
    const usdc = total === 0n ? 0n : (potUsdc * weights[i]!) / total;
    used += usdc;
    return { rank: r.rank, wallet: r.wallet, volumeUsd: r.volumeUsd, usdc };
  });
  return { allocations, remainder: potUsdc - used };
}
