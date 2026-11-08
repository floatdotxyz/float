/**
 * Prints a coin's LaunchLab state, the fee a 1-unit buy would pay, and what a
 * fee cycle would route right now.
 *
 *   SOLANA_RPC_URL=https://... node examples/inspect-coin.ts <coin-mint> [paired-mint]
 */
import { Connection, MINTS, PublicKey, formatUnits, launchLab, previewCycle } from "@float-community/sdk";

const [coinArg, pairArg] = process.argv.slice(2);
if (!coinArg) {
  console.error("usage: node examples/inspect-coin.ts <coin-mint> [paired-mint]");
  process.exit(2);
}

const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com");
const coin = new PublicKey(coinArg);
const pair = pairArg ? new PublicKey(pairArg) : MINTS.WSOL;

const poolAddr = launchLab.launchLabPda.pool(coin, pair);
const bundle = await launchLab.fetchLaunchLabPool(conn, poolAddr);
const { pool } = bundle;

console.log("LaunchLab pool:", poolAddr.toBase58());
console.log("Platform:      ", bundle.platformConfig.name);
console.log("Progress:      ", (launchLab.bondingProgress(pool) * 100).toFixed(2) + "%");

const oneUnit = 10n ** BigInt(pool.quote_decimals);
const q = launchLab.quoteBuyExactIn(pool, oneUnit, launchLab.feeRatesOf(bundle));
console.log(`A 1-unit buy pays ${formatUnits(q.fees.total, pool.quote_decimals)} in fees, ` +
  `${formatUnits(q.fees.platform, pool.quote_decimals)} of which feeds the Float split.`);

const cycle = await previewCycle(conn, coin, pair);
console.log("\nPending for this coin:", formatUnits(cycle.totalPending, pool.quote_decimals));
for (const [bucket, amount] of Object.entries(cycle.split)) {
  console.log(`  ${bucket.padEnd(9)} ${formatUnits(amount, pool.quote_decimals)}`);
}
