/**
 * Builds a trader airdrop: rank → allocate → merkle tree.
 *
 *   node scripts/airdrop/build.ts --trades trades.csv --round 2 --pot 25000 \
 *     [--pairs-added pairs-added.csv] [--out airdrop-2.json]
 *
 * Output (consumed by publish.ts and distribute.ts):
 *   { roundId, root, total, claims: [{ index, wallet, amount, proof[] }], ranking: [...] }
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  AIRDROP_SCHEDULE,
  PublicKey,
  allocateAirdrop,
  buildAirdropTree,
  parseUnits,
  rankTraders,
  serializeTree,
  type Trade,
} from "@float-community/sdk";
import { flags, log, need, str } from "../lib/runtime.ts";

const f = flags();
const roundNo = Number(need(f, "round"));
const round = AIRDROP_SCHEDULE.find((r) => r.round === roundNo);
const snapshot = str(f, "snapshot") ? new Date(str(f, "snapshot")!) : round?.snapshot;
if (!snapshot) throw new Error(`Unknown round ${roundNo}: pass --snapshot, --since and --top`);
const windowStart = str(f, "since") ? new Date(str(f, "since")!) : (round?.windowStart ?? null);
const topN = Number(str(f, "top") ?? round?.topN ?? 250);
const pot = parseUnits(need(f, "pot"), 6);

function csv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
  const cols = head!.split(",").map((c) => c.trim());
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i]!, v.trim()])));
}

const trades: Trade[] = csv(need(f, "trades")).map((r) => ({
  wallet: r.wallet!,
  coin: r.coin!,
  pair: r.pair || "SOL",
  side: r.side === "sell" ? "sell" : "buy",
  timestamp: /^\d+$/.test(r.timestamp!) ? Number(r.timestamp) : Date.parse(r.timestamp!),
  volumeUsd: Number(r.volume_usd),
}));

const pairAddedAt = new Map<string, Date>();
if (str(f, "pairs-added")) for (const r of csv(str(f, "pairs-added")!)) pairAddedAt.set(r.pair!, new Date(r.added_at!));

const ranked = rankTraders(trades, { topN, windowStart, snapshot, pairAddedAt });
const { allocations, remainder } = allocateAirdrop(ranked.ranked, pot);
const entries = allocations.filter((a) => a.usdc > 0n).map((a) => ({ wallet: new PublicKey(a.wallet), amount: a.usdc }));
const tree = buildAirdropTree(BigInt(roundNo), entries);

const out = str(f, "out", `airdrop-${roundNo}.json`)!;
writeFileSync(out, JSON.stringify({
  ...serializeTree(tree),
  snapshot: snapshot.toISOString(),
  windowStart: windowStart?.toISOString() ?? null,
  topN,
  remainder: remainder.toString(),
  excluded: {
    bots: ranked.excludedBots.map((b) => b.wallet),
    washVolumeUsd: ranked.excludedWashVolumeUsd,
    immaturePairVolumeUsd: ranked.excludedImmaturePairVolumeUsd,
  },
  ranking: allocations.map((a) => ({ ...a, usdc: a.usdc.toString() })),
}, null, 2) + "\n");

log("info", `round ${roundNo}: ${entries.length} claims, total ${tree.total} (raw USDC), root ${Buffer.from(tree.root).toString("hex")}`);
log("info", `wrote ${out}`);
