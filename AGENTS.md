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

### Three backends, one flag

`src/frontend/src/lib/authMode.ts` reads `VITE_DATA_BACKEND` (through `selectDataBackend()` in `lib/supabase/env.ts`, which still honours the older `VITE_USE_MOCK`) and exports the four values every consumer keys off: `DATA_BACKEND`, `USE_LOCAL_ACCOUNTS`, `USE_SUPABASE`, `SHARED_BACKEND`. `useBackend` and `useAuth` each pick one implementation at module load, so no component branches at render time.

- `mock` — the localStorage backend plus the local email/password accounts in `lib/localAuth.ts`.
- `supabase` — `lib/supabase/supabaseBackend.ts` plus Supabase's own email/password session (`lib/supabase/session.ts`). Internet Identity cannot federate here: the project exposes no OAuth2/OIDC endpoint, discovery document or JWKS, so there is nothing for Supabase to trust.
- anything else — the canister plus Internet Identity.

The adapter is loaded through `import.meta.glob` and `session.ts` imports the client as a type only, which is what keeps `@supabase/supabase-js` out of the bundle the other two modes ship (index 3.48 MB, supabase-js only in `supabaseBackend-*.js`). Do not undo either seam to save a line.

Because `src/frontend/env.json` is committed with `"undefined"` placeholders, a real Internet Identity sign-in cannot be completed on this machine: `loadConfig()` fails and the sign-in screen reports `CANISTER_ID_BACKEND is not set`. Treat Internet Identity changes as typecheck- and unit-verified only.

### Frontend tests

- Run them with `pnpm test` (`vitest run --environment jsdom`). Calling `pnpm vitest run <file>` directly drops the jsdom flag and `src/test/setup.ts` fails with `window is not defined`.
- `src/frontend/.env.local` reaches `import.meta.env` in **every** mode, tests included, so a `VITE_DATA_BACKEND` written for the dev server silently moves the whole suite off the injected-actor seam. `vitest.config.ts` pins both flags empty; keep that assignment.
- Leaving the mode unset keeps `useBackend` on the `createActorWithConfig`/`useActor` seam that `src/test/setup.ts` mocks, which is how tests inject a fake actor with `setMockActor`.
- A test that needs a mode pins `@/lib/authMode` with **all four** exports (`DATA_BACKEND`, `SHARED_BACKEND`, `USE_LOCAL_ACCOUNTS`, `USE_SUPABASE`) — vitest rejects the mock as soon as a consumer imports a key the pin omits. Local accounts then use `setLocalAccount(...)`; Internet Identity tests use `setMockAuth(createAuthState({ ... }))`.
- A test that reads repo files must build paths from `process.cwd()`: under jsdom `import.meta.url` is an http URL and `fileURLToPath` throws "The URL must be of scheme file".

### An archive moves in by the front door

`src/lib/archiveImport.ts` restores an exported file (or this browser's own localStorage archive, read by `lib/browserArchive.ts` without loading the mock) by calling the same contract the pages call. Nothing is added to `backendInterface` for it, which is the point: the importer runs against Postgres, the canister or the mock, and `tsc` proves it.

- Rows are created in dependency order and children are looked up through archive-id → new-id maps, so nothing references a row that no longer exists. A row whose parent is missing is recorded in `report.failures` and the import keeps going.
- Re-running is safe for the hierarchy, questions, notes and settings (matched by name under the same parent, counted as `skipped`). **Links are the exception**: a link is addressed only by its secret edit token, an export never carries that, and there is no list method, so a repeat run publishes the URL again. The UI says so rather than hiding it.
- Sessions, results and activity are deliberately not replayed. `start_session` stamps `now()` server-side, so a restored history would move every past attempt to today — the report names the counts instead.
- The mock's export writes row shapes and the adapter writes view shapes; both use the same field names, which is why `parseArchive` accepts either. The mock stores ids as numbers and the adapter as bigints, hence `idKey`.
- `studyforge.mock-backend.v1` is intentionally absent from `deviceCache.ts`: "Clear local data" must not erase the only copy a user has.

### AI Studio runs in the browser, not the canister

`src/frontend/src/lib/ai/` + `src/hooks/useAi*` do the whole extraction: read the document (`lib/ai/document.ts`, pdf.js loaded from a CDN so no dependency is added), call the reviewer's own Gemini or OpenRouter key or a local Ollama model (`lib/ai/providers.ts`), or parse the text by rule when neither is set up (`lib/ai/questions.ts`).

- The catalogue is exactly three providers: **Google Gemini** (a fixed list of its current Flash models, ordered by what answers rather than by release date — `gemini-3.8-flash` is newest but sits at the end because it has been returning "high demand" for weeks), **OpenRouter** (every model its `GET /api/v1/models` reply currently serves for free, i.e. ids ending in `:free`), and **Ollama** (the models its local `GET /api/tags` reports; it stores no key). OpenAI is not offered — its canister-side mixins are still in the repo, unused.
- Live lists are fetched in the dialog, cached for ten minutes, and fall back to the seeded list plus an error line when the fetch fails. A chosen model is stored once in `studyforge.ai.model` as a JSON record keyed by provider id; a provider nobody chose keeps its `defaultModel`.
- Ollama is only used when it is explicitly chosen — with nothing configured the studio parses offline rather than reaching for `http://localhost:11434`, which is usually not running on this machine.
- The canister still exposes `getAiConfig`/`saveAiKey`/`generateDrafts`/`acceptDraft` and `src/mocks/backend.ts` still implements them, but **nothing in the frontend calls them**. Do not wire new UI back to those methods — they cannot run on this machine, which is why the old studio appeared broken.
- Provider keys, the model choice and the review queue are device-local: `studyforge.ai.provider`, `studyforge.ai.model`, `studyforge.ai.*_key`, and the `studyforge.ai-studio` prefix (the persisted queue). `src/lib/deviceCache.ts` lists all of them, so "Clear local data" erases the keys and the queue without touching account content.
- There is no `/ai-settings` route any more; the engine and key chooser is the dialog opened from the AI Studio page.

#### What the providers actually do (measured against the live services)

A request is only worth repeating when the failure is temporary, so `callProvider` classifies every failure itself:

- Google's newest Flash model answers **HTTP 503 "This model is currently experiencing high demand"**, and sometimes **HTTP 200 with a zero-byte body** (which makes `response.json()` throw — hence `readJson`, which turns any unparseable success body into a retryable failure). Both look like "the key does nothing" from the UI.
- So a model is asked **twice** (0.5 s, then 1.5 s apart) and then stepped over, up to three models per run. The model that answered is written back onto `active`, so the remaining pages of one run stay on it instead of rediscovering the same traffic jam. `ExtractionOutcome.model` names a fallback and the toast says so.
- Every request carries a **60 s `AbortSignal.timeout`**, and a `TimeoutError`/`AbortError` is classified as retryable (`networkError`). Before this, one stalled page held the whole run open — that is what made a PDF take twenty minutes rather than the model being slow.
- A **400 whose message mentions the key** is a refused key: Google answers an invalid key with 400 "API key not valid", not 401. Do not classify failures on the status code alone — `KEY_REFUSED` exists for this. A refused key is never retried and its message names the provider's `keyPage`. OpenRouter keys can also come back as **401 "API key expired."**, which no code change can fix.
- OpenRouter's free models advertise `structured_outputs` but **reject `response_format`**, so only Ollama is sent `jsonMode`; the prompt already demands raw JSON and `parseModelResponse` repairs the rest.
- To exercise the model path without a key, run a stub server on `http://localhost:11434` answering `/api/tags` and `/v1/chat/completions` and choose Ollama in the dialog — that drives the real browser code end to end. It has to answer **`OPTIONS` with CORS headers** (the chat call sends `Content-Type: application/json`, so the browser preflights it and a missing preflight reply looks like "could not reach the local server"), and it has to listen for `localhost`, which on this machine means `::1` — bind `HOST=::`.

#### How a run is split up

`extract.ts` never sends a whole document in one request any more — that was the other half of the twenty-minute wait, and a model answering 36 k characters at once drops questions as well as taking minutes.

- `buildUnits` cuts the source into units: one per rasterised page, or one per ≤7 000-character page-packed chunk of a text PDF (`splitByPageMarkers` reads back the `--- Page N ---` lines `document.ts` writes; `splitByLength` falls back to paragraph boundaries for pasted text).
- The **first unit runs alone**, so the busy-model walk in `callProvider` locks onto a working model before the fan-out; the rest run **five at a time** (`PAGE_CONCURRENCY`) through a cursor shared by worker loops. A unit that fails stops the workers asking for more.
- Results are collected **by unit index**, so the queue stays in page order however the replies land, and `dedupe` runs once at the end.
- `MAX_TEXT_CHARACTERS` is now 200 000 (it only bounds how much of a huge PDF is read at all, since no request sees all of it) and `MAX_VISION_PAGES` is 40, rasterised three at a time.
- A unit that came from exactly one page overwrites `draft.page` with it — the model's own `sourcePage` is not trusted for page labels.

#### When a run comes back short

Measured live against a real key: Google answers an exhausted free-tier quota with **HTTP 429 "You exceeded your current quota"**, the run walks past it into other models and can still finish (one run produced 159 drafts from the same paper a truncated run gave 53 for), but pages it never read are genuinely missing.

- `ExtractionOutcome.missing` lists the page numbers whose unit never answered, so the loss is named rather than counted; `skipped` stays the section count (packed multi-page units count there but cannot name a page).
- The queue header keeps a standing line — "page 6, 9–11 not read — extract again to fetch them" — because a toast fades and a short queue stays short.
- **A retry merges.** `useAiExtraction` calls `mergeDrafts` when the run lost sections and the queue is from the same file, so "extract again" adds the pages that were missing instead of discarding the pages that came through; a complete run still replaces the queue. Merging is keyed on `draftKey` (the whole visible shape, also used by `dedupe`) and keeps page order.

### Local storage can fail silently

`src/lib/localStore.ts` is the only place guarded writes happen (`safeSetItem`/`safeGetItem`/`safeRemoveItem`), because a `setItem` that throws is otherwise swallowed and the app goes on promising to remember. It keeps a small frozen list of problems (`quota` | `blocked` | `corrupt`) that `components/layout/StorageHealthBanner.tsx` renders above the routed page via `useSyncExternalStore`.

- The mock backend cannot lose an archive to a bad read: `archiveUnreadable` copies the unreadable bytes to `studyforge.mock-backend.v1.corrupt.0..2` before booting empty, so a corrupt store is recoverable instead of being overwritten by the first write.
- Cross-tab id collisions are handled by `adoptForeignNextId` on the `storage` event.
- "Clear local data" in Settings erases these keys, so it erases provider keys, the review queue and the account session along with the archive.

#### The key dialog

`ProviderDialog` keeps **one key draft per provider** and resets them only on the closed-to-open transition (a `useRef` guard, because `providers.active` is a fresh object after every `refresh()` and a plain `[open, providers.active]` effect wiped a key while it was being typed — the reason keys appeared to "not save"). Pressing **Save key** stores the draft without closing; **Use {provider}** is enabled whenever a saved key already exists, so a configured provider never requires retyping.

### TanStack search params

`?topic=6` is parsed as the **number** `6`, so a validator written as `typeof search.topic === "string" ? … : undefined` silently drops the param and the router strips it from the URL. `src/router.tsx`'s AI Studio route accepts string or number and widens to string; keep new search validators doing the same. Note also that after `router.load()` a test sees the raw parsed search, not the validated one, so assert validated values via `router.navigate`.


