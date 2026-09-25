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

### AI Studio runs in the browser, not the canister

`src/frontend/src/lib/ai/` + `src/hooks/useAi*` do the whole extraction: read the document (`lib/ai/document.ts`, pdf.js loaded from a CDN so no dependency is added), call the reviewer's own Gemini or OpenRouter key or a local Ollama model (`lib/ai/providers.ts`), or parse the text by rule when neither is set up (`lib/ai/questions.ts`).

- The catalogue is exactly three providers: **Google Gemini** (a fixed list of its current Flash models, newest first), **OpenRouter** (every model its `GET /api/v1/models` reply currently serves for free, i.e. ids ending in `:free`), and **Ollama** (the models its local `GET /api/tags` reports; it stores no key). OpenAI is not offered — its canister-side mixins are still in the repo, unused.
- Live lists are fetched in the dialog, cached for ten minutes, and fall back to the seeded list plus an error line when the fetch fails. A chosen model is stored once in `studyforge.ai.model` as a JSON record keyed by provider id; a provider nobody chose keeps its `defaultModel`.
- Ollama is only used when it is explicitly chosen — with nothing configured the studio parses offline rather than reaching for `http://localhost:11434`, which is usually not running on this machine.
- The canister still exposes `getAiConfig`/`saveAiKey`/`generateDrafts`/`acceptDraft` and `src/mocks/backend.ts` still implements them, but **nothing in the frontend calls them**. Do not wire new UI back to those methods — they cannot run on this machine, which is why the old studio appeared broken.
- Provider keys, the model choice and the review queue are device-local: `studyforge.ai.provider`, `studyforge.ai.model`, `studyforge.ai.*_key`, and the `studyforge.ai-studio` prefix (the persisted queue). `src/lib/deviceCache.ts` lists all of them, so "Clear local data" erases the keys and the queue without touching account content.
- There is no `/ai-settings` route any more; the engine and key chooser is the dialog opened from the AI Studio page.

### TanStack search params

`?topic=6` is parsed as the **number** `6`, so a validator written as `typeof search.topic === "string" ? … : undefined` silently drops the param and the router strips it from the URL. `src/router.tsx`'s AI Studio route accepts string or number and widens to string; keep new search validators doing the same. Note also that after `router.load()` a test sees the raw parsed search, not the validated one, so assert validated values via `router.navigate`.


