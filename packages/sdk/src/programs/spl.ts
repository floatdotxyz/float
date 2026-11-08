/**
 * SPL Token / Token-2022 helpers: account decoding and the handful of
 * instructions needed to receive, wrap and unwrap tokens.
 */

import { Reader, Writer } from "../core/borsh.ts";
import { PublicKey, findProgramAddress } from "../core/pubkey.ts";
import type { Instruction } from "../core/tx.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./addresses.ts";

export const TOKEN_ACCOUNT_SIZE = 165;
export const MINT_SIZE = 82;

export interface TokenAccount {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  /** 0 = uninitialized, 1 = initialized, 2 = frozen */
  state: number;
  isNative: bigint | null;
}

export interface Mint {
  mintAuthority: PublicKey | null;
  supply: bigint;
  decimals: number;
  isInitialized: boolean;
  freezeAuthority: PublicKey | null;
  /** Token-2022 TransferFeeConfig, if the mint has one. */
  transferFee?: { epoch: bigint; maximumFee: bigint; basisPoints: number };
}

export function decodeTokenAccount(data: Uint8Array): TokenAccount {
  const r = new Reader(data);
  const mint = r.pubkey();
  const owner = r.pubkey();
  const amount = r.u64();
  r.u32(); r.bytes(32); // delegate (COption<Pubkey>)
  const state = r.u8();
  const isNativeTag = r.u32();
  const isNativeVal = r.u64();
  return { mint, owner, amount, state, isNative: isNativeTag ? isNativeVal : null };
}

export function decodeMint(data: Uint8Array): Mint {
  const r = new Reader(data);
  const maTag = r.u32();
  const ma = r.pubkey();
  const supply = r.u64();
  const decimals = r.u8();
  const isInitialized = r.bool();
  const faTag = r.u32();
  const fa = r.pubkey();
  const mint: Mint = {
    mintAuthority: maTag ? ma : null,
    supply,
    decimals,
    isInitialized,
    freezeAuthority: faTag ? fa : null,
  };
  const tf = findTransferFeeConfig(data);
  if (tf) mint.transferFee = tf;
  return mint;
}

/**
 * Token-2022 extensions start after the 165-byte base (mint padded to the
 * account size) plus one AccountType byte, as a TLV list of (u16 type, u16 len, data).
 * Extension type 1 = TransferFeeConfig.
 */
function findTransferFeeConfig(data: Uint8Array): Mint["transferFee"] | undefined {
  if (data.length <= TOKEN_ACCOUNT_SIZE + 1) return undefined;
  const r = new Reader(data, TOKEN_ACCOUNT_SIZE + 1);
  while (r.remaining >= 4) {
    const type = r.u16();
    const len = r.u16();
    if (type === 0) break;
    if (type === 1 && len >= 108) {
      r.bytes(64); // config authority + withdraw authority
      r.u64(); // withheld amount
      // older_transfer_fee (epoch, max, bps) then newer_transfer_fee
      r.u64(); r.u64(); r.u16();
      const epoch = r.u64();
      const maximumFee = r.u64();
      const basisPoints = r.u16();
      return { epoch, maximumFee, basisPoints };
    }
    r.bytes(len);
  }
  return undefined;
}

/** Fee charged by a Token-2022 transfer-fee mint for a transfer of `amount`. */
export function transferFeeFor(mint: Mint, amount: bigint): bigint {
  if (!mint.transferFee || mint.transferFee.basisPoints === 0) return 0n;
  const raw = (amount * BigInt(mint.transferFee.basisPoints) + 9_999n) / 10_000n;
  return raw > mint.transferFee.maximumFee ? mint.transferFee.maximumFee : raw;
}

export function getAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return findProgramAddress([owner, tokenProgram, mint], ASSOCIATED_TOKEN_PROGRAM_ID).address;
}

/** `CreateIdempotent` (ATA program instruction 1): no-op if the ATA exists. */
export function createAssociatedTokenAccountIdempotent(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): Instruction {
  const ata = getAssociatedTokenAddress(owner, mint, tokenProgram);
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1),
  };
}

export function transferChecked(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): Instruction {
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: new Writer().u8(12).u64(amount).u8(decimals).toBytes(),
  };
}

/** Closes a token account, returning its rent (and wrapped SOL) to `destination`. */
export function closeAccount(
  account: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): Instruction {
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Uint8Array.of(9),
  };
}

/** Updates a native (wSOL) account's token amount to match its lamports. */
export function syncNative(account: PublicKey): Instruction {
  return {
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }],
    data: Uint8Array.of(17),
  };
}

/** SPL `Burn` (instruction 8). */
export function burn(
  account: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): Instruction {
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: new Writer().u8(8).u64(amount).toBytes(),
  };
}

/** System `Transfer` (instruction 2). */
export function systemTransfer(from: PublicKey, to: PublicKey, lamports: bigint): Instruction {
  return {
    programId: SYSTEM_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data: new Writer().u32(2).u64(lamports).toBytes(),
  };
}

export function isTokenProgram(id: PublicKey): boolean {
  return id.equals(TOKEN_PROGRAM_ID) || id.equals(TOKEN_2022_PROGRAM_ID);
}
