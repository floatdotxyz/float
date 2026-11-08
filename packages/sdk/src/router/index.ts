/**
 * Client for the `float-router` program (programs/float-router).
 *
 * The IDL is generated from the Rust source by `scripts/dev/gen-router-idl.ts`,
 * so account order, flags and argument layouts match the program exactly.
 */

import idlJson from "../../idl/float_router.json" with { type: "json" };
import { IdlCoder, type Idl } from "../core/idl.ts";
import { PublicKey, findProgramAddress } from "../core/pubkey.ts";
import type { Connection } from "../core/rpc.ts";
import type { AccountMeta, Instruction } from "../core/tx.ts";
import { MINTS, RAYDIUM, TOKEN_PROGRAM_ID } from "../programs/addresses.ts";
import { getAssociatedTokenAddress } from "../programs/spl.ts";
import { encodeBase58 } from "../core/base58.ts";
import type { CpmmPool } from "../raydium/cpmm.ts";

export const routerCoder = new IdlCoder(idlJson as unknown as Idl);
export const ROUTER_PROGRAM_ID = routerCoder.programId;

export const VaultKind = { Holders: 0, Flagship: 1, Traders: 2 } as const;
export type VaultKindValue = (typeof VaultKind)[keyof typeof VaultKind];

const enc = (s: string) => new TextEncoder().encode(s);
const u64le = (n: bigint | number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};

/** PDA helpers. Pass `programId` to target a deployment with a different id. */
export function routerPda(programId: PublicKey = ROUTER_PROGRAM_ID) {
  const f = (seeds: (Uint8Array | PublicKey)[]) => findProgramAddress(seeds, programId).address;
  return {
    config: () => f([enc("config")]),
    authority: () => f([enc("authority")]),
    coin: (mint: PublicKey) => f([enc("coin"), mint]),
    ticker: (normalized: string) => f([enc("ticker"), enc(normalized)]),
    tickerEscrow: (mint: PublicKey) => f([enc("ticker_escrow"), mint]),
    vault: (kind: VaultKindValue, mint: PublicKey) => f([enc("vault"), Uint8Array.of(kind), mint]),
    airdrop: (roundId: bigint) => f([enc("airdrop"), u64le(roundId)]),
    airdropEscrow: (roundId: bigint) => f([enc("airdrop"), u64le(roundId), enc("escrow")]),
    claim: (roundId: bigint, index: bigint | number) => f([enc("claim"), u64le(roundId), u64le(index)]),
  };
}

// ---------------------------------------------------------------- accounts

export interface SplitConfig { holders: number; creator: number; flagship: number; traders: number; treasury: number }

export interface RouterConfig {
  admin: PublicKey;
  pending_admin: PublicKey;
  operator: PublicKey;
  treasury: PublicKey;
  flagship_mint: PublicKey;
  launchlab_platform_config: PublicKey;
  split: SplitConfig;
  guard_bps: number;
  max_impact_bps: number;
  buyback_target_lamports: bigint;
  buyback_interval_secs: bigint;
  last_buyback_ts: bigint;
  total_burned: bigint;
  total_sol_spent: bigint;
  coins_registered: bigint;
  payout_rounds: bigint;
  paused: boolean;
  bump: number;
  authority_bump: number;
}

export interface CoinRecord {
  mint: PublicKey;
  paired_mint: PublicKey;
  launchlab_pool: PublicKey;
  launcher: PublicKey;
  creator_wallet: PublicKey;
  ticker: Uint8Array;
  ticker_len: number;
  launched_at: bigint;
  graduated_at: bigint;
  reuse_fee: bigint;
  reuse_fee_settled: boolean;
  total_cycled: bigint;
  total_holders: bigint;
  total_creator: bigint;
  total_flagship: bigint;
  total_traders: bigint;
  total_treasury: bigint;
  holders_unpaid: bigint;
  pending_base_fees: bigint;
  bump: number;
}

export interface AirdropRound {
  round_id: bigint;
  root: Uint8Array;
  mint: PublicKey;
  total: bigint;
  claimed: bigint;
  claims: number;
  created_at: bigint;
  expires_at: bigint;
  closed: boolean;
}

export const decodeRouterConfig = (d: Uint8Array) => routerCoder.decodeAccount<RouterConfig>("RouterConfig", d);
export const decodeCoinRecord = (d: Uint8Array) => routerCoder.decodeAccount<CoinRecord>("CoinRecord", d);
export const decodeAirdropRound = (d: Uint8Array) => routerCoder.decodeAccount<AirdropRound>("AirdropRound", d);

export function coinTicker(c: CoinRecord): string {
  return new TextDecoder().decode(c.ticker.subarray(0, c.ticker_len));
}

export async function fetchRouterConfig(conn: Connection, programId = ROUTER_PROGRAM_ID): Promise<RouterConfig> {
  const acc = await conn.getAccountInfo(routerPda(programId).config());
  if (!acc) throw new Error("Router config not initialised");
  return decodeRouterConfig(acc.data);
}

/** All registered coins (getProgramAccounts filtered by the CoinRecord discriminator). */
export async function fetchAllCoins(conn: Connection, programId = ROUTER_PROGRAM_ID): Promise<{ address: PublicKey; coin: CoinRecord }[]> {
  const accs = await conn.getProgramAccounts(programId, [
    { memcmp: { offset: 0, bytes: encodeBase58(routerCoder.accountDiscriminator("CoinRecord")) } },
  ]);
  return accs.map((a) => ({ address: a.address, coin: decodeCoinRecord(a.data) }));
}

// ------------------------------------------------------------ price helpers

export const Q64 = 1n << 64n;

/** Q64.64 price (output per input) from two raw reserves. */
export function priceQ64(outputReserve: bigint, inputReserve: bigint): bigint {
  if (inputReserve === 0n) throw new RangeError("inputReserve is zero");
  return (outputReserve * Q64) / inputReserve;
}

// ------------------------------------------------------------- instructions

type Keys = Record<string, PublicKey | string>;

export class RouterClient {
  readonly programId: PublicKey;
  readonly pda: ReturnType<typeof routerPda>;
  private readonly coder: IdlCoder;

  constructor(programId: PublicKey = ROUTER_PROGRAM_ID) {
    this.programId = programId;
    this.pda = routerPda(programId);
    this.coder = programId.equals(ROUTER_PROGRAM_ID)
      ? routerCoder
      : new IdlCoder({ ...(idlJson as unknown as Idl), address: programId.toBase58() });
  }

  private ix(name: string, accounts: Keys, args: Record<string, unknown> = {}, remaining: AccountMeta[] = []): Instruction {
    return this.coder.buildInstruction(name, accounts, args, remaining);
  }

  private routeTargets(paired: PublicKey, creatorWallet: PublicKey, treasury: PublicKey, pairedProgram = TOKEN_PROGRAM_ID): Keys {
    return {
      holders_vault: this.pda.vault(VaultKind.Holders, paired),
      flagship_vault: this.pda.vault(VaultKind.Flagship, paired),
      traders_vault: this.pda.vault(VaultKind.Traders, paired),
      creator_token: getAssociatedTokenAddress(creatorWallet, paired, pairedProgram),
      treasury_token: getAssociatedTokenAddress(treasury, paired, pairedProgram),
    };
  }

  // admin
  initialize(admin: PublicKey, params: {
    operator: PublicKey; treasury: PublicKey; flagship_mint: PublicKey; launchlab_platform_config: PublicKey;
    split?: SplitConfig; guard_bps?: number; max_impact_bps?: number; buyback_target_lamports?: bigint; buyback_interval_secs?: bigint;
  }): Instruction {
    return this.ix("initialize", { admin, config: this.pda.config(), authority: this.pda.authority() }, {
      params: {
        operator: params.operator,
        treasury: params.treasury,
        flagship_mint: params.flagship_mint,
        launchlab_platform_config: params.launchlab_platform_config,
        split: params.split ?? { holders: 1500, creator: 500, flagship: 3500, traders: 3500, treasury: 1000 },
        guard_bps: params.guard_bps ?? 200,
        max_impact_bps: params.max_impact_bps ?? 100,
        buyback_target_lamports: params.buyback_target_lamports ?? 5_000_000_000n,
        buyback_interval_secs: params.buyback_interval_secs ?? 14_400n,
      },
    });
  }

  updateConfig(admin: PublicKey, params: Partial<{ operator: PublicKey; treasury: PublicKey; split: SplitConfig; guard_bps: number; max_impact_bps: number; buyback_target_lamports: bigint; buyback_interval_secs: bigint }>): Instruction {
    const opt = <T>(v: T | undefined) => (v === undefined ? null : v);
    return this.ix("update_config", { admin, config: this.pda.config() }, {
      params: {
        operator: opt(params.operator), treasury: opt(params.treasury), split: opt(params.split), guard_bps: opt(params.guard_bps),
        max_impact_bps: opt(params.max_impact_bps), buyback_target_lamports: opt(params.buyback_target_lamports), buyback_interval_secs: opt(params.buyback_interval_secs),
      },
    });
  }

  setPaused(admin: PublicKey, paused: boolean): Instruction {
    return this.ix("set_paused", { admin, config: this.pda.config() }, { paused });
  }

  proposeAdmin(admin: PublicKey, newAdmin: PublicKey): Instruction {
    return this.ix("propose_admin", { admin, config: this.pda.config() }, { new_admin: newAdmin });
  }

  acceptAdmin(pendingAdmin: PublicKey): Instruction {
    return this.ix("accept_admin", { pending_admin: pendingAdmin, config: this.pda.config() });
  }

  // setup
  initMintVaults(payer: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): Instruction {
    const authority = this.pda.authority();
    return this.ix("init_mint_vaults", {
      payer, config: this.pda.config(), authority, mint,
      holders_vault: this.pda.vault(VaultKind.Holders, mint),
      flagship_vault: this.pda.vault(VaultKind.Flagship, mint),
      traders_vault: this.pda.vault(VaultKind.Traders, mint),
      intake: getAssociatedTokenAddress(authority, mint, tokenProgram),
      token_program: tokenProgram,
    });
  }

  // coins
  registerCoin(launcher: PublicKey, coinMint: PublicKey, pairedMint: PublicKey, normalizedTicker: string, creatorWallet: PublicKey): Instruction {
    return this.ix("register_coin", {
      launcher, config: this.pda.config(), coin_mint: coinMint, paired_mint: pairedMint,
      launchlab_pool: findProgramAddress([enc("pool"), coinMint, pairedMint], RAYDIUM.launchLab).address,
      ticker_record: this.pda.ticker(normalizedTicker), coin_record: this.pda.coin(coinMint), ticker_escrow: this.pda.tickerEscrow(coinMint),
    }, { ticker: normalizedTicker, creator_wallet: creatorWallet });
  }

  markGraduated(coin: CoinRecord): Instruction {
    return this.ix("mark_graduated", { coin_record: this.pda.coin(coin.mint), launchlab_pool: coin.launchlab_pool });
  }

  settleTickerFee(coin: CoinRecord, treasury: PublicKey): Instruction {
    return this.ix("settle_ticker_fee", {
      config: this.pda.config(), coin_record: this.pda.coin(coin.mint), ticker_escrow: this.pda.tickerEscrow(coin.mint),
      launcher: coin.launcher, treasury,
    });
  }

  // cycling
  cycleLaunchLab(payer: PublicKey, coin: CoinRecord, cfg: Pick<RouterConfig, "treasury" | "launchlab_platform_config">, poolQuoteVault: PublicKey): Instruction {
    const authority = this.pda.authority();
    return this.ix("cycle_launchlab", {
      payer, config: this.pda.config(), authority, coin_record: this.pda.coin(coin.mint),
      launchlab_pool: coin.launchlab_pool, launchlab_platform_config: cfg.launchlab_platform_config,
      pool_quote_vault: poolQuoteVault, paired_mint: coin.paired_mint,
      intake: getAssociatedTokenAddress(authority, coin.paired_mint),
      ...this.routeTargets(coin.paired_mint, coin.creator_wallet, cfg.treasury),
    });
  }

  cycleCpmm(payer: PublicKey, coin: CoinRecord, cfg: Pick<RouterConfig, "treasury">, poolAddress: PublicKey, pool: CpmmPool): Instruction {
    const authority = this.pda.authority();
    const pairedIs0 = pool.token_0_mint.equals(coin.paired_mint);
    const pairedProgram = pairedIs0 ? pool.token_0_program : pool.token_1_program;
    return this.ix("cycle_cpmm", {
      payer, config: this.pda.config(), authority, coin_record: this.pda.coin(coin.mint),
      cpmm_pool: poolAddress, amm_config: pool.amm_config,
      token_0_vault: pool.token_0_vault, token_1_vault: pool.token_1_vault,
      vault_0_mint: pool.token_0_mint, vault_1_mint: pool.token_1_mint,
      authority_token_0: getAssociatedTokenAddress(authority, pool.token_0_mint, pool.token_0_program),
      authority_token_1: getAssociatedTokenAddress(authority, pool.token_1_mint, pool.token_1_program),
      token_0_program: pool.token_0_program, token_1_program: pool.token_1_program,
      ...this.routeTargets(coin.paired_mint, coin.creator_wallet, cfg.treasury, pairedProgram),
    });
  }

  swapBaseFees(operator: PublicKey, coin: CoinRecord, cfg: Pick<RouterConfig, "treasury">, poolAddress: PublicKey, pool: CpmmPool, amountIn: bigint, referencePriceQ64: bigint): Instruction {
    const authority = this.pda.authority();
    const coinIs0 = pool.token_0_mint.equals(coin.mint);
    const coinProgram = coinIs0 ? pool.token_0_program : pool.token_1_program;
    const pairedProgram = coinIs0 ? pool.token_1_program : pool.token_0_program;
    return this.ix("swap_base_fees", {
      operator, config: this.pda.config(), authority, coin_record: this.pda.coin(coin.mint),
      coin_mint: coin.mint, paired_mint: coin.paired_mint,
      coin_token: getAssociatedTokenAddress(authority, coin.mint, coinProgram),
      intake: getAssociatedTokenAddress(authority, coin.paired_mint, pairedProgram),
      cpmm_pool: poolAddress, amm_config: pool.amm_config,
      input_vault: coinIs0 ? pool.token_0_vault : pool.token_1_vault,
      output_vault: coinIs0 ? pool.token_1_vault : pool.token_0_vault,
      observation_state: pool.observation_key,
      ...this.routeTargets(coin.paired_mint, coin.creator_wallet, cfg.treasury, pairedProgram),
      coin_token_program: coinProgram, paired_token_program: pairedProgram,
    }, { amount_in: amountIn, reference_price_q64: referencePriceQ64 });
  }

  convertVault(operator: PublicKey, kind: 1 | 2, sourceMint: PublicKey, poolAddress: PublicKey, pool: CpmmPool, amountIn: bigint, referencePriceQ64: bigint): Instruction {
    const target = kind === VaultKind.Flagship ? MINTS.WSOL : MINTS.USDC;
    const srcIs0 = pool.token_0_mint.equals(sourceMint);
    return this.ix("convert_vault", {
      operator, config: this.pda.config(), authority: this.pda.authority(),
      source_mint: sourceMint, target_mint: target,
      source_vault: this.pda.vault(kind, sourceMint), target_vault: this.pda.vault(kind, target),
      cpmm_pool: poolAddress, amm_config: pool.amm_config,
      input_vault: srcIs0 ? pool.token_0_vault : pool.token_1_vault,
      output_vault: srcIs0 ? pool.token_1_vault : pool.token_0_vault,
      observation_state: pool.observation_key,
      source_token_program: srcIs0 ? pool.token_0_program : pool.token_1_program,
      target_token_program: srcIs0 ? pool.token_1_program : pool.token_0_program,
    }, { kind, amount_in: amountIn, reference_price_q64: referencePriceQ64 });
  }

  executeBuyback(operator: PublicKey, flagshipMint: PublicKey, poolAddress: PublicKey, pool: CpmmPool, amountIn: bigint, referencePriceQ64: bigint): Instruction {
    const authority = this.pda.authority();
    const solIs0 = pool.token_0_mint.equals(MINTS.WSOL);
    const floatProgram = solIs0 ? pool.token_1_program : pool.token_0_program;
    return this.ix("execute_buyback", {
      operator, config: this.pda.config(), authority, float_mint: flagshipMint,
      sol_vault: this.pda.vault(VaultKind.Flagship, MINTS.WSOL),
      float_intake: getAssociatedTokenAddress(authority, flagshipMint, floatProgram),
      cpmm_pool: poolAddress, amm_config: pool.amm_config,
      input_vault: solIs0 ? pool.token_0_vault : pool.token_1_vault,
      output_vault: solIs0 ? pool.token_1_vault : pool.token_0_vault,
      observation_state: pool.observation_key,
      wsol_token_program: TOKEN_PROGRAM_ID, float_token_program: floatProgram,
    }, { amount_in: amountIn, reference_price_q64: referencePriceQ64 });
  }

  // holders
  payoutHolders(operator: PublicKey, coin: CoinRecord, round: bigint, payouts: { tokenAccount: PublicKey; amount: bigint }[], tokenProgram = TOKEN_PROGRAM_ID): Instruction {
    return this.ix("payout_holders", {
      operator, config: this.pda.config(), authority: this.pda.authority(), coin_record: this.pda.coin(coin.mint),
      paired_mint: coin.paired_mint, holders_vault: this.pda.vault(VaultKind.Holders, coin.paired_mint), token_program: tokenProgram,
    }, { round, amounts: payouts.map((p) => p.amount) }, payouts.map((p) => ({ pubkey: p.tokenAccount, isSigner: false, isWritable: true })));
  }

  // traders
  createAirdrop(operator: PublicKey, roundId: bigint, root: Uint8Array, total: bigint, expiresAt: bigint): Instruction {
    return this.ix("create_airdrop", {
      operator, config: this.pda.config(), authority: this.pda.authority(),
      traders_vault: this.pda.vault(VaultKind.Traders, MINTS.USDC),
      round: this.pda.airdrop(roundId), escrow: this.pda.airdropEscrow(roundId), token_program: TOKEN_PROGRAM_ID,
    }, { round_id: roundId, root, total, expires_at: expiresAt });
  }

  claimAirdrop(payer: PublicKey, roundId: bigint, index: number, wallet: PublicKey, amount: bigint, proof: Uint8Array[]): Instruction {
    return this.ix("claim_airdrop", {
      payer, config: this.pda.config(), authority: this.pda.authority(),
      round: this.pda.airdrop(roundId), escrow: this.pda.airdropEscrow(roundId), wallet,
      recipient_token: getAssociatedTokenAddress(wallet, MINTS.USDC), usdc_mint: MINTS.USDC,
      receipt: this.pda.claim(roundId, index), token_program: TOKEN_PROGRAM_ID,
    }, { round_id: roundId, index: BigInt(index), amount, proof });
  }

  closeAirdrop(operator: PublicKey, roundId: bigint): Instruction {
    return this.ix("close_airdrop", {
      operator, config: this.pda.config(), authority: this.pda.authority(),
      round: this.pda.airdrop(roundId), escrow: this.pda.airdropEscrow(roundId), usdc_mint: MINTS.USDC,
      traders_vault: this.pda.vault(VaultKind.Traders, MINTS.USDC), token_program: TOKEN_PROGRAM_ID,
    }, { round_id: roundId });
  }
}
