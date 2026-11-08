/**
 * Keeper: the permissionless + operator maintenance loop of float-router.
 *
 * Every tick, for every registered coin:
 *   1. mark_graduated     when the LaunchLab pool has migrated
 *   2. settle_ticker_fee  once the 48 h refund window is decided
 *   3. cycle_launchlab    when the curve has unclaimed platform fees
 *   4. cycle_cpmm         when the graduated pool has creator fees
 *   5. swap_base_fees     when coin-side fees are pending (operator, guarded)
 * Then, globally:
 *   6. convert_vault      flagship → WSOL, traders → USDC (operator, guarded)
 *   7. execute_buyback    when ≥ 5 SOL or 4 h elapsed, sized to ≤ 1 % impact
 *
 *   node scripts/keeper/keeper.ts [--interval 180] [--once] [--send] [--min-cycle 0.01]
 *
 * Simulates by default. Pass --send to broadcast.
 */
import {
  MINTS,
  PublicKey,
  cpmm,
  createAssociatedTokenAccountIdempotent,
  decodeTokenAccount,
  launchLab,
  maxBuyWithinImpact,
  shouldBuyback,
  router,
  type Connection,
  type Instruction,
} from "@float-community/sdk";
import { execute, flags, keypair, log, routerClient, rpc, sleep, str } from "../lib/runtime.ts";

const f = flags();
const conn = rpc(f);
const operator = keypair(f);
const client = routerClient(f);
const send = Boolean(f.send);
const intervalMs = Number(str(f, "interval", "180")) * 1000;
const flagshipPoolArg = str(f, "flagship-pool");

async function balance(c: Connection, account: PublicKey): Promise<bigint> {
  const a = await c.getAccountInfo(account);
  return a ? decodeTokenAccount(a.data).amount : 0n;
}

async function cpmmPoolFor(c: Connection, coin: router.CoinRecord, platform: launchLab.LaunchLabPlatformConfig) {
  const [m0, m1] = cpmm.sortMints(coin.mint, coin.paired_mint);
  const address = cpmm.cpmmPda.pool(platform.cpswap_config, m0, m1);
  return { address, bundle: await cpmm.fetchCpmmPool(c, address) };
}

async function tickCoin(cfg: router.RouterConfig, platform: launchLab.LaunchLabPlatformConfig, coin: router.CoinRecord) {
  const tag = `$${router.coinTicker(coin)}`;
  const poolAcc = await conn.getAccountInfo(coin.launchlab_pool);
  if (!poolAcc) return log("warn", `${tag}: LaunchLab pool missing`);
  const pool = launchLab.decodeLaunchLabPool(poolAcc.data);
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (coin.graduated_at === 0n && pool.status === launchLab.PoolStatus.Trade) {
    await execute(conn, operator, [client.markGraduated(coin)], { send, label: `${tag} mark_graduated` });
  }

  if (!coin.reuse_fee_settled) {
    const graduated = coin.graduated_at !== 0n;
    const windowOver = now > coin.launched_at + 48n * 3600n;
    if (graduated || windowOver) {
      await execute(conn, operator, [client.settleTickerFee(coin, cfg.treasury)], { send, label: `${tag} settle_ticker_fee` });
    }
  }

  const setupIxs: Instruction[] = [
    createAssociatedTokenAccountIdempotent(operator.publicKey, coin.creator_wallet, coin.paired_mint),
    createAssociatedTokenAccountIdempotent(operator.publicKey, cfg.treasury, coin.paired_mint),
  ];

  if (pool.platform_fee > 0n) {
    await execute(conn, operator, [...setupIxs, client.cycleLaunchLab(operator.publicKey, coin, cfg, pool.quote_vault)], {
      send, label: `${tag} cycle_launchlab (${pool.platform_fee} raw)`,
    });
  }

  if (coin.graduated_at !== 0n && pool.migrate_type === 1) {
    const { address, bundle } = await cpmmPoolFor(conn, coin, platform);
    const p = bundle.pool;
    const authority = client.pda.authority();
    if (p.creator_fees_token_0 > 0n || p.creator_fees_token_1 > 0n) {
      await execute(conn, operator, [
        ...setupIxs,
        createAssociatedTokenAccountIdempotent(operator.publicKey, authority, p.token_0_mint, p.token_0_program),
        createAssociatedTokenAccountIdempotent(operator.publicKey, authority, p.token_1_mint, p.token_1_program),
        client.cycleCpmm(operator.publicKey, coin, cfg, address, p),
      ], { send, label: `${tag} cycle_cpmm` });
    }
    if (coin.pending_base_fees > 0n) {
      // Reference price = current tradable spot (paired per coin); the on-chain guard bounds slippage around it.
      const { reserve0, reserve1 } = cpmm.tradableReserves(bundle);
      const coinIs0 = p.token_0_mint.equals(coin.mint);
      const ref = router.priceQ64(coinIs0 ? reserve1 : reserve0, coinIs0 ? reserve0 : reserve1);
      await execute(conn, operator, [client.swapBaseFees(operator.publicKey, coin, cfg, address, p, coin.pending_base_fees, ref)], {
        send, label: `${tag} swap_base_fees (${coin.pending_base_fees} raw)`,
      });
    }
  }
}

async function tickGlobal(cfg: router.RouterConfig, coins: router.CoinRecord[], platform: launchLab.LaunchLabPlatformConfig) {
  // Conversions: per paired mint, flagship → WSOL and traders → USDC through the paired/target CPMM pool.
  const pairs = [...new Set(coins.map((c) => c.paired_mint.toBase58()))].map((m) => new PublicKey(m));
  for (const paired of pairs) {
    for (const [kind, target] of [[router.VaultKind.Flagship, MINTS.WSOL], [router.VaultKind.Traders, MINTS.USDC]] as const) {
      if (paired.equals(target)) continue;
      const amount = await balance(conn, client.pda.vault(kind, paired));
      if (amount === 0n) continue;
      const [m0, m1] = cpmm.sortMints(paired, target);
      // Route through the CPMM pool on --route-config (default: the platform's CPMM config).
      const routeConfig = str(f, "route-config") ? new PublicKey(str(f, "route-config")!) : platform.cpswap_config;
      const poolAddr = cpmm.cpmmPda.pool(routeConfig, m0, m1);
      let bundle;
      try {
        bundle = await cpmm.fetchCpmmPool(conn, poolAddr);
      } catch {
        log("warn", `no CPMM route ${paired.toBase58()} → ${target.toBase58()}; share waits in vault`);
        continue;
      }
      const { reserve0, reserve1 } = cpmm.tradableReserves(bundle);
      const srcIs0 = bundle.pool.token_0_mint.equals(paired);
      const ref = router.priceQ64(srcIs0 ? reserve1 : reserve0, srcIs0 ? reserve0 : reserve1);
      await execute(conn, operator, [client.convertVault(operator.publicKey, kind, paired, poolAddr, bundle.pool, amount, ref)], {
        send, label: `convert_vault kind=${kind} ${paired.toBase58()}`,
      });
    }
  }

  // Buyback.
  if (!flagshipPoolArg) return;
  const solVault = client.pda.vault(router.VaultKind.Flagship, MINTS.WSOL);
  const available = await balance(conn, solVault);
  const decision = shouldBuyback({
    accumulatedLamports: available,
    lastBuyAt: cfg.last_buyback_ts === 0n ? null : new Date(Number(cfg.last_buyback_ts) * 1000),
  });
  if (!decision.fire) return log("debug", `buyback: ${decision.reason}`);

  const poolAddr = new PublicKey(flagshipPoolArg);
  const b = await cpmm.fetchCpmmPool(conn, poolAddr);
  const { reserve0, reserve1 } = cpmm.tradableReserves(b);
  const solIs0 = b.pool.token_0_mint.equals(MINTS.WSOL);
  const side = {
    solReserve: solIs0 ? reserve0 : reserve1,
    floatReserve: solIs0 ? reserve1 : reserve0,
    tradeFeeRate: b.config.trade_fee_rate,
    protocolFeeRate: b.config.protocol_fee_rate,
    fundFeeRate: b.config.fund_fee_rate,
    creatorFeeRate: b.pool.enable_creator_fee ? b.config.creator_fee_rate : 0n,
    creatorFeeOnInput: cpmm.isCreatorFeeOnInput(b.pool.creator_fee_on, solIs0),
  };
  const cap = maxBuyWithinImpact(side, cfg.max_impact_bps / 10_000);
  const size = available < cap ? available : cap;
  const ref = router.priceQ64(side.floatReserve, side.solReserve);
  await execute(conn, operator, [
    createAssociatedTokenAccountIdempotent(operator.publicKey, client.pda.authority(), cfg.flagship_mint, solIs0 ? b.pool.token_1_program : b.pool.token_0_program),
    client.executeBuyback(operator.publicKey, cfg.flagship_mint, poolAddr, b.pool, size, ref),
  ], { send, label: `execute_buyback ${size} lamports (${decision.reason})` });
}

async function tick() {
  const cfg = await router.fetchRouterConfig(conn, client.programId);
  if (cfg.paused) return log("warn", "router paused");
  const platformAcc = await conn.getAccountInfo(cfg.launchlab_platform_config);
  if (!platformAcc) throw new Error("LaunchLab platform config not found");
  const platform = launchLab.decodeLaunchLabPlatformConfig(platformAcc.data);
  const coins = (await router.fetchAllCoins(conn, client.programId)).map((x) => x.coin);
  log("info", `tick: ${coins.length} coins`);
  for (const coin of coins) {
    try {
      await tickCoin(cfg, platform, coin);
    } catch (err) {
      log("error", `$${router.coinTicker(coin)}: ${(err as Error).message}`);
    }
  }
  await tickGlobal(cfg, coins, platform);
}

do {
  try {
    await tick();
  } catch (err) {
    log("error", `tick failed: ${(err as Error).message}`);
  }
  if (f.once) break;
  await sleep(intervalMs);
} while (true);
