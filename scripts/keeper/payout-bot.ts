/**
 * Holder payout bot for float-router.
 *
 * For every coin with unpaid holder rewards:
 *   1. snapshot holders on chain (pool vaults and burn address excluded);
 *   2. run the payout model: pro rata share + carried balances, $2 threshold
 *      before creating a token account, rollover below it, seller forfeits;
 *   3. send `payout_holders` in batches (creating ATAs idempotently for
 *      wallets that crossed $2);
 *   4. persist the carry ledger so rollovers survive restarts.
 *
 *   node scripts/keeper/payout-bot.ts --ledger payouts.ledger.json \
 *     [--prices prices.json] [--interval 300] [--once] [--send]
 *
 * `prices.json` maps paired mint → USD per whole token, e.g.
 *   { "So11111111111111111111111111111111111111112": 182.4, "EPjF…Dt1v": 1 }
 */
import {
  MINTS,
  PublicKey,
  computePayoutRound,
  createAssociatedTokenAccountIdempotent,
  decodeMint,
  getAssociatedTokenAddress,
  router,
  snapshotHolders,
  type Instruction,
} from "@float-community/sdk";
import { chunk, execute, flags, keypair, log, readJson, routerClient, rpc, sleep, str, writeJson } from "../lib/runtime.ts";

const f = flags();
const conn = rpc(f);
const operator = keypair(f);
const client = routerClient(f);
const send = Boolean(f.send);
const ledgerPath = str(f, "ledger", "payouts.ledger.json")!;
const prices = readJson<Record<string, number>>(str(f, "prices", "prices.json")!, { [MINTS.USDC.toBase58()]: 1 });
const BATCH = 12; // keeps legacy transactions under 1232 bytes with ATA creation

/** ledger[coinMint][owner] = { carried, lastBalance } */
type Ledger = Record<string, Record<string, { carried: string; lastBalance: string }>>;

async function payCoin(coin: router.CoinRecord, ledger: Ledger, round: bigint) {
  const tag = `$${router.coinTicker(coin)}`;
  const usdPerWhole = prices[coin.paired_mint.toBase58()];
  if (usdPerWhole === undefined) return log("warn", `${tag}: no USD price for ${coin.paired_mint.toBase58()}, skipping`);

  const mintAcc = await conn.getAccountInfo(coin.paired_mint);
  if (!mintAcc) return;
  const decimals = decodeMint(mintAcc.data).decimals;
  const pairedProgram = mintAcc.owner;

  const holders = await snapshotHolders(conn, coin.mint);
  const book = (ledger[coin.mint.toBase58()] ??= {});
  const owners = new Set([...holders.map((h) => h.owner.toBase58()), ...Object.keys(book)]);
  const balances = new Map(holders.map((h) => [h.owner.toBase58(), h.amount]));
  const list = [...owners];

  const atas = await conn.getMultipleAccounts(list.map((o) => getAssociatedTokenAddress(new PublicKey(o), coin.paired_mint, pairedProgram)));
  const carriedTotal = Object.values(book).reduce((s, e) => s + BigInt(e.carried), 0n);
  const fresh = coin.holders_unpaid > carriedTotal ? coin.holders_unpaid - carriedTotal : 0n;
  const result = computePayoutRound({
    amount: fresh,
    usdPerUnit: usdPerWhole / 10 ** decimals,
    holders: list.map((o, i) => ({
      owner: o,
      balance: balances.get(o) ?? 0n,
      previousBalance: BigInt(book[o]?.lastBalance ?? balances.get(o) ?? 0n),
      carried: BigInt(book[o]?.carried ?? 0n),
      hasTokenAccount: atas[i] !== null,
    })),
  });

  const pay = result.lines.filter((l) => l.pay > 0n);
  log("info", `${tag}: ${holders.length} holders, paying ${pay.length}, rolling ${result.lines.filter((l) => l.carriedForward > 0n).length}`);

  for (const batch of chunk(pay, BATCH)) {
    const setup: Instruction[] = batch
      .filter((l) => l.createTokenAccount)
      .map((l) => createAssociatedTokenAccountIdempotent(operator.publicKey, new PublicKey(l.owner), coin.paired_mint, pairedProgram));
    const ix = client.payoutHolders(
      operator.publicKey,
      coin,
      round,
      batch.map((l) => ({ tokenAccount: getAssociatedTokenAddress(new PublicKey(l.owner), coin.paired_mint, pairedProgram), amount: l.pay })),
      pairedProgram,
    );
    const sig = await execute(conn, operator, [...setup, ix], { send, label: `${tag} payout_holders ×${batch.length}` });
    if (send && !sig) return; // stop this coin on failure; ledger unchanged for unsent batches
  }

  if (send) {
    for (const l of result.lines) {
      const bal = balances.get(l.owner) ?? 0n;
      if (l.carriedForward === 0n && bal === 0n) delete book[l.owner];
      else book[l.owner] = { carried: l.carriedForward.toString(), lastBalance: bal.toString() };
    }
  }
}

async function tick() {
  const cfg = await router.fetchRouterConfig(conn, client.programId);
  if (cfg.paused) return log("warn", "router paused");
  const ledger = readJson<Ledger>(ledgerPath, {});
  const coins = (await router.fetchAllCoins(conn, client.programId)).map((x) => x.coin).filter((c) => c.holders_unpaid > 0n);
  const round = cfg.payout_rounds + 1n;
  for (const coin of coins) {
    try {
      await payCoin(coin, ledger, round);
    } catch (err) {
      log("error", `$${router.coinTicker(coin)}: ${(err as Error).message}`);
    }
  }
  if (send) writeJson(ledgerPath, ledger);
}

const intervalMs = Number(str(f, "interval", "300")) * 1000;
do {
  try {
    await tick();
  } catch (err) {
    log("error", `tick failed: ${(err as Error).message}`);
  }
  if (f.once) break;
  await sleep(intervalMs);
} while (true);
