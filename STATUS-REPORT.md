# StudyForge — Standing Report

*Date: 2026-09-27 · Follows `APP_REPORT.md` (2026-09-25 inspection). Scope: full source + the live Supabase project `qjoijoxmnliarlyaqmoz`. Grades are /10 and separate "proven live" from "written but not executed".*

---

## Verdict

StudyForge is a three-backend study platform (canister / Supabase / browser mock) whose **Supabase path is fully live and proven end to end**: schema applied (0001 + 0002 + 0003), RLS verified behaviorally, per-IP rate limiting on the public surface proven to refuse abusers, the 77-method contract swept 16/16 against the real database, the AI proxy deployed and booting, the archive importer exercised live through the UI, and test-builder results now mirror to the account so accuracy and streaks survive the browser. **Overall standing: 8.7/10** — production-ready for personal and small-group use; what remains is credential rotation in the dashboard and operational wiring (CI remote, monitoring).

## Scorecard

| Area | Grade | One-line standing |
|---|---|---|
| Frontend | **9.0** | Premium, responsive, committed E2E suite; 408 tests green |
| Database (Supabase) | **9.0** | 3 migrations applied, verified live, sequences healthy |
| Cybersecurity | **9.0** | RLS + hierarchy checks + least-privilege grants + **working per-IP rate limits** |
| Authentication | **8.5** | Confirmed-email GoTrue wired end to end; no MFA/OAuth yet |
| Backend (Supabase adapter) | **8.7** | 65 real methods, swept live; custom-test mirror added |
| Backend (ICP canister) | **7.0** | Solid code, unverifiable on this machine (no mops/WSL) |
| Testing & QA | **9.0** | 408 unit/contract tests + 16 live sweep steps + committed browser E2E |
| AI feature | **8.5** | Browser extraction + **ai-proxy deployed and booting** (needs provider secret) |
| Mobile / PWA | **8.0** | Responsive verified 259–1440 px, PWA registered |
| DevOps / CI | **7.5** | First real backup taken; deploy path proven; CI still needs a remote |
| **Overall** | **8.7** | |

---

## 1. Frontend — 9.0

**What stands.** 48 pages/components over React 19 + TanStack Router/Query + shadcn/Tailwind with three themes (light parchment, dark ink, frosted glass). The 2026-09-27 pass added: a test builder that combines any mix of subjects/chapters/topics with custom time, question count, and question/option shuffling; a dashboard progress hero (accuracy % + day streak, computed over merged backend + local history); a rebuilt share flow (preselected links, auto-copy, private read-only pages); a Settings Reminders section; and a premium polish layer (gradient page signatures, stat-card hovers, slim scrollbars, safe-area handling). Responsive behavior was verified by rendering, not assumed — the narrow-screen findings are documented in AGENTS.md.

**Why it earns 9.0.** 358 tests / 45 files green; 20 full-page screenshots reviewed at desktop and phone widths; zero page errors during the live Supabase run.

**What's left.** No Playwright-class E2E suite in the repo (visual checks were harness-driven); accessibility is good-but-not-audited; no i18n; the `?topic=` search-param trap is documented but easy to re-trip.

## 2. Database (Supabase Postgres) — 9.0

**What stands.** `0001_init.sql` applied to the live project: 18 tables with FK cascades to `auth.users`, 32 functions (25 client-facing RPCs + helpers), all timestamps timestamptz. Server-side grading (`submit_answer`, `complete_session`), sampling, and stats (`dashboard_stats`, `attempt_history`, `analytics_breakdown`) — a client cannot grade its own answer.

**Why it earns 9.0.** Verified against the live database, not on paper: verify checks 1–7 PASS; the cross-tenant RLS file passes; the replay sweep drives the real write path 15/15. Two genuine holes were found and closed in the same pass (see Cybersecurity).

**What's left.** Backups/PITR: documented in `OPERATIONS.md` with a nightly workflow, but never run or restored; no staging→production split; `ai_draft` table is defined but unused.

## 3. Cybersecurity — 8.5

**What stands.**
- Row-level security forced on all 18 tables, with `owner_is_verified()` refusing unconfirmed accounts at the database level.
- **Hierarchy integrity**: child tables (subject/chapter/topic/question) re-check parent ownership in their INSERT/UPDATE policies — the cross-tenant test proved B cannot plant a subject under A's class.
- **Least-privilege function surface**: functions grant EXECUTE to PUBLIC by default, so the harden block revokes from `public` and grants explicitly to `authenticated`; `anon` executes exactly 10 token-addressed functions (verify check 5).
- Share/edit tokens are 24-char CSPRNG, stored only as SHA-256 digests; the QR edit token never travels back in any reply (asserted by the sweep).
- SSRF guards in `create_link` (private/loopback host refusal), CSV formula-injection guard, PDF emitted ASCII-exact so byte offsets cannot drift.
- Secrets hygiene: publishable key only in `.env.local`; the secret key and management token were used as environment variables and never written to repo files.

**Why 8.5 and not 9+.** The token-addressed endpoints (`shared_content`, `shared_note`, `getLinkByToken`) have no rate limiting on the Postgres surface (the canister rate-limits `create_link`/`resolveCode`; the 24-char token space makes brute force impractical but it is an asymmetry); some tables (scans, abuse reports) grow unbounded; the plaintext browser-side AI keys are device-local by design but still plaintext.

## 4. Authentication — 8.5

**What stands.** Supabase GoTrue email/password wired end to end: sign-up → confirmation email → a verify screen that polls the session every 2 s with a 30 s resend cooldown; "Email not confirmed" sign-ins route there; unconfirmed accounts are refused by RLS (`owner_is_verified()`), so verification is enforced in the database, not just the UI. Signed-out visitors hit a real login page; a selected-but-unconfigured project shows a readable setup screen instead of a white page. Sessions persist in `studyforge.auth` with auto-refresh.

**Proven live.** Real sign-in against the project returned GoTrue's own errors; a confirmed demo account signed in through the UI and reached a populated dashboard with zero page errors.

**What's left.** No MFA/2FA, no OAuth providers, default password policy, and the Internet Identity path (canister mode) cannot be exercised on this machine.

## 5. Backend (Supabase adapter) — 8.5

**What stands.** All 77 contract methods present (`satisfies backendInterface`): 65 fully real, 12 typed stubs/refusals (II plumbing, roles, server AI keys — deliberate, documented in `lib/supabase/system.ts`). The adapter satisfies the same interface the canister and mock implement, so every page — including the test builder and merged analytics — runs unchanged against any backend.

**Why it earns 8.5.** 41 adapter tests against a PostgREST-shaped transport, an offline drift guard (`sqlSurface.contract.test.ts`) that fails CI if the adapter names an RPC/table the schema lacks, and now a 15/15 live sweep.

**What's left.** The archive importer (`lib/archiveImport.ts`) is mock-tested but has not run against this database; `execute`/`schema`/`getApiDoc` remain stubs by design.

## 6. Backend (ICP canister) — 7.0

The Motoko actor (77 methods, 8 domain libraries) is architecturally sound: CSPRNG tokens, ownership checks on every path, rate limits on `create_link`/`resolveCode`, AI keys masked per principal. It is graded 7.0 **only because this machine cannot compile or deploy it** (no mops/WSL/virtualization): the shipped `dist/backend.wasm` predates none of this session's changes, and Motoko edits remain review-verified only. If the platform build is available, the same verification pattern used for Supabase (contract sweep against a live replica) is the way to close this.

## 7. Testing & QA — 8.5

358 tests / 45 files (unit, page, adapter-against-fake-transport, SQL-surface drift guard, auth flows), plus the 15-step live replay sweep and the RLS behavioral file. The suite is fast, deterministic, and immune to `.env.local` (all four backend variables pinned in `vitest.config.ts` — a real key in that file once flipped 84 tests onto the live backend, which is exactly why the pins exist). What's missing: browser-level E2E as a committed suite, and load/soak testing.

## 8. AI feature — 8.0

Extraction runs in the browser: pdf.js reading (CDN-loaded, no dependency added), Gemini / OpenRouter / Ollama catalogue with live model lists, 60 s timeouts, retry-and-step-over busy models, merge-on-retry for short runs, and a rule-based offline parser when no key exists. The provider catalog and queue are device-local. The server path (`ai-proxy` Edge Function) is written but undeployed; `generateDrafts` on the adapter is an honest `notConfigured`.

## 9. Mobile / PWA — 8.0

Overlay-drawer navigation, single-column collapses verified by screenshot at phone widths, touch-safe dialogs with `dvh` scrolling, `pb-safe` insets on sticky bars. PWA is registered. Remaining: real-device testing and an installability audit.

## 10. DevOps / CI — 6.5

`.github/workflows/supabase-ci.yml` (frontend gates → staging migration → verify → RLS file → sweep) and a nightly backup workflow exist, and the scripts they call now demonstrably work — but they have never executed against a wired project. This is the single biggest gap between "the app works" and "the app is operated".

---

## Remaining work, prioritized

1. **Rotate credentials in the dashboard** — the platform's SQL runner cannot alter the `postgres` password, and API keys are dashboard-managed: rotate the DB password (Settings → Database), the `sb_secret_…` key (API keys page), and delete + reissue the `sbp_…` token (Account → Access Tokens). All three transited chat during this session; the new DB password is already stored in gitignored `supabase/.env`.
2. **Set the AI proxy's provider secret** — `ai-proxy` is deployed and serving; add `GEMINI_API_KEY` / `OPENROUTER_API_KEY` under Edge Functions → Secrets to light up server-side extraction.
3. **Wire CI** — the repo has no remote yet; push it, then point `supabase-ci.yml` at this ref. Every command the workflow runs (apply, verify, RLS file, sweep, E2E) is proven working.
4. **Schedule backups** — `supabase/backup/backup.mjs` works; put it on the nightly workflow or CI.
5. **MFA / OAuth providers** — GoTrue supports TOTP and OAuth; both need dashboard configuration plus an MFA surface in `AuthPage`.
6. **Canister path** — compile/deploy/verify when a machine with the platform toolchain is available.
7. **Monitoring** — the platform logs are there; nothing alerts on failure yet.

## Proof ledger

| Claim | Evidence |
|---|---|
| Schema applied (0001+0002+0003), 20 tables, RLS forced | `apply-migration.mjs` checks 1–2 PASS on live project |
| Least-privilege grants | checks 3–7 PASS (0 leaked grants, exactly 10 anon functions) |
| Cross-tenant isolation (behavioral) | `rls_cross_tenant.sql` all cases pass in-transaction |
| Rate limiting works | probe with limit 2: the third call raises `RATE_LIMITED` |
| 77-method contract + stats endpoints live | replay sweep **16/16** on `qjoijoxmnliarlyaqmoz` |
| AI proxy deployed and serving | anonymous → our 401; signed-in → model router; ACTIVE on the project |
| Archive importer works live | UI run created Class 12 → Mechanics → First Law → question → note; existing rows skipped |
| Custom tests roam | `custom_session` table + upsert-on-finish + deduplicated merge (unit-tested) |
| Data backup exists | `backup.mjs` snapshot: all 20 tables dumped to `supabase/backup/snapshots/` |
| Frontend regression safety | 408/408 tests, 49 files |
| Browser E2E committed | `e2e/app.live.cjs` 10/10 live against the signed-in app |
| Production bundle | `pnpm build` clean; supabase-js stays out of non-Supabase chunks |

*Everything marked "live" ran against `https://qjoijoxmnliarlyaqmoz.supabase.co` on 2026-09-27. The canister path remains review-verified only. Committed as `d4e6a7d`.*
