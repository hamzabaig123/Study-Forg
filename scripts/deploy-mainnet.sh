#!/usr/bin/env bash
# Deploy the backend canister to the IC mainnet. Run inside the toolchain
# container (dfx lives there; moc-built wasm comes from mops build):
#
#   docker compose run --rm toolchain scripts/deploy-mainnet.sh            # preflight
#   docker compose run --rm toolchain scripts/deploy-mainnet.sh --yes      # deploy
#
# The identity is the one `dfx identity use` selects — import it per run and
# never bake it into the image (docs/CANISTER-DEPLOY.md carries the full
# procedure, including funding).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WASM="$REPO/src/backend/dist/backend.wasm"
CANDID="$REPO/src/backend/dist/backend.did"

# ── Preflight ────────────────────────────────────────────────────────────────
[ -f "$WASM" ] || {
  echo "✗ $WASM missing — build first: docker compose run --rm toolchain mops build"
  exit 1
}
[ -f "$CANDID" ] || {
  echo "✗ $CANDID missing — the build should have produced it next to the wasm"
  exit 1
}

command -v dfx >/dev/null || { echo "✗ dfx not on PATH (the toolchain image has it)"; exit 1; }

WHO="$(dfx identity whoami 2>/dev/null || echo "none")"
PRINCIPAL="$(dfx identity get-principal 2>/dev/null || echo "unknown")"
echo "identity  : $WHO"
echo "principal : $PRINCIPAL"
if [ "$WHO" = "none" ] || [ "$WHO" = "anonymous" ]; then
  echo "✗ no usable identity — import one first (docs/CANISTER-DEPLOY.md → Identity)"
  exit 1
fi

echo "wasm      : $(sha256sum "$WASM" | cut -d' ' -f1)  ($(stat -c %s "$WASM") bytes)"

echo
echo "This will CREATE the backend canister on the IC mainnet (or fail kindly if"
echo "it already exists) and INSTALL the wasm fresh — the right mode for a first"
echo "deploy: the migration chain initializes state from the empty actor. An"
echo "upgrade of an existing canister is a different procedure and is NOT this."
echo

if [ "${1:-}" != "--yes" ]; then
  echo "Preflight passed. Re-run with --yes to create and install."
  exit 0
fi

# ── Deploy ───────────────────────────────────────────────────────────────────
# Creation costs a one-time cycles charge taken from the identity's wallet or
# ICP balance; a rejection here names the shortfall, and the runbook's funding
# section covers it.
dfx canister create backend --network ic

dfx canister install backend --network ic --mode install

CANISTER_ID="$(dfx canister id backend --network ic)"
echo
echo "✓ deployed as $CANISTER_ID"
echo
echo "Smoke test (zeroed stats are the expected fresh-install answer):"
dfx canister call backend getDashboardStats --network ic
echo
echo "Next: fill src/frontend/env.json with this id (docs/CANISTER-DEPLOY.md → Wiring)."
