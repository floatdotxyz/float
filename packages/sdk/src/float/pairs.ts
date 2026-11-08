/**
 * Pair catalogue: the quote tokens Float coins can be launched against, with
 * the risk notes that apply to each family. Mint addresses are only listed
 * where they are canonical; for third-party assets always take the mint from
 * the coin's page or its LaunchLab pool (`pool_state.quote_mint`).
 */

import { MINTS } from "../programs/addresses.ts";

export type PairFamily =
  | "native"
  | "stable"
  | "tokenized-stock"
  | "pre-ipo"
  | "bridged"
  | "leveraged";

export interface PairInfo {
  symbol: string;
  family: PairFamily;
  mint?: string;
  /** Transfer fee charged by the issuer on every transfer, in bps. */
  transferFeeBps?: number;
  notes: string[];
}

export const PAIRS: readonly PairInfo[] = Object.freeze([
  { symbol: "SOL", family: "native", mint: MINTS.WSOL.toBase58(), notes: ["Paid out as wrapped SOL; unwrap from the Profile page."] },
  { symbol: "USDC", family: "stable", mint: MINTS.USDC.toBase58(), notes: [] },
  {
    symbol: "Tokenized stocks",
    family: "tokenized-stock",
    notes: [
      "Issued by third parties who can pause, move or burn tokens and change transfer rules.",
      "Trading and rewards stop while an issuer pauses.",
      "Float is not affiliated with or endorsed by the companies behind the stocks. Coins are not shares.",
    ],
  },
  { symbol: "PreStocks pre-IPO", family: "pre-ipo", transferFeeBps: 100, notes: ["1% transfer fee on every transfer."] },
  { symbol: "Tessera pre-IPO", family: "pre-ipo", transferFeeBps: 20, notes: ["0.2% transfer fee on every transfer."] },
  { symbol: "ZEC", family: "bridged", notes: ["Bridged to Solana."] },
  { symbol: "XMR", family: "bridged", notes: ["Bridged to Solana.", "Thinner pools: large trades move the price more."] },
  { symbol: "xSOL", family: "leveraged", notes: ["Hylo leveraged token: moves several times more than SOL."] },
  {
    symbol: "XBTC",
    family: "leveraged",
    notes: [
      "Hylo leveraged token: moves several times more than BTC.",
      "No Raydium pool into SOL or USDC yet: buyback and airdrop shares wait in the vaults until one exists.",
    ],
  },
  {
    symbol: "XHYPE",
    family: "leveraged",
    notes: [
      "Hylo leveraged token: moves several times more than HYPE.",
      "No Raydium pool into SOL or USDC yet: buyback and airdrop shares wait in the vaults until one exists.",
    ],
  },
]);

/** Net amount received after an issuer transfer fee. */
export function afterTransferFee(amount: bigint, transferFeeBps = 0): bigint {
  return amount - (amount * BigInt(transferFeeBps) + 9_999n) / 10_000n;
}
