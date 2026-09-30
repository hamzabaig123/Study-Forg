# The Motoko toolchain image. `moc` (the Motoko compiler) ships no Windows
# binary, so every mops command runs inside this container with the repository
# bind-mounted at /repo. The same image serves the pocket-ic sidecar service
# (docker-compose.yml), which needs the pocket-ic binary the toolchain installs.
#
# Versions pinned here are the ones the project has verified:
# - node 22 matches CI (actions/setup-node in .github/workflows/canister-build.yml);
#   the trixie base (Debian 13, glibc 2.41) is deliberate — current dfx builds
#   refuse bookworm's glibc 2.36
# - ic-mops 3.4.1 is the CLI measured working on this project (AGENTS.md);
#   the compiler itself is pinned separately in mops.toml [toolchain], so the
#   CLI pin only guards against breaking changes in mops' own interface.
FROM node:22-trixie-slim

# git: some mops packages are fetched from VCS. curl: health probing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g ic-mops@3.4.1

# dfx is only needed for the mainnet deploy (scripts/deploy-mainnet.sh); mops
# handles everything up to the wasm. DFXVM_INIT_YES is the installer's
# non-interactive path (a container has no terminal to prompt) and installs
# dfxvm's own manifest-latest. No identity is baked into the image: the deploy
# identity is imported per run (docs/CANISTER-DEPLOY.md), never stored in a
# layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/* \
    && DFXVM_INIT_YES=1 sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)" \
    && /root/.local/share/dfx/bin/dfx --version
ENV PATH="/root/.local/share/dfx/bin:/root/.local/bin:${PATH}"

# mops asks before downloading a pinned toolchain; a container never has a TTY
# to answer with, and CI mode is its documented non-interactive path.
ENV CI=true

WORKDIR /repo

# Default to a shell so `docker compose run toolchain <command>` reads plainly.
CMD ["bash"]
