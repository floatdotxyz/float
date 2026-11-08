/**
 * Raydium Burn & Earn (CPMM liquidity locker) integration.
 *
 * At migration, LaunchLab can lock the new CPMM LP into Burn & Earn and mint
 * position NFTs to the platform and/or the creator (`PlatformConfig.platform_scale`
 * / `creator_scale`). The LP itself is locked forever, but the NFT holder can
 * keep harvesting the trading fees the locked LP earns via `collect_cp_fees`.
 *
 * Instruction names were verified as `sha256("global:<name>")[..8]`:
 *   lock_cp_liquidity  -> d8 9d 1d 4e 26 33 1f 1a
 *   collect_cp_fees    -> 08 1e 33 c7 d1 b8 f7 85
 */

import { Writer } from "../core/borsh.ts";
import { PublicKey, findProgramAddress } from "../core/pubkey.ts";
import type { Instruction } from "../core/tx.ts";
import { MEMO_PROGRAM_ID, RAYDIUM, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../programs/addresses.ts";
import { getAssociatedTokenAddress } from "../programs/spl.ts";
import type { CpmmPoolBundle } from "./cpmm.ts";
import { cpmmPda } from "./cpmm.ts";

export const BURN_AND_EARN_PROGRAM_ID = RAYDIUM.burnAndEarn;

const enc = (s: string) => new TextEncoder().encode(s);

export const lockPda = {
  authority: () => findProgramAddress([enc("lock_cp_authority_seed")], BURN_AND_EARN_PROGRAM_ID).address,
  /** Locked-liquidity state, keyed by the position NFT mint. */
  lockedLiquidity: (nftMint: PublicKey) =>
    findProgramAddress([enc("locked_liquidity"), nftMint], BURN_AND_EARN_PROGRAM_ID).address,
  /** Vault holding the locked LP tokens (ATA of the lock authority). */
  lockedLpVault: (lpMint: PublicKey) => getAssociatedTokenAddress(lockPda.authority(), lpMint, TOKEN_PROGRAM_ID),
};

export const COLLECT_CP_FEES_DISCRIMINATOR = Uint8Array.from([8, 30, 51, 199, 209, 184, 247, 133]);

/**
 * Harvests trading fees earned by a locked CPMM position.
 *
 * `lpFeeAmount` is the fee portion of the locked LP to redeem, in LP units.
 * It must not exceed what the position has accrued; the transaction fails
 * otherwise. Always simulate first (`Connection.simulateRawTransaction`).
 */
export function collectCpFeesIx(params: {
  nftOwner: PublicKey;
  nftMint: PublicKey;
  pool: CpmmPoolBundle;
  lpFeeAmount: bigint;
  /** Recipient token accounts; default to the NFT owner's ATAs. */
  recipient0?: PublicKey;
  recipient1?: PublicKey;
}): Instruction {
  const p = params.pool.pool;
  const nftAccount = getAssociatedTokenAddress(params.nftOwner, params.nftMint, TOKEN_PROGRAM_ID);
  const r0 = params.recipient0 ?? getAssociatedTokenAddress(params.nftOwner, p.token_0_mint, p.token_0_program);
  const r1 = params.recipient1 ?? getAssociatedTokenAddress(params.nftOwner, p.token_1_mint, p.token_1_program);

  const keys = [
    { pubkey: lockPda.authority(), isSigner: false, isWritable: false },
    { pubkey: params.nftOwner, isSigner: true, isWritable: false },
    { pubkey: nftAccount, isSigner: false, isWritable: true },
    { pubkey: lockPda.lockedLiquidity(params.nftMint), isSigner: false, isWritable: true },
    { pubkey: RAYDIUM.cpmm, isSigner: false, isWritable: false },
    { pubkey: cpmmPda.authority(), isSigner: false, isWritable: false },
    { pubkey: params.pool.address, isSigner: false, isWritable: true },
    { pubkey: p.lp_mint, isSigner: false, isWritable: true },
    { pubkey: r0, isSigner: false, isWritable: true },
    { pubkey: r1, isSigner: false, isWritable: true },
    { pubkey: p.token_0_vault, isSigner: false, isWritable: true },
    { pubkey: p.token_1_vault, isSigner: false, isWritable: true },
    { pubkey: p.token_0_mint, isSigner: false, isWritable: false },
    { pubkey: p.token_1_mint, isSigner: false, isWritable: false },
    { pubkey: lockPda.lockedLpVault(p.lp_mint), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  const data = new Writer().bytes(COLLECT_CP_FEES_DISCRIMINATOR).u64(params.lpFeeAmount).toBytes();
  return { programId: BURN_AND_EARN_PROGRAM_ID, keys, data };
}
