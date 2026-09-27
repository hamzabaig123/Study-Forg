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

### Security headers travel as a `<meta>`, and only in the build

`caffeine.toml` describes an asset build (`pnpm build` → `dist`) with no header configuration surface, so the Content-Security-Policy is stamped into the built `index.html` by the `securityPolicy()` plugin in `src/frontend/vite.config.js`, from `src/lib/security/contentSecurityPolicy.ts`.

- The policy is **build-only on purpose**. A dev server needs an inline script for the React refresh preamble and a WebSocket for HMR, so applying it in dev breaks the dev server. Verify it with `pnpm build` and `pnpm exec vite preview`, never `pnpm dev`.
- **`index.html` must not gain an inline `<script>`.** The policy grants scripts no `'unsafe-inline'`; that is why the theme bootstrap is `public/theme-bootstrap.js` loaded by `<script src>` instead of a block in the head. Re-inlining it produces a dark-mode flash and a console refusal, not a build error.
- Every origin the browser itself talks to has to be listed: the Supabase project (exact origin, read from `loadEnv` at build time), Gemini, OpenRouter, EmailJS, the pdf.js CDN, a local Ollama and Vercel Speed Insights (`va.vercel-scripts.com` in `script-src` and `connect-src`, `vitals.vercel-insights.com` in `connect-src`; the package injects its own `<script>` tag, so `script-src` had to grow). Adding a new outbound call in `src/lib` means adding its origin there, or it fails as a CSP violation that looks like a network error. In a production build the package loads `/_vercel/speed-insights/script.js` — same-origin, which `'self'` already covers — but the third-party origins are what a debug/development build reaches for, and the rewrite below must not swallow that path.
- `style-src 'unsafe-inline'` is required (inline `style` attributes, recharts' injected `<style>`), and `img-src` needs `data: blob:` (QR preview, PDF/export previews).
- A meta cannot carry `frame-ancestors`, `Strict-Transport-Security` or `X-Content-Type-Options`, so the tag alone is not a complete policy and must not be described as one. `securityHeaders()` in the same module emits those — plus the identical CSP with `frame-ancestors 'none'` — and the plugin's `closeBundle` writes it to `dist/_headers`, the filename Cloudflare Pages and Netlify read. Generating it is the point: the header policy and the meta policy come from one function, and the test asserts the header string *is* the meta string plus `frame-ancestors`. It is a build artifact, not a committed file, and it stays inert until a host that reads it serves `dist` — deploying on a host with no header surface still leaves clickjacking open.
- `Permissions-Policy` in that file deliberately refuses only camera/microphone/geolocation/payment/usb/bluetooth. Naming `clipboard-write`, `notifications` or `display-capture` there would break the share flow's auto-copy and the reminder scheduler with no build error to point at; `contentSecurityPolicy.test.ts` fails if someone adds them.

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
- `src/frontend/.env.local` reaches `import.meta.env` in **every** mode, tests included, so a value written for the dev server silently moves the whole suite off the injected-actor seam. Either half of it can do this: `VITE_DATA_BACKEND=mock` puts the localStorage object in front of every page test, and a *complete* `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` pair selects the Supabase adapter, after which every page test fails with "There is no Supabase session". `vitest.config.ts` pins **all four** empty; keep that assignment (this bit the suite for real once a live key was pasted).
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
- Provider keys default to **`sessionStorage`** — gone when the tab closes — and reach `localStorage` only when the reviewer ticks "Keep on this device" in the dialog, which is the honest name for accepting a plaintext key that every script on this origin can read. `saveKey(id, key, persist)` returns where it actually landed (`"session" | "device" | "none"`) and refuses the device store when `isSecureContext` is false; `keyPersistence(id)` reports the same, which is what the dialog opens with. Whichever store takes a key, the other copy of that provider is cleared, so a replaced or removed key cannot resurface from the second store. The model choice and the review queue are still device-local: `studyforge.ai.provider`, `studyforge.ai.model`, `studyforge.ai.*_key`, and the `studyforge.ai-studio` prefix (the persisted queue). `src/lib/deviceCache.ts` lists all of them and clears **both stores**, so "Clear local data" really does erase the keys and the queue without touching account content.
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



### The test builder, custom sessions, and merged analytics

The backend session contract is fixed (`startSession` takes one `topic`/`chapter` scope; questions come back in creation order; practice ignores `questionCount`), and `pnpm bindgen` cannot run on this machine — so **no new backend methods were added**. Custom tests are a frontend engine instead:

- `src/lib/sessionEngine.ts` gathers questions across **any mix of subjects/chapters/topics** (`gatherPool` fan-outs `listQuestions` per topic and dedupes), shuffles questions and MC options (`displayOptions` shuffles by option id, so grading is unaffected), and cuts to the chosen count. `isCorrectAnswer` mirrors the canister's grading rule-for-rule.
- Custom sessions live in `src/lib/localSessions.ts` under `studyforge.custom-sessions.v1` (guarded writes, cross-tab `storage` refresh, capped at 100 completed). **The list getters return cached array references** — `useSyncExternalStore` compares snapshots with `Object.is`, and a fresh array per call loops React into "Maximum update depth exceeded" (this broke every RequireAuth test once). Never return a new array from a snapshot getter.
- `/test-builder` (`pages/TestBuilder.tsx`) is the builder; `/custom-test/$id` runs the session (practice grades per question via `isCorrectAnswer`, timed runs `CountdownTimer` and auto-finishes, rejoining an expired test finishes it); `/custom-results/$id` renders the result. Results pages also accept backend ids — `pages/SessionResults.tsx` (backend) and `pages/CustomResults.tsx` (local) share `components/session/ScoreSummary.tsx`.
- The dashboard's **Accuracy + Day streak** hero (`components/insights/ProgressHero.tsx`) and the Analytics page are computed over **merged history**: `hooks/useStudyProgress.ts` folds backend `getAttemptHistory()` rows and completed local sessions into one list (`useStudyProgress`) and into the accuracy buckets (`useMergedBreakdown`; local tests carry class/subject labels captured at build time). Streak/accuracy math lives in `src/lib/progress.ts` (`computeStreak` counts a day when any attempt completed; a streak stays alive through today-if-yesterday-counts).
- Topic/Chapter page "Practice"/"Timed test" buttons now link into `/test-builder?topic=…|chapter=…&mode=practice|timed` (preselect, no fixed 10-minute launch). `/share` accepts the same preselect params.

### Daily email reminder + analytics report

A browser app cannot send mail, so `src/lib/reminders.ts` rides the user's own free **EmailJS** account (service/template/public key stored device-local, erased by "Clear local data"; without them the digest is a browser **Notification** instead). A scheduler (`startReminderScheduler`, mounted from `AppLayout` via `useReminderScheduler`) ticks once a minute and fires once per local day at the configured time — only while the app is open, which the Settings UI says plainly. The digest copy (`buildDigest`) reads live progress through `hooks/useReminders.ts`. Settings → **Reminders** (`components/settings/RemindersSection.tsx`) is the config surface. `studyforge.reminders.v1` is in `deviceCache.ts` EXACT_KEYS; `studyforge.custom-sessions.v1` is deliberately **not** (attempt history is account content, like the mock db).

### The exported PDF is designed

`src/lib/questionExport.ts` writes a real document: brand band + title header on page 1, Helvetica (base-14, never embedded) with AFM-measured line wrapping, numbered ember chips per question, hairline rules, footer with page numbers, and a **separated two-column answer key** with explanations. Everything is folded to ASCII in `toWinAnsi` (NFD + `\p{M}` strip + punctuation map) because `ExportFile.content` is a string the caller wraps in a Blob — any code point above 127 becomes UTF-8 bytes, shifts the xref offsets, and corrupts the file. Keep it ASCII-exact. Verify visual changes by generating a sample and rasterising with pdf.js in headless Edge.

### `.env.local` currently selects the Supabase backend

`src/frontend/.env.local` sets `VITE_DATA_BACKEND=supabase` (it wins over `.env.development` in every mode) and holds a **real** project URL and publishable key. Verified against the live project on 2026-09-27: `GET /auth/v1/health` answers (GoTrue v2.197.0), and a password grant for a nonexistent address comes back as `invalid_credentials` rather than a key refusal, so the key works. **The schema is now applied** — 18 tables, RLS forced, 33 public functions — and the app reads and writes real rows (dashboard stats, `class_rows`, an INSERT into `class` + `activity` from the UI returning 201, all owned by `auth.uid()`).

How it got applied, because the documented route failed: `apply-migration.mjs` needs a Management API token and the one tried returned **401 on `/v1/projects` and on `/v1/projects/<ref>/database/query`**, i.e. a well-formed `sbp_` token that authenticates nobody. What works from this machine instead is a direct Postgres session through **`aws-0-ap-northeast-1.pooler.supabase.com:5432`** with user `postgres.qjoijoxmnliarlyaqmoz` and the database password, driven by `pg` — not a dependency of this project, so it goes in a scratch folder outside the repo (`npm install pg` in a temp directory resolves from the local cache) and `NODE_PATH` points at it. Note that `db.<ref>.supabase.co:5432` **does not resolve** here, so the pooler is the only reachable host, and the region in that hostname must match the project or Supabase answers `tenant/user ... not found`.

A selected-but-unconfigured project is a **setup screen, not a crash**: `main.tsx` renders `components/common/BackendNotConfigured.tsx` instead of the app when `DATA_BACKEND === "supabase" && !SUPABASE_CONFIGURED`, so nobody debugs a white page. For mock-backend work run `VITE_DATA_BACKEND=mock pnpm dev` (process env beats .env files). The full integration state lives in `supabase/README.md`: the adapter implements all 77 methods (12 typed stubs/refusals, documented in `lib/supabase/system.ts`), and the schema is `supabase/migrations/0001_init.sql` (18 tables, RLS, 32 functions) plus `0002_rate_limits.sql` (per-IP throttle, `custom_session`) and `0003_short_code_entropy.sql` (widens `link.code` to `{7,12}` and re-declares `create_link` so it still validates the widened range, calling `enforce_rate_limit` only when 0002 installed it — **0003 must run after 0002**, because 0002 carries its own copy of `create_link` that still validates exactly 7 characters and whichever migration runs last owns that function). All three are read by the drift guard `lib/supabase/sqlSurface.contract.test.ts`, which now also pins short-code entropy: the effective regex **per declarer across every migration** (not "whatever the newest file says", because 0004 legitimately re-declares `create_link` without re-declaring the table CHECK), `SHORT_CODE_ALPHABET`/`SHORT_CODE_LENGTH` in `lib/supabase/tokens.ts`, and the mock's generator must agree and clear 48 bits, so a code the public `/r/:code` endpoint is addressed by cannot quietly go back to 7 characters. A fourth file, `0004_correctness.sql`, fixes nine *behaviour* bugs rather than shape: `for update` locks in `complete_session`/`update_note` (a double-tap used to write two results, and a stale-revision save used to overwrite a newer one), cast-free `trueFalse` grading, the `duration_seconds` bound `start_session` never checked, `resolve_link` storing a browser locale (`es-419`) as a country, `create_link`/`resolve_link` answering a throttle or a collision with the reason the UI already has copy for, `enforce_rate_limit` handed back to `authenticated` by 0002's blanket grant, and the five indexes the list pages needed. It **refuses instead of repairing**: a `do $$` block counts the offending rows and raises rather than creating a unique index or a CHECK over data that already breaks it, so `verify.sql` check 10 is the dry run. Order still matters once: 0002 must come first, because 0004 step 8 is the revoke that 0002's blanket grant undoes.

### Narrow screens: what actually overflows

Verified live at 259–1440 CSS px (the automation window is ~269, and offscreen iframes give the other widths). Three findings that no static read of the code predicts:

- A `grid` with no base `grid-cols-*` sizes its implicit track to **min-content**, so one unwrappable child widens the whole column and the page scrolls sideways. The children that do this are `whitespace-nowrap` labels — `SelectTrigger` in particular. `sm:grid-cols-2` already emits `repeat(2,minmax(0,1fr))`, so only the mobile track is exposed.
- shadcn's `*:data-[slot=select-value]:line-clamp-1` / `:flex` variants on `SelectTrigger` compile to `.selector[data-slot="select-value"] > *`, which matches **nothing** in this build, and props passed to `SelectValue` do not reach the rendered node. So a long option label cannot be clipped from CSS — shorten the label instead (`QrGenerator` hides "· recommended" below `sm`; Radix mirrors the item's children into the trigger, so responsive classes inside a label work).
- The header row cannot fit toggle + wordmark + theme pill + account pill at 320 px: the account text squeezed the brand wordmark to **0 px** while the icon overflowed its own box. Below `sm` the account pill is now icon-only with an `sr-only` "Account menu" name (`display:none` text contributes no accessible name, so the label is required).

`Input` already carries `min-w-0`, so colour-swatch-plus-field rows shrink correctly; button rows do not — `flex items-center gap-3` holding "Next" + "Finish & see results" needs `flex-wrap` (`CustomTest`, `TimedTest`, `PracticeSession`, `ManageLink`).

### Applying the migration without psql

`supabase/e2e/apply-migration.mjs` reaches the project's database over HTTPS through the Supabase Management API (`POST /v1/projects/<ref>/database/query`), so the schema, the seven `verify.sql` assertions and `tests/rls_cross_tenant.sql` all run on this machine — the only credential it needs is a **personal access token** in the environment (`SUPABASE_ACCESS_TOKEN`, plus `SUPABASE_PROJECT_REF`; `--dry-run` and `--project <ref>` are supported). It is idempotent (checks `to_regclass('public.question')` first), exits 2 for a credential/project problem vs 1 for a failed check, and a failed count prints the rows behind it. Nothing here belongs in a file: the token administers every project on the account, so it is passed per run and `supabase/.env` deliberately does not list it.

Windows gotcha for any `.mjs` that fetches: `process.exit()` while an undici socket is still open crashes with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` **after** printing nothing useful. Set `process.exitCode` and let the loop drain (0.8 s in practice).
