import { PublicKey } from "../core/pubkey.ts";

/**
 * Float mainnet addresses, as listed in the official docs
 * (https://www.floatlaunch.xyz/docs, "Links" section). Verify on Solscan
 * before relying on them: https://solscan.io/account/<address>
 */
export const FLOAT = {
  /** The Float on-chain program. */
  program: new PublicKey("3KguFi7YYzLgttG46fRism16CfcuNCkDh6U7td9JTqxX"),
  /** Float config account. */
  config: new PublicKey("AgaKFP4SfEeeM4r4GcSWBwpEAbfHh7wLkJGHqpWrLBQV"),
  /** $FLOAT, the flagship token (mint). */
  flagshipMint: new PublicKey("Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr"),
  /** Vault that accumulates the 35% flagship share for $FLOAT buyback & burn. */
  buybackBurnVault: new PublicKey("8CskoMx4FaXjp7gzxNzaWQXGXGVBWYnNWXGcisXuDYAa"),
  /** Vault that accumulates the 35% trader share (USDC airdrops). */
  traderAirdropVault: new PublicKey("JEK3WrPuiePy8vYmzN7Xfk6YoMChbsiqzBs7X43y3snH"),
  /** Wallet of the holder payout bot. */
  holderPayoutBot: new PublicKey("6LYfrwR67XS8zJPxD2PTEHKocr3d2MBgkZX8umGTfw6E"),
  /** Platform treasury (10% share, ticker reuse fees). */
  treasury: new PublicKey("2LMWFmbGBfw78ZEas2NFmAYfo4bhyBqYboYh9nk3mDFQ"),
} as const;

/** Raydium programs Float builds on. */
export const RAYDIUM = {
  /** LaunchLab bonding-curve launchpad (`raydium_launchpad`). */
  launchLab: new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj"),
  /** LaunchLab vault authority PDA (seed `vault_auth_seed`). */
  launchLabAuthority: new PublicKey("WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh"),
  /** CPMM constant-product AMM (`raydium_cp_swap`). Graduated coins trade here. */
  cpmm: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
  /** CPMM vault & LP mint authority PDA (seed `vault_and_lp_mint_auth_seed`). */
  cpmmAuthority: new PublicKey("GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL"),
  /** Burn & Earn liquidity locker (CPMM LP → fee-bearing position NFT). */
  burnAndEarn: new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE"),
  /** Burn & Earn authority PDA (seed `lock_cp_authority_seed`). */
  burnAndEarnAuthority: new PublicKey("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH"),
} as const;

export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const RENT_SYSVAR_ID = new PublicKey("SysvarRent111111111111111111111111111111111");

export const MINTS = {
  WSOL: new PublicKey("So11111111111111111111111111111111111111112"),
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
} as const;

export const LAMPORTS_PER_SOL = 1_000_000_000n;

export function solscan(address: PublicKey | string, kind: "account" | "tx" | "token" = "account"): string {
  return `https://solscan.io/${kind}/${address.toString()}`;
}
