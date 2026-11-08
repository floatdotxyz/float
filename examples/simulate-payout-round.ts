/**
 * Runs the holder-payout reference model on a live holder snapshot to show
 * what each wallet's share of a given payout would be.
 *
 *   node examples/simulate-payout-round.ts <coin-mint> <payout-amount-raw> <usd-per-raw-unit>
 *
 * Example (coin paired with USDC, distributing 25 USDC):
 *   node examples/simulate-payout-round.ts <mint> 25000000 0.000001
 */
import { Connection, PublicKey, computePayoutRound, getAssociatedTokenAddress, snapshotHolders, MINTS } from "@float-community/sdk";

const [mintArg, amountArg, usdArg, pairArg] = process.argv.slice(2);
if (!mintArg || !amountArg || !usdArg) {
  console.error("usage: node examples/simulate-payout-round.ts <coin-mint> <amount-raw> <usd-per-unit> [paired-mint]");
  process.exit(2);
}
const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com");
const pair = pairArg ? new PublicKey(pairArg) : MINTS.USDC;

const holders = await snapshotHolders(conn, new PublicKey(mintArg));
const atas = await conn.getMultipleAccounts(holders.map((h) => getAssociatedTokenAddress(h.owner, pair)));

const result = computePayoutRound({
  amount: BigInt(amountArg),
  usdPerUnit: Number(usdArg),
  holders: holders.map((h, i) => ({
    owner: h.owner.toBase58(),
    balance: h.amount,
    previousBalance: h.amount,
    carried: 0n,
    hasTokenAccount: atas[i] !== null,
  })),
});

console.table(result.lines.slice(0, 20).map((l) => ({ ...l, pay: l.pay.toString(), carriedForward: l.carriedForward.toString() })));
console.log(`paid ${result.totalPaid}, rolled over ${result.totalCarried}, dust ${result.dust}`);
