import {
  BUCKET_INFO,
  FEE_SPLIT_BPS,
  FLOAT,
  RAYDIUM,
  MINTS,
  AIRDROP_SCHEDULE,
  Keypair,
  PublicKey,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  allocateAirdrop,
  closeAccount,
  compileLegacyMessage,
  createAssociatedTokenAccountIdempotent,
  cpmm,
  decodeMint,
  decodeTokenAccount,
  formatUnits,
  getAssociatedTokenAddress,
  isReuseFeeRefunded,
  launchCost,
  launchLab,
  listBurns,
  listPayouts,
  minOutWithGuard,
  normalizeTicker,
  parseUnits,
  planBuybacks,
  previewCycle,
  rankTraders,
  refundTimeLeft,
  setComputeUnitLimit,
  setComputeUnitPrice,
  signTransaction,
  snapshotHolders,
  solscan,
  splitFees,
  summarizePayouts,
  syncNative,
  systemTransfer,
  type Instruction,
  type Connection,
} from "@float-community/sdk";
import {
  type Args,
  UsageError,
  bool,
  connection,
  csv,
  flag,
  json,
  pct,
  readCsv,
  readTrades,
  requireArg,
  resolveMint,
  table,
  when,
} from "./util.ts";

type Out = (s: string) => void;

// ------------------------------------------------------------ addresses

export async function addresses(args: Args, out: Out) {
  const rows = [
    ...Object.entries(FLOAT).map(([k, v]) => ({ group: "Float", name: k, address: v.toBase58(), solscan: solscan(v) })),
    ...Object.entries(RAYDIUM).map(([k, v]) => ({ group: "Raydium", name: k, address: v.toBase58(), solscan: solscan(v) })),
  ];
  out(bool(args, "json") ? json(rows) : table(rows));
}

// ---------------------------------------------------------------- split

export async function split(args: Args, out: Out) {
  const amount = requireArg(args, 1, "amount");
  const decimals = Number(flag(args, "decimals") ?? 9);
  const symbol = flag(args, "symbol") ?? "SOL";
  const raw = parseUnits(amount, decimals);
  const s = splitFees(raw);
  const rows = (Object.keys(FEE_SPLIT_BPS) as (keyof typeof FEE_SPLIT_BPS)[]).map((k) => ({
    bucket: BUCKET_INFO[k].label,
    share: `${FEE_SPLIT_BPS[k] / 100}%`,
    amount: `${formatUnits(s[k], decimals)} ${symbol}`,
    paidAs: BUCKET_INFO[k].payoutAsset,
  }));
  out(bool(args, "json") ? json({ input: raw, decimals, split: s }) : table(rows));
}

// --------------------------------------------------------------- ticker

export async function ticker(args: Args, out: Out) {
  const t = normalizeTicker(requireArg(args, 1, "ticker"));
  const taken = (flag(args, "taken") ?? "").split(",").filter(Boolean);
  const at = flag(args, "at") ? new Date(flag(args, "at")!) : new Date();
  const cost = launchCost(t, taken, at);
  const lines = [
    `Ticker:   $${cost.ticker}`,
    `Status:   ${cost.taken ? "already launched" : "never launched"}`,
    `Cost:     ${cost.feeLamports === 0n ? "free" : `${formatUnits(cost.feeLamports, 9)} SOL (to treasury)`}`,
  ];
  if (cost.refundable) lines.push("Refund:   yes, if the coin graduates within 48 hours of launch");

  const launched = flag(args, "launched");
  if (launched) {
    const l = new Date(launched);
    const g = flag(args, "graduated");
    if (g) lines.push(`Refunded: ${isReuseFeeRefunded(l, new Date(g)) ? "yes" : "no"}`);
    else lines.push(`Refund window left: ${(refundTimeLeft(l) / 3_600_000).toFixed(1)} h`);
  }
  out(bool(args, "json") ? json(cost) : lines.join("\n"));
}

// ----------------------------------------------------------------- pool

async function poolInfo(conn: Connection, coin: PublicKey, pair: PublicKey) {
  const addr = launchLab.launchLabPda.pool(coin, pair);
  const b = await launchLab.fetchLaunchLabPool(conn, addr);
  const p = b.pool;
  const stage = ["bonding", "migrating", "graduated"][p.status] ?? `status ${p.status}`;
  const priceRaw = launchLab.spotPrice(p);
  const price = priceRaw * 10 ** (p.base_decimals - p.quote_decimals);
  const info: Record<string, unknown> = {
    launchLabPool: addr,
    platform: b.platformConfig.name || p.platform_config.toBase58(),
    stage,
    bondingProgress: pct(launchLab.bondingProgress(p)),
    price: `${price.toPrecision(6)} per coin (in paired token)`,
    raised: `${formatUnits(p.real_quote, p.quote_decimals)} / ${formatUnits(p.total_quote_fund_raising, p.quote_decimals)}`,
    sold: `${formatUnits(p.real_base, p.base_decimals)} / ${formatUnits(p.total_base_sell, p.base_decimals)}`,
    creator: p.creator,
    feeRates: {
      protocol: pct(Number(b.globalConfig.trade_fee_rate) / 1e6, 3),
      platform: pct(Number(b.platformConfig.fee_rate) / 1e6, 3),
      creator: pct(Number(b.platformConfig.creator_fee_rate) / 1e6, 3),
    },
    pendingPlatformFee: formatUnits(p.platform_fee, p.quote_decimals),
  };
  if (p.status === 2 && p.migrate_type === 1) {
    const [m0, m1] = cpmm.sortMints(p.base_mint, p.quote_mint);
    info.cpmmPool = cpmm.cpmmPda.pool(b.platformConfig.cpswap_config, m0, m1);
  }
  return { bundle: b, info };
}

export async function pool(args: Args, out: Out) {
  const coin = new PublicKey(requireArg(args, 1, "coin-mint"));
  const pair = resolveMint(flag(args, "pair"));
  const { info } = await poolInfo(connection(args), coin, pair);
  out(json(info));
}

// ---------------------------------------------------------------- quote

export async function quote(args: Args, out: Out) {
  const side = requireArg(args, 1, "buy|sell");
  const coin = new PublicKey(requireArg(args, 2, "coin-mint"));
  const amount = requireArg(args, 3, "amount");
  const pair = resolveMint(flag(args, "pair"));
  const conn = connection(args);
  const addr = launchLab.launchLabPda.pool(coin, pair);
  const b = await launchLab.fetchLaunchLabPool(conn, addr);
  const p = b.pool;
  if (p.status !== 0) throw new Error("Coin has graduated: trade it on its CPMM pool (see `float pool`).");
  const rates = launchLab.feeRatesOf(b);
  const q = side === "buy"
    ? launchLab.quoteBuyExactIn(p, parseUnits(amount, p.quote_decimals), rates)
    : launchLab.quoteSellExactIn(p, parseUnits(amount, p.base_decimals), rates);
  const [inDec, outDec] = side === "buy" ? [p.quote_decimals, p.base_decimals] : [p.base_decimals, p.quote_decimals];
  out(json({
    side,
    amountIn: formatUnits(q.amountIn, inDec),
    amountOut: formatUnits(q.amountOut, outDec),
    fees: {
      total: formatUnits(q.fees.total, p.quote_decimals),
      protocol: formatUnits(q.fees.protocol, p.quote_decimals),
      platform: formatUnits(q.fees.platform, p.quote_decimals),
      creator: formatUnits(q.fees.creator, p.quote_decimals),
    },
    priceImpact: pct(Math.abs(q.priceAfter / q.priceBefore - 1), 3),
    graduatesOnThisBuy: q.capped,
  }));
}

// ------------------------------------------------------------- buy/sell

export async function trade(args: Args, out: Out) {
  const side = args._[0] as "buy" | "sell";
  const coin = new PublicKey(requireArg(args, 1, "coin-mint"));
  const amount = requireArg(args, 2, "amount");
  const keypairPath = flag(args, "keypair");
  if (!keypairPath) throw new UsageError("--keypair <path> is required");
  const slippageBps = Number(flag(args, "slippage-bps") ?? 100);
  const pair = resolveMint(flag(args, "pair"));
  const conn = connection(args);
  const kp = Keypair.fromFile(keypairPath);
  const me = kp.publicKey;

  const addr = launchLab.launchLabPda.pool(coin, pair);
  const b = await launchLab.fetchLaunchLabPool(conn, addr);
  const p = b.pool;
  if (p.status !== 0) throw new Error("Coin has graduated: it no longer trades on the bonding curve.");
  const baseMintAcc = await conn.getAccountInfo(p.base_mint);
  const baseProgram = baseMintAcc?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const rates = launchLab.feeRatesOf(b);
  const isSolPair = p.quote_mint.equals(MINTS.WSOL);
  const quoteAta = getAssociatedTokenAddress(me, p.quote_mint);

  const ixs: Instruction[] = [setComputeUnitLimit(250_000), setComputeUnitPrice(BigInt(flag(args, "priority-micro-lamports") ?? 50_000))];
  ixs.push(createAssociatedTokenAccountIdempotent(me, me, p.base_mint, baseProgram));
  if (isSolPair) ixs.push(createAssociatedTokenAccountIdempotent(me, me, MINTS.WSOL));

  let summary: string;
  if (side === "buy") {
    const amountIn = parseUnits(amount, p.quote_decimals);
    const q = launchLab.quoteBuyExactIn(p, amountIn, rates);
    const minOut = (q.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
    if (isSolPair) ixs.push(systemTransfer(me, quoteAta, q.amountIn), syncNative(quoteAta));
    ixs.push(launchLab.buyExactInIx({ payer: me, pool: addr, poolState: p, baseTokenProgram: baseProgram }, q.amountIn, minOut));
    summary = `buy ${formatUnits(q.amountIn, p.quote_decimals)} → ≥ ${formatUnits(minOut, p.base_decimals)} coins`;
  } else {
    const amountIn = parseUnits(amount, p.base_decimals);
    const q = launchLab.quoteSellExactIn(p, amountIn, rates);
    const minOut = (q.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
    ixs.push(launchLab.sellExactInIx({ payer: me, pool: addr, poolState: p, baseTokenProgram: baseProgram }, amountIn, minOut));
    summary = `sell ${formatUnits(amountIn, p.base_decimals)} coins → ≥ ${formatUnits(minOut, p.quote_decimals)}`;
  }
  if (isSolPair) ixs.push(closeAccount(quoteAta, me, me));

  const { blockhash } = await conn.getLatestBlockhash();
  const msg = compileLegacyMessage(ixs, me, blockhash);
  const { wire, signature } = signTransaction(msg, [kp]);

  if (!bool(args, "send")) {
    const sim = await conn.simulateRawTransaction(wire);
    out(`Simulated: ${summary}`);
    out(`Result:    ${sim.err ? `FAILED ${JSON.stringify(sim.err)}` : "ok"}  (${sim.unitsConsumed ?? "?"} CU)`);
    if (sim.logs && bool(args, "logs")) out(sim.logs.join("\n"));
    out("Re-run with --send to broadcast.");
    return;
  }
  await conn.sendRawTransaction(wire);
  out(`Sent ${summary}\n${solscan(signature, "tx")}`);
  await conn.confirm(signature);
  out("Confirmed.");
}

// ---------------------------------------------------------------- cycle

export async function cycle(args: Args, out: Out) {
  const coin = new PublicKey(requireArg(args, 1, "coin-mint"));
  const pair = resolveMint(flag(args, "pair"));
  const conn = connection(args);
  const pv = await previewCycle(conn, coin, pair);
  if (bool(args, "json")) return out(json(pv));

  const mintAcc = await conn.getAccountInfo(pair);
  const dec = mintAcc ? decodeMint(mintAcc.data).decimals : 9;
  out(`Coin ${coin.toBase58()} — ${pv.stage} (${pct(pv.bondingProgress)} of curve)`);
  out("\nPending fees attributable to this coin:");
  out(table(pv.sources.map((s) => ({ source: s.kind, account: s.account, amount: formatUnits(s.amount, dec), note: s.note ?? "" }))));
  out(`\nA cycle now would route ${formatUnits(pv.totalPending, dec)}:`);
  out(table((Object.keys(pv.split) as (keyof typeof pv.split)[]).map((k) => ({
    bucket: BUCKET_INFO[k].label,
    amount: formatUnits(pv.split[k], dec),
    to: BUCKET_INFO[k].destination,
  }))));
  if (pv.platformWide.length) {
    out("\nPlatform-wide balances (shared by many coins, not included above):");
    out(table(pv.platformWide.map((s) => ({ source: s.kind, account: s.account, amount: formatUnits(s.amount, dec) }))));
  }
  out(`\nSwaps made during a cycle are guarded: a 1.000 expected output must return ≥ ${formatUnits(minOutWithGuard(1000n), 3)}.`);
  out("To cycle, press \"Cycle fees\" on the coin's page; the payout bot also cycles automatically.");
}

// -------------------------------------------------------------- inspect

export async function inspect(args: Args, out: Out) {
  const addr = new PublicKey(requireArg(args, 1, "address"));
  const acc = await connection(args).getAccountInfo(addr);
  if (!acc) return out("Account not found.");
  const base = { address: addr, owner: acc.owner, lamports: acc.lamports, size: acc.data.length, executable: acc.executable };
  const decoders: [PublicKey, typeof launchLab.launchLabCoder][] = [
    [RAYDIUM.launchLab, launchLab.launchLabCoder],
    [RAYDIUM.cpmm, cpmm.cpmmCoder],
  ];
  for (const [program, coder] of decoders) {
    if (!acc.owner.equals(program)) continue;
    const type = coder.identifyAccount(acc.data);
    if (type) {
      try {
        const decoded = type === "PlatformConfig" ? launchLab.decodeLaunchLabPlatformConfig(acc.data) : coder.decodeAccount(type, acc.data);
        return out(json({ ...base, program: coder.idl.metadata.name, type, data: decoded }));
      } catch (err) {
        return out(json({ ...base, program: coder.idl.metadata.name, type, decodeError: (err as Error).message }));
      }
    }
  }
  if (acc.owner.equals(TOKEN_PROGRAM_ID) || acc.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const type = acc.data.length === 82 || (acc.data.length > 165 && acc.data[165] === 1) ? "Mint" : "TokenAccount";
    return out(json({ ...base, type, data: type === "Mint" ? decodeMint(acc.data) : decodeTokenAccount(acc.data) }));
  }
  out(json({ ...base, type: "unknown", head: Buffer.from(acc.data.subarray(0, 64)).toString("hex") }));
}

// -------------------------------------------------------------- holders

export async function holders(args: Args, out: Out) {
  const mint = new PublicKey(requireArg(args, 1, "coin-mint"));
  const conn = connection(args);
  const [list, mintAcc] = await Promise.all([snapshotHolders(conn, mint), conn.getAccountInfo(mint)]);
  const dec = mintAcc ? decodeMint(mintAcc.data).decimals : 6;
  const total = list.reduce((s, h) => s + h.amount, 0n);
  const top = Number(flag(args, "top") ?? 25);
  const rows = list.slice(0, top).map((h, i) => ({
    rank: i + 1,
    wallet: h.owner,
    balance: formatUnits(h.amount, dec),
    rewardShare: total === 0n ? "0%" : pct(Number((h.amount * 1_000_000n) / total) / 1e6, 3),
  }));
  if (bool(args, "csv")) return out(csv(rows));
  out(`${list.length} holders (pool vaults excluded)\n`);
  out(table(rows));
}

// ---------------------------------------------------------------- burns

export async function burns(args: Args, out: Out) {
  const records = await listBurns(connection(args), { limit: Number(flag(args, "limit") ?? 100) });
  const total = records.reduce((s, r) => s + r.amount, 0n);
  const rows = records.map((r) => ({ time: when(r.blockTime), burned: formatUnits(r.amount, 6), tx: r.signature }));
  if (bool(args, "csv")) return out(csv(rows));
  out(table(rows));
  out(`\nTotal burned in range: ${formatUnits(total, 6)} $FLOAT across ${records.length} burns`);
}

// -------------------------------------------------------------- payouts

export async function payouts(args: Args, out: Out) {
  const wallet = flag(args, "wallet");
  const records = await listPayouts(connection(args), {
    limit: Number(flag(args, "limit") ?? 200),
    recipient: wallet ? new PublicKey(wallet) : undefined,
  });
  if (bool(args, "summary")) {
    return out(table(summarizePayouts(records).map((s) => ({ wallet: s.recipient, mint: s.mint, payouts: s.count, totalRaw: s.total }))));
  }
  const rows = records.map((r) => ({ time: when(r.blockTime), wallet: r.recipient, mint: r.mint, amountRaw: r.amount, tx: r.signature }));
  out(bool(args, "csv") ? csv(rows) : table(rows));
}

// -------------------------------------------------------------- airdrop

export async function airdrop(args: Args, out: Out) {
  const file = flag(args, "trades");
  if (!file) throw new UsageError("--trades <file.csv> is required (columns: wallet,coin,pair,side,timestamp,volume_usd)");
  const roundNo = Number(flag(args, "round") ?? AIRDROP_SCHEDULE.length);
  const round = AIRDROP_SCHEDULE.find((r) => r.round === roundNo);
  const snapshot = flag(args, "snapshot") ? new Date(flag(args, "snapshot")!) : round?.snapshot;
  if (!snapshot) throw new UsageError(`Unknown round ${roundNo}; pass --snapshot and --top`);
  const topN = Number(flag(args, "top") ?? round?.topN ?? 250);
  const windowStart = flag(args, "since") ? new Date(flag(args, "since")!) : round?.windowStart ?? null;

  const pairAddedAt = new Map<string, Date>();
  const pairsFile = flag(args, "pairs-added");
  if (pairsFile) for (const r of readCsv(pairsFile)) pairAddedAt.set(r.pair!, new Date(r.added_at!));

  const res = rankTraders(readTrades(file), { topN, windowStart, snapshot, pairAddedAt });
  const pot = flag(args, "pot");
  const alloc = pot ? allocateAirdrop(res.ranked, parseUnits(pot, 6)) : undefined;

  const rows = res.ranked.map((r, i) => ({
    rank: r.rank,
    wallet: r.wallet,
    volumeUsd: r.volumeUsd.toFixed(2),
    trades: r.trades,
    ...(alloc ? { usdc: formatUnits(alloc.allocations[i]!.usdc, 6) } : {}),
  }));
  if (bool(args, "csv")) return out(csv(rows));
  out(`Round ${round?.round ?? "custom"} — snapshot ${snapshot.toISOString()}, top ${topN}, window from ${windowStart?.toISOString() ?? "launch"}\n`);
  out(table(rows));
  out(`\nExcluded: ${res.excludedBots.length} bot wallets, $${res.excludedWashVolumeUsd.toFixed(2)} wash volume, $${res.excludedImmaturePairVolumeUsd.toFixed(2)} new-pair volume`);
  if (alloc) out(`Unallocated remainder: ${formatUnits(alloc.remainder, 6)} USDC`);
}

// -------------------------------------------------------------- buyback

export async function buyback(args: Args, out: Out) {
  const amount = parseUnits(requireArg(args, 1, "sol-amount"), 9);
  const poolFlag = flag(args, "pool");
  let side;
  if (poolFlag) {
    const b = await cpmm.fetchCpmmPool(connection(args), new PublicKey(poolFlag));
    const { reserve0, reserve1 } = cpmm.tradableReserves(b);
    const solIs0 = b.pool.token_0_mint.equals(MINTS.WSOL);
    side = {
      solReserve: solIs0 ? reserve0 : reserve1,
      floatReserve: solIs0 ? reserve1 : reserve0,
      tradeFeeRate: b.config.trade_fee_rate,
      protocolFeeRate: b.config.protocol_fee_rate,
      fundFeeRate: b.config.fund_fee_rate,
      creatorFeeRate: b.pool.enable_creator_fee ? b.config.creator_fee_rate : 0n,
      creatorFeeOnInput: cpmm.isCreatorFeeOnInput(b.pool.creator_fee_on, solIs0),
    };
  } else {
    const sol = flag(args, "sol-reserve");
    const fl = flag(args, "float-reserve");
    if (!sol || !fl) throw new UsageError("Pass --pool <cpmm-pool> or both --sol-reserve and --float-reserve");
    side = {
      solReserve: parseUnits(sol, 9), floatReserve: parseUnits(fl, 6),
      tradeFeeRate: 2_500n, protocolFeeRate: 120_000n, fundFeeRate: 40_000n, creatorFeeRate: 0n, creatorFeeOnInput: true,
    };
  }
  const plan = planBuybacks(side, amount);
  out(table(plan.buys.map((b, i) => ({ buy: i + 1, sol: formatUnits(b, 9) }))));
  out(`\n${plan.buys.length} buys, each ≤ 1% price impact. Leftover: ${formatUnits(plan.leftover, 9)} SOL`);
}
