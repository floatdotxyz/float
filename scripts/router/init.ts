/**
 * Initialises a freshly deployed float-router and its vaults.
 *
 *   node scripts/router/init.ts \
 *     --operator <bot-pubkey> --treasury <wallet> \
 *     --flagship-mint <mint> --platform-config <launchlab-platform-config> \
 *     [--pairs <mint,mint,...>] [--send]
 *
 * Creates the config, then vaults + intake ATAs for WSOL, USDC, the flagship
 * mint and every paired mint passed in --pairs.
 *
 * After this, the LaunchLab platform admin must point the platform config at
 * the router authority PDA (printed below):
 *   - PlatformConfig.platform_fee_wallet = <authority>
 *   - PlatformConfig.platform_cp_creator = <authority>
 */
import { MINTS, PublicKey } from "@float-community/sdk";
import { execute, flags, keypair, log, need, routerClient, rpc, str } from "../lib/runtime.ts";

const f = flags();
const conn = rpc(f);
const admin = keypair(f);
const client = routerClient(f);
const send = Boolean(f.send);

const flagship = new PublicKey(need(f, "flagship-mint"));
const exists = await conn.getAccountInfo(client.pda.config());

if (!exists) {
  await execute(conn, admin, [
    client.initialize(admin.publicKey, {
      operator: new PublicKey(need(f, "operator")),
      treasury: new PublicKey(need(f, "treasury")),
      flagship_mint: flagship,
      launchlab_platform_config: new PublicKey(need(f, "platform-config")),
    }),
  ], { send, label: "initialize" });
} else {
  log("info", "config already initialised, skipping");
}

const pairs = (str(f, "pairs") ?? "").split(",").filter(Boolean).map((m) => new PublicKey(m));
const mints = [MINTS.WSOL, MINTS.USDC, flagship, ...pairs];
const seen = new Set<string>();
for (const mint of mints) {
  if (seen.has(mint.toBase58())) continue;
  seen.add(mint.toBase58());
  const mintAcc = await conn.getAccountInfo(mint);
  if (!mintAcc) throw new Error(`mint ${mint.toBase58()} not found`);
  if (await conn.getAccountInfo(client.pda.vault(0, mint))) {
    log("info", `vaults for ${mint.toBase58()} exist`);
    continue;
  }
  await execute(conn, admin, [client.initMintVaults(admin.publicKey, mint, mintAcc.owner)], { send, label: `init_mint_vaults ${mint.toBase58()}` });
}

log("info", `router authority: ${client.pda.authority().toBase58()}`);
log("info", "set it as platform_fee_wallet and platform_cp_creator on the LaunchLab platform config");
if (!send) log("info", "dry run — pass --send to broadcast");
