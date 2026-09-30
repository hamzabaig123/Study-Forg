#!/bin/bash
# Entry point for the pocket-ic sidecar service (docker-compose.yml).
#
# The pocket-ic binary is not baked into the image: mops installs the version
# pinned in mops.toml [toolchain] into its cache on first use, and the sidecar
# shares that cache volume with the toolchain service. Run the toolchain once
# (`docker compose run --rm toolchain mops build`) before starting the sidecar,
# or let this script fail with a message naming the missing prerequisite.
set -euo pipefail

# Resolve the wrapper next to this script, not a fixed path: in the Docker
# image the script is mounted at /sidecar, in CI it lives in the checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

BIN="${POCKET_IC_BIN:-}"

if [ -z "$BIN" ]; then
  # mops keeps toolchains under its cache/home; search both spellings and both
  # homes (the Docker container runs as root, a CI runner does not) rather than
  # pinning one layout that a mops upgrade may move.
  BIN="$(find "${HOME:-/root}/.cache" "${HOME:-/root}/.mops" /root/.cache /root/.mops \
    -type f -name 'pocket-ic*' -perm -u+x 2>/dev/null | head -n 1 || true)"
fi

if [ -z "$BIN" ]; then
  echo "sidecar: no pocket-ic binary found in /root/.cache or /root/.mops" >&2
  echo "sidecar: run 'docker compose run --rm toolchain mops build' first — mops installs the pinned pocket-ic there" >&2
  exit 1
fi

echo "sidecar: using pocket-ic at $BIN"
# The wrapper reads the path from the environment; a shell variable is not
# enough — it must cross into the node process.
export POCKET_IC_BIN="$BIN"
exec node "$SCRIPT_DIR/pocketic-sidecar.mjs"
