# Local Motoko toolchain

`moc` — the Motoko compiler — ships no Windows binary, so every backend
command runs inside the `toolchain` container with this repository
bind-mounted at `/repo`. The same image serves the `pocketic` container: a
PocketIC sidecar that `test/pocketic/run-backend-lane.mjs` attaches to, so the
backend test lane runs from the Windows host.

## Commands

All of these run from the repository root.

```bash
docker compose build                                # one-time image build
docker compose run --rm toolchain mops install      # resolve mops packages
docker compose run --rm toolchain mops check        # typecheck + stable check + lint
docker compose run --rm toolchain mops build        # wasm + check-deploy (boots on PocketIC)
docker compose run --rm toolchain bash              # a shell in the toolchain
```

The first `mops build` also downloads the toolchains pinned in `mops.toml`
(`moc`, `pocket-ic`, `lintoko`) into the shared named volumes, which is what
lets the sidecar find the `pocket-ic` binary.

## The backend test lane

```bash
docker compose up -d pocketic

# Windows host, any shell:
set POCKETIC_SIDECAR_URL=http://127.0.0.1:8090    # cmd
$env:POCKETIC_SIDECAR_URL = "http://127.0.0.1:8090"  # PowerShell
export POCKETIC_SIDECAR_URL=http://127.0.0.1:8090    # Git Bash

pnpm test:backend                                 # or pnpm test for the full gate
```

`pnpm test:backend` never starts a replica of its own (that is deliberate —
see the header of `run-backend-lane.mjs`); without the sidecar URL it skips
with `no_pocketic_sidecar`. The sidecar answers `/healthz` and `/descriptor`
on port 8090 and exposes the PocketIC server itself on port 8091. It keeps
running across runs (`docker compose down` stops it); pocket-ic's idle exit is
disabled with a week-long `--ttl`.

## Stable baselines

`mops check` compares the migration chain against a stable baseline at
`.old/src/backend/dist/backend.most`. CI writes the documented empty-actor
baseline there before checking:

```bash
mkdir -p .old/src/backend/dist
printf '// Version: 1.0.0\nactor { }\n' > .old/src/backend/dist/backend.most
```

Both directories are gitignored build artifacts. If a real platform-delivered
baseline is ever present (it records what is actually deployed), back it up
before overwriting it.

## Bindings

`pnpm bindgen` needs `caffeine-bindgen`, which is not on npm under that name;
the generator is `@caffeineai/bindgen` and runs fine on the Windows host once
a build has produced `src/backend/dist/backend.did`:

```bash
npx -y @caffeineai/bindgen@0.3.1 --did-file ./src/backend/dist/backend.did --out-dir ./src/frontend/src --actor-interface-file --force
```

After any change, the regenerated `src/frontend/src/backend.ts` and
`src/frontend/src/declarations/` should diff clean (or diff only in carried
doc comments) against what was committed before — a types diff means the
candid interface changed, which is a deliberate migration, never a side
effect.
