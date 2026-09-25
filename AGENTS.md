# Project Guidance

## User Preferences

[No preferences yet]

## Verified Commands

**Frontend** (run from `src/frontend/`):

- **install**: `pnpm install --prefer-offline`
- **typecheck**: `pnpm typecheck`
- **lint fix**: `pnpm fix`
- **build**: `pnpm build`

**Backend** (run from `src/backend/`; see Learnings — these need `mops`, which does not run on the development machine used for this project):

- **install**: `mops install`
- **typecheck**: `mops check --fix`
- **build**: `mops build`

**Backend and frontend integration** (run from root):

- **generate bindings**: `pnpm bindgen` This step is necessary to ensure the frontend can call the backend methods.

## Head Metadata (SEO and Link Previews)

`src/frontend/index.html` ships with social-sharing meta tags (`description`, `og:title`, `og:description`, `og:type`, `og:image`, `og:image:alt`, `twitter:card`, `twitter:image`). Links shared to this app only render a preview card if these tags are present in the deployed `index.html`.

When editing `index.html` (e.g. changing the title or favicon):

- **Never remove these meta tags.** Update them instead.
- Keep `og:title` identical to `<title>`, and `og:description` identical to the `description` meta tag.
- `og:image` and `twitter:image` must always point to an absolute `https://` URL. Keep the pre-configured default image unless the user explicitly provides or requests a custom share image; a custom image should be 1200×630 pixels.

## Learnings

### Running the app without a replica

The development machine has no virtualization (no WSL2, Docker, or Hyper-V), so `dfx`, `mops`, and the Rust toolchain cannot be installed and no local replica can be started. Consequences:

- The `mops` commands above are the correct commands for a machine that has the platform toolchain; on this machine they fail with "command not found". Do not spend time trying to make them run.
- `src/backend/dist/backend.wasm` is a pre-built artifact that ships in the repo. Motoko edits under `src/backend/` can be reviewed and reasoned about here, but they cannot be typechecked or compiled locally, and they do not reach the running app.
- `pnpm bindgen` likewise needs the platform toolchain. The committed bindings in `src/frontend/src/backend.ts` are the contract the frontend builds against.
- **What to do instead**: run the frontend against the localStorage mock backend (`src/frontend/src/mocks/backend.ts`), which implements the full 77-method canister interface. `pnpm dev` already does this because `.env.development` sets `VITE_USE_MOCK=true`. Data persists in the browser under the `studyforge.mock-backend.v1` key. Production builds (`pnpm build`) do not set the flag, so deployed output still targets the real canister.

### Authentication is chosen by the same flag

`src/frontend/src/lib/authMode.ts` exports `USE_LOCAL_ACCOUNTS = import.meta.env.VITE_USE_MOCK === "true"`, and it is the only reader of that flag: with the mock backend the app uses the local email/password accounts (`src/lib/localAuth.ts`), against a real canister it uses Internet Identity. `useAuth` and `useBackend` each pick one implementation at module load, so no component branches at render time.

Because `src/frontend/env.json` is committed with `"undefined"` placeholders, a real Internet Identity sign-in cannot be completed on this machine: `loadConfig()` fails and the sign-in screen reports `CANISTER_ID_BACKEND is not set`. Treat Internet Identity changes as typecheck- and unit-verified only.

### Frontend tests

- Run them with `pnpm test` (`vitest run --environment jsdom`). Calling `pnpm vitest run <file>` directly drops the jsdom flag and `src/test/setup.ts` fails with `window is not defined`.
- Do not set `VITE_USE_MOCK` for tests. Leaving it unset keeps `useBackend` on the `createActorWithConfig`/`useActor` seam that `src/test/setup.ts` mocks, which is how tests inject a fake actor with `setMockActor`.
- A test that needs local accounts pins the mode itself: `vi.mock("@/lib/authMode", () => ({ USE_LOCAL_ACCOUNTS: true }))`, then `setLocalAccount(...)`. Internet Identity tests use `setMockAuth(createAuthState({ ... }))`, which now carries an `identity` stub alongside its flags.

