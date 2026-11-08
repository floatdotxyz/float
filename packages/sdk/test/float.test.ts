import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEE_SPLIT_BPS,
  splitFees,
  normalizeTicker,
  isValidTicker,
  sameTicker,
  launchCost,
  isReuseFeeRefunded,
  TICKER_REUSE_FEE_LAMPORTS,
  computePayoutRound,
  checkBot,
  detectWashTrades,
  rankTraders,
  allocateAirdrop,
  AIRDROP_SCHEDULE,
  shouldBuyback,
  maxBuyWithinImpact,
  planBuybacks,
  BUYBACK_TARGET_LAMPORTS,
  minOutWithGuard,
  maxExtractable,
  withinGuard,
  afterTransferFee,
  PAIRS,
  formatUnits,
  parseUnits,
  type Trade,
  type PoolSide,
} from "../src/index.ts";

// ------------------------------------------------------------- fee split

test("fee split shares sum to 100%", () => {
  assert.equal(Object.values(FEE_SPLIT_BPS).reduce((a, b) => a + b, 0), 10_000);
  assert.deepEqual(FEE_SPLIT_BPS, { holders: 1500, creator: 500, flagship: 3500, traders: 3500, treasury: 1000 });
});

test("splitFees allocates exactly and gives dust to treasury", () => {
  const s = splitFees(1_000_000_007n);
  const sum = Object.values(s).reduce((a, b) => a + b, 0n);
  assert.equal(sum, 1_000_000_007n);
  assert.equal(s.flagship, 350_000_002n);
  assert.equal(s.traders, 350_000_002n);
  assert.equal(s.creator, 50_000_000n);
  assert.equal(s.holders, 150_000_001n);
  assert.equal(s.treasury, 100_000_000n + 2n);
});

test("splitFees validates custom splits", () => {
  assert.throws(() => splitFees(10n, { holders: 1, creator: 1, flagship: 1, traders: 1, treasury: 1 }), /sum to 10000/);
});

// --------------------------------------------------------------- tickers

test("tickers are case-insensitive, 1-10 alphanumerics", () => {
  assert.equal(normalizeTicker("$Pepe"), "PEPE");
  assert.ok(sameTicker("$pepe", "PEPE"));
  assert.ok(isValidTicker("A"));
  assert.ok(isValidTicker("ABCDEFGHIJ"));
  assert.ok(isValidTicker("x420"));
  assert.ok(!isValidTicker(""));
  assert.ok(!isValidTicker("ABCDEFGHIJK"));
  assert.ok(!isValidTicker("PE-PE"));
  assert.ok(!isValidTicker("pepé"));
});

test("first launch of a ticker is free, reuse costs 1 SOL after the cutoff", () => {
  const after = new Date("2026-11-06T00:00:00Z");
  assert.equal(launchCost("NEW", ["PEPE"], after).feeLamports, 0n);
  const reuse = launchCost("pepe", ["$PEPE"], after);
  assert.equal(reuse.taken, true);
  assert.equal(reuse.feeLamports, TICKER_REUSE_FEE_LAMPORTS);
});

test("reuse fee starts at Nov 4 2026 10:01 PM CST", () => {
  assert.equal(launchCost("PEPE", ["PEPE"], new Date("2026-11-05T04:00:59Z")).feeLamports, 0n);
  assert.equal(launchCost("PEPE", ["PEPE"], new Date("2026-11-05T04:01:00Z")).feeLamports, TICKER_REUSE_FEE_LAMPORTS);
});

test("refund requires graduation within 48 hours", () => {
  const l = new Date("2026-11-06T12:00:00Z");
  assert.equal(isReuseFeeRefunded(l, new Date("2026-11-08T12:00:00Z")), true);
  assert.equal(isReuseFeeRefunded(l, new Date("2026-11-08T12:00:01Z")), false);
  assert.equal(isReuseFeeRefunded(l, null), false);
});

// --------------------------------------------------------------- holders

test("payout round: pro rata, ATA threshold and rollover", () => {
  const usdPerUnit = 1e-6; // USDC-like: 1 raw unit = $0.000001
  const r = computePayoutRound({
    amount: 10_000_000n, // $10
    usdPerUnit,
    holders: [
      { owner: "A", balance: 700n, previousBalance: 700n, carried: 0n, hasTokenAccount: true },
      { owner: "B", balance: 250n, previousBalance: 250n, carried: 0n, hasTokenAccount: false }, // owed $2.5 → create ATA
      { owner: "C", balance: 50n, previousBalance: 50n, carried: 0n, hasTokenAccount: false }, // owed $0.5 → roll over
    ],
  });
  const [a, b, c] = r.lines;
  assert.equal(a!.pay, 7_000_000n);
  assert.equal(b!.pay, 2_500_000n);
  assert.equal(b!.createTokenAccount, true);
  assert.equal(c!.pay, 0n);
  assert.equal(c!.carriedForward, 500_000n);
  assert.equal(r.totalPaid + r.totalCarried + r.dust, 10_000_000n);
});

test("payout round: selling forfeits owed amounts back to holders", () => {
  const r = computePayoutRound({
    amount: 0n,
    usdPerUnit: 1e-6,
    holders: [
      { owner: "Seller", balance: 0n, previousBalance: 100n, carried: 1_000_000n, hasTokenAccount: false },
      { owner: "Holder", balance: 100n, previousBalance: 100n, carried: 0n, hasTokenAccount: true },
    ],
  });
  assert.equal(r.forfeited, 1_000_000n);
  assert.equal(r.lines[0]!.carriedForward, 0n);
  assert.equal(r.lines[1]!.pay, 1_000_000n);
});

test("payout round: partial sell forfeits proportionally", () => {
  const r = computePayoutRound({
    amount: 0n,
    usdPerUnit: 1e-6,
    holders: [{ owner: "P", balance: 25n, previousBalance: 100n, carried: 400n, hasTokenAccount: false }],
  });
  assert.equal(r.forfeited, 300n);
});

// --------------------------------------------------------------- airdrop

const H = 3_600_000;
const t0 = Date.parse("2026-11-05T00:00:00Z");

function trades(wallet: string, n: number, startHour: number, usd = 10, side: "buy" | "sell" = "buy"): Trade[] {
  return Array.from({ length: n }, (_, i) => ({
    wallet, coin: `C${i % 3}`, pair: "SOL", side, timestamp: t0 + startHour * H + i * 1000, volumeUsd: usd,
  }));
}

test("bot rule: more than 300 trades in one hour", () => {
  assert.equal(checkBot(trades("w", 300, 0)).isBot, false);
  assert.equal(checkBot(trades("w", 301, 0)).isBot, true);
});

test("bot rule: more than 100/hour in 5+ different hours", () => {
  const four = [0, 1, 2, 3].flatMap((h) => trades("w", 101, h));
  assert.equal(checkBot(four).isBot, false);
  const five = [0, 1, 2, 3, 4].flatMap((h) => trades("w", 101, h));
  assert.equal(checkBot(five).isBot, true);
  const fiveAt100 = [0, 1, 2, 3, 4].flatMap((h) => trades("w", 100, h));
  assert.equal(checkBot(fiveAt100).isBot, false);
});

test("wash-trade heuristic flags fast same-size round trips", () => {
  const ts: Trade[] = [
    { wallet: "w", coin: "X", pair: "SOL", side: "buy", timestamp: t0, volumeUsd: 1000 },
    { wallet: "w", coin: "X", pair: "SOL", side: "sell", timestamp: t0 + 10_000, volumeUsd: 995 },
    { wallet: "w", coin: "X", pair: "SOL", side: "sell", timestamp: t0 + 600_000, volumeUsd: 400 },
  ];
  assert.deepEqual([...detectWashTrades(ts)].sort(), [0, 1]);
});

test("ranking applies window, bots, wash and new-pair maturity", () => {
  const round2 = AIRDROP_SCHEDULE[1]!;
  const all: Trade[] = [
    ...trades("alice", 10, 1, 100),
    ...trades("bob", 5, 1, 100),
    ...trades("bot", 301, 2, 1000),
    { wallet: "carol", coin: "N", pair: "NEWPAIR", side: "buy", timestamp: t0 + 3 * H, volumeUsd: 50_000 },
    { wallet: "dave", coin: "X", pair: "SOL", side: "buy", timestamp: Date.parse("2026-11-03T00:00:00Z"), volumeUsd: 1e6 },
  ];
  const res = rankTraders(all, {
    topN: round2.topN,
    windowStart: round2.windowStart,
    snapshot: round2.snapshot,
    pairAddedAt: new Map([["NEWPAIR", new Date("2026-11-04T18:00:00Z")]]),
  });
  assert.deepEqual(res.ranked.map((r) => r.wallet), ["alice", "bob"]);
  assert.equal(res.excludedBots[0]!.wallet, "bot");
  assert.equal(res.excludedImmaturePairVolumeUsd, 50_000);
});

test("airdrop allocation is proportional and conserves the pot", () => {
  const { allocations, remainder } = allocateAirdrop(
    [{ rank: 1, wallet: "a", volumeUsd: 3000, trades: 1 }, { rank: 2, wallet: "b", volumeUsd: 1000, trades: 1 }],
    1_000_000_001n,
  );
  assert.equal(allocations[0]!.usdc, 750_000_000n);
  assert.equal(allocations[1]!.usdc, 250_000_000n);
  assert.equal(remainder, 1n);
});

// --------------------------------------------------------------- buyback

const floatPool: PoolSide = {
  solReserve: 2_000n * 1_000_000_000n,
  floatReserve: 50_000_000n * 1_000_000n,
  tradeFeeRate: 2_500n, protocolFeeRate: 120_000n, fundFeeRate: 40_000n, creatorFeeRate: 0n, creatorFeeOnInput: true,
};

test("buyback fires at 5 SOL or after 4 hours", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  assert.deepEqual(shouldBuyback({ accumulatedLamports: 0n, lastBuyAt: null, now }), { fire: false, reason: "empty" });
  assert.equal(shouldBuyback({ accumulatedLamports: BUYBACK_TARGET_LAMPORTS, lastBuyAt: now, now }).fire, true);
  assert.equal(shouldBuyback({ accumulatedLamports: 1n, lastBuyAt: new Date(now.getTime() - 3 * H), now }).fire, false);
  const late = shouldBuyback({ accumulatedLamports: 1n, lastBuyAt: new Date(now.getTime() - 4 * H), now });
  assert.equal(late.fire && late.reason, "interval");
});

test("max buy keeps price impact within 1% and is tight", () => {
  const cap = maxBuyWithinImpact(floatPool);
  assert.ok(cap > 0n);
  // A 2000 SOL pool allows ~1% / 2 ≈ 0.5% of reserves (≈ 10 SOL) per buy.
  assert.ok(cap > 9n * 1_000_000_000n && cap < 11n * 1_000_000_000n, `cap=${cap}`);
  const plan = planBuybacks(floatPool, 30n * 1_000_000_000n);
  assert.ok(plan.buys.length >= 3);
  assert.equal(plan.buys.reduce((a, b) => a + b, 0n) + plan.leftover, 30n * 1_000_000_000n);
});

// ----------------------------------------------------------- price guard

test("price guard: 2% tolerance", () => {
  assert.equal(minOutWithGuard(10_000n), 9_800n);
  assert.equal(maxExtractable(10_000n), 200n);
  assert.equal(withinGuard(9_800n, 10_000n), true);
  assert.equal(withinGuard(9_799n, 10_000n), false);
});

// ----------------------------------------------------------------- pairs

test("pre-IPO transfer fees", () => {
  const pre = PAIRS.find((p) => p.symbol.startsWith("PreStocks"))!;
  const tes = PAIRS.find((p) => p.symbol.startsWith("Tessera"))!;
  assert.equal(afterTransferFee(10_000n, pre.transferFeeBps), 9_900n);
  assert.equal(afterTransferFee(10_000n, tes.transferFeeBps), 9_980n);
});

test("unit formatting", () => {
  assert.equal(formatUnits(1_500_000_000n, 9), "1.5");
  assert.equal(formatUnits(5n, 6), "0.000005");
  assert.equal(parseUnits("1.5", 9), 1_500_000_000n);
  assert.equal(parseUnits("0.0000001", 6), 0n);
  assert.throws(() => parseUnits("1e5", 6));
});
