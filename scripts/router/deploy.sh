#!/usr/bin/env bash
# Build, (re)key and deploy float-router.
#
#   scripts/router/deploy.sh devnet            # build + deploy to devnet
#   scripts/router/deploy.sh mainnet --verify  # + verifiable build (solana-verify)
#
# Requires: anchor 0.31.1, solana 2.1.x, a funded deployer at ~/.config/solana/id.json
set -euo pipefail

CLUSTER="${1:-devnet}"
VERIFY="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

case "$CLUSTER" in
  localnet) URL="http://127.0.0.1:8899" ;;
  devnet)   URL="https://api.devnet.solana.com" ;;
  mainnet)  URL="${SOLANA_RPC_URL:?set SOLANA_RPC_URL for mainnet}" ;;
  *) echo "unknown cluster $CLUSTER" >&2; exit 2 ;;
esac

bold() { printf '\033[1m%s\033[0m\n' "$*"; }

bold "▸ syncing program id with target/deploy/float_router-keypair.json"
anchor keys sync

bold "▸ building"
if [[ "$VERIFY" == "--verify" ]]; then
  solana-verify build --library-name float_router
else
  anchor build
fi

bold "▸ checking the committed TypeScript IDL against the Rust source"
node scripts/dev/gen-router-idl.ts
node scripts/dev/check-anchor-idl.ts target/idl/float_router.json

PROGRAM_ID="$(solana address -k target/deploy/float_router-keypair.json)"
bold "▸ deploying $PROGRAM_ID to $CLUSTER"
solana program deploy target/deploy/float_router.so \
  --program-id target/deploy/float_router-keypair.json \
  --url "$URL" \
  --with-compute-unit-price 50000 \
  --max-sign-attempts 20

bold "▸ done"
echo "export FLOAT_ROUTER_PROGRAM_ID=$PROGRAM_ID"
echo "next: node scripts/router/init.ts --rpc $URL --operator <bot> --treasury <wallet> --flagship-mint <mint> --platform-config <launchlab-platform-config>"
