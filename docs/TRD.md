# StudyForge — Technical Requirements Document

*Version 1.0 · 2026-09-29. Companion to `docs/PRD.md`. Every "must" below is
currently implemented and verified; the architecture section describes the
system as it runs today, not a plan.*

## 1. Architecture

```
React 19 SPA (Vite, TanStack Router + Query v5)  ── deployed on Vercel
  │  one data seam: hooks/useBackend picks an implementation at module load
  ├── "supabase"  → lib/supabase adapter (all 77 methods)  → Supabase
  │                                             Postgres + RLS + Edge Functions
  ├── "mock"      → localStorage backend (full 77-method emulation) — dev/tests
  └── "canister"  → generated Candid actor → Motoko canister (Internet Computer)
                    + Internet Identity
```

- One flag (`VITE_DATA_BACKEND`) selects the backend; no component branches at
  render time. The adapter is loaded through `import.meta.glob`, and the
  Supabase client is imported as a type in `session.ts`, keeping supabase-js
  out of the bundles the other two modes ship.
- The Motoko canister (`src/backend`, `moc 1.16.0`, persistent actor) holds the
  original domain logic; the Supabase adapter mirrors its 77-method contract so
  the frontend is identical against either. CI compiles it (`.github/workflows/
  canister-build.yml`: ic-mops, `moc 1.16.0` per `mops.toml`).
- Three Edge Functions (`reminder-sender`, `ai-proxy`, `csp-collector`), each
  self-contained (imports nothing, carries its own CORS helper), deployed via
  the CLI's `--use-api` route; the collector with `--no-verify-jwt`.

## 2. Technical requirements

### 2.1 Security (all enforced today)

| Requirement | Implementation |
| --- | --- |
| Tenant isolation | RLS forced on all 22 tables; every owner row keyed on `auth.uid()`; `owner_is_verified()` refuses unconfirmed accounts before any row access |
| Anonymous lockout | `anon` holds SELECT/INSERT nowhere except by public RPC; TRUNCATE/TRIGGER/MAINTAIN revoked from client roles **and** default privileges |
| Honest rate limiting | `enforce_rate_limit` buckets on `cf-connecting-ip` (the one address a client cannot forge), falling back to rightmost non-empty `X-Forwarded-For` → `x-real-ip` → `unknown`; ceilings: 20/min link creation, 20/min abuse report, 60/min resolve, 120/min shared content, 20/min per-account AI proxy |
| Password floor | 10 characters, one constant (`passwordPolicy.ts`) shared by mock auth, the Supabase session and every form input; pinned against the live project's GoTrue config |
| Content-Security-Policy | One module emits the `<meta>` policy, the header policy (`frame-ancestors 'none'`, HSTS, `X-Frame-Options`, COOP, nosniff, Referrer-Policy, a Permissions-Policy deliberately silent on clipboard/notifications) and `vercel.json`'s `headers`; violations report to the deployed `csp-collector` (anonymous, bounds-only: 32 KiB body, 20 reports, 512-char fields, `204` always) |
| Edge Function hardening | Chunked body caps enforced while reading (413 at 16/8 KiB), timing-safe secret comparison (XOR-accumulate), database-backed rate limiting that fails open, Origin allow-list refusal before any token is resolved |
| Captcha seam | Cloudflare Turnstile, env-gated and fail-closed: no site key means no widget and byte-identical requests; the project switch gates sign-up, sign-in, re-send and reset |

### 2.2 Performance

- 22 of 25 routes lazy-loaded (`lazyPage`); entry chunk 939 KB raw / **289 KB
  gzip**; recharts and the Motion feature set in separate lazy chunks.
- Measured baselines (deployed origin): Lighthouse 68/93/100/100, FCP 3.8 →
  **2.9 s** and Speed Index 7.7 → **2.9 s** on the current build, CLS 0.002.
- Themed boot shell in `index.html` paints before the bundle; React replaces it
  on mount.
- The CSP is build-only on purpose (dev needs the HMR socket) and every origin
  the browser talks to must be added to `contentSecurityPolicy.ts` or the call
  fails as a violation.

### 2.3 Correctness guards (offline, run in the suite)

- **Drift guards**: `sqlSurface.contract.test.ts` reads every migration and
  fails on a re-declared limiter keyed on the leftmost XFF, a returned
  `notFound` from the abuse report, a short-code range under 48 bits of
  entropy, or a later file re-granting the service-only helpers.
- **Edge Function contracts**: `edgeFunctions.contract.test.ts` pins the
  body-cap, origin and field-whitelist behaviour by reading the deployed
  source.
- **Mock parity**: the localStorage backend implements the same 77 methods the
  canister exposes; `sweep.test.ts` mirrors Motoko grading semantics.
- Motion, theme and password-policy contract tests pin the seams each own.

### 2.4 Testing and delivery gates

| Gate | Status |
| --- | --- |
| `pnpm test` | 63 files / 572+ tests, jsdom, green |
| `pnpm typecheck` / `pnpm check` (biome) | 0 errors |
| `pnpm build` + `pnpm security:headers` | exit 0; headers synced into both `vercel.json` files |
| Live security battery | 46/46 (`supabase/e2e/security-battery.mjs`) |
| Live data sweep | 19/19 (`e2e/replay-sweep.mjs`, hand-run with a service key) |
| Live auth protocol | 13/13 (`e2e/auth-flow.mjs`) |
| Auth-mail branding | 17/17 (`e2e/auth-mail-brand.mjs`) |
| CI | `canister-build` (mops check/build + wasm artifact) and `supabase-ci` on every push/PR; `supabase-backup` written |

### 2.5 Deployment

Vercel (Root Directory = repo root, `vercel.json` carries install/build/output
and the SPA rewrite excluding `_vercel/`), Supabase (database + auth + three
Edge Functions + secrets: `RESEND_API_KEY`, `APP_URL`, `GEMINI_API_KEY`/
`OPENROUTER_API_KEY`, optional `APP_ORIGINS`, `CRON_SECRET`,
`TURNSTILE_SECRET_KEY`). Every push to `master` redeploys the frontend.

### 2.6 Technical constraints (do not break these)

- `index.html` must not gain an inline `<script>` (CSP grants no
  `'unsafe-inline'` to scripts); the boot shell recolours through a `<style>`
  block keyed on classes set by `public/theme-bootstrap.js`.
- Each Edge Function imports nothing; a shared helper would have to be copied,
  not imported.
- `src/backend.ts` is candid-generated and cannot be recompiled on the dev
  machine; new Postgres signals ride existing enum variants.
- `dist/` is gitignored — CI's canister baseline is the empty actor, and the
  upgrade-compare happens at the platform's deploys.
- The dev machine has no virtualization: `dfx`/`mops` run only in CI.

## 3. Measured live configuration (2026-09-29)

| GoTrue field | Value | Meaning |
| --- | --- | --- |
| `password_min_length` | 10 | matches the client constant |
| `password_required_characters` | null | no character-class rule (`aaaaaaaaaa` passes) |
| `sessions_inactivity_timeout` | 0 | no idle sign-out; refresh rotation governs |
| `jwt_exp` | 3600 | access tokens live one hour, revoked immediately on sign-out (measured `403 session_not_found`) |
| `mailer_autoconfirm` | false | email confirmation is a hard wall in the database |
