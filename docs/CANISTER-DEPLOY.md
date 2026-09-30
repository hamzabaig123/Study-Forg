# Deploying the backend canister to the IC mainnet

The canister compiles, boots on PocketIC, and passes its test lane locally
(`docker/README.md`). This is the procedure that puts it on the real
network. The deploy identity and the cycles are the two things this repo
cannot carry — everything else is scripted.

## 0. Build

```bash
docker compose run --rm toolchain mops build
```

produces `src/backend/dist/backend.wasm` (+ `backend.did`) and has already
booted the wasm on PocketIC (`check-deploy`). The install mode used here is
**fresh install** — the migration chain initializes state from the empty
actor. Upgrading an already-deployed canister is a different procedure.

## 1. Identity (never stored in the repo or the image)

The identity is the principal that owns the canister: it pays, it controls
upgrades, and losing it loses the canister. Create a dedicated one rather
than reusing a personal key:

```bash
docker compose run --rm -it toolchain bash
dfx identity new studyforge-deploy      # prints a seed phrase — store it offline
dfx identity use studyforge-deploy
dfx identity get-principal
```

Alternative for a key you already hold outside dfx:

```bash
dfx identity import studyforge-deploy --pem-file /repo/deploy.pem
dfx identity use studyforge-deploy
```

The container is ephemeral: identities live in the container's `$HOME`, so
import (or re-create) per deploy run. Never commit a PEM or seed phrase.

## 2. Cycles

A fresh canister needs a one-time creation charge plus ongoing compute and
storage burn; a realistic starting balance is **5–10 T cycles** (a few ICP
worth). The identity needs ICP on its ledger account — send a small amount
to `dfx identity get-principal`'s account — and dfx converts on create. If
`dfx canister create` answers with a shortfall, fund more and re-run; it
names what it needs.

Check what you have:

```bash
dfx identity get-principal     # the account ICP goes to
dfx canister info --network ic <canister-id>   # cycles balance, post-deploy
```

## 3. Deploy

```bash
docker compose run --rm toolchain bash scripts/deploy-mainnet.sh          # preflight only
docker compose run --rm toolchain bash scripts/deploy-mainnet.sh --yes    # create + install
```

The script refuses to run without an identity, prints the wasm sha256 it is
installing, and ends with a smoke call — `getDashboardStats` answering
zeroed stats is the expected fresh-install response.

## 4. Wiring the frontend (a canister-mode preview, not a production cutover)

Production runs on Supabase and keeps running there: the canister starts
**empty**, so pointing the production site at it would move users to a blank
backend. Ship canister mode as a separate deployment first.

1. Fill `src/frontend/env.json` (all fields, from the deploy output):

   ```json
   {
     "backend_host": "https://icp0.io",
     "backend_canister_id": "<canister id from step 3>",
     "project_id": "studyforge",
     "ii_derivation_origin": "undefined",
     "storage_gateway_url": "undefined"
   }
   ```

   `backend_host` may also stay `undefined` — agent-js then defaults to
   `icp0.io` itself; setting it makes the choice visible. Internet Identity
   already defaults to the mainnet II canister (`rdmx6-jaaaa-…`) and
   `https://id.ai/authorize`; leave `ii_derivation_origin` unset unless II
   rejects the sign-in origin, then consult the II derivation-origin rules.

2. In the new deployment's environment (Vercel project or build env), set
   `VITE_DATA_BACKEND=canister` and `CANISTER_ID_BACKEND=<canister id>`.
   The data-backend selector runs at build time (`lib/supabase/env.ts`), so
   these are build inputs, not runtime flags.

3. The CSP already allows the boundary nodes: `https://icp0.io` is in
   `connect-src` (`lib/security/contentSecurityPolicy.ts`, pinned by
   `contentSecurityPolicy.test.ts`). Rebuild so the shipped tag carries it.

4. Verify: sign in with Internet Identity on the preview deployment, create
   a class, and confirm `dfx canister call backend listClasses --network ic
   --identity studyforge-deploy` sees it — the same principal must be the
   caller, which the preview's II sign-in provides.

## 5. Optional cutover (later, user's decision)

The archive importer (`lib/archiveImport.ts`) runs against the canister too:
export the account's data from the Supabase app, sign in on the canister
deployment, import. Sessions/results are deliberately not replayed — the
importer's report names what moved. Only after that rehearsal does switching
the production deployment's `VITE_DATA_BACKEND` make sense.

## 6. Operations

- **Upgrade** (after a source change): run the backend lane against the
  upgrade pair first, then `dfx canister install backend --network ic
  --mode upgrade`. `mops check` compares the new interface against a
  `.most` snapshot — take one from the currently deployed wasm so the
  upgrade-compare is against reality, not the empty-actor baseline.
- **Status**: `dfx canister status backend --network ic` (cycles, memory,
  controllers).
- **Controllers**: the deploy identity is the controller. Add a second
  controller (`dfx canister update-settings --add-controller …`) once a
  backup identity exists — a single-controller canister is a key-loss risk.
