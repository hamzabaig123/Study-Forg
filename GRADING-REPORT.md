# StudyForge — Grading Report

*2026-09-27. Grades are letter grades (A++ → D), and every grade is earned from
something that was either executed and observed, or explicitly marked unproven.
A claim that only exists in a document is graded as unverified, including when
this file's own author wrote it. `STATUS-REPORT.md` (a second, concurrent
session's report, scored /10) disagrees with several findings here; the
disagreements are listed and, where it was possible to settle them, settled by
measurement instead of by picking a side.*

## Gates, re-run on this tree

| Gate | Result |
| --- | --- |
| `pnpm test` | 49 files, **408 tests passed** |
| `pnpm typecheck` | 0 errors |
| `biome check src` | clean |
| `pnpm build` | succeeds; emits `dist/index.html` with the CSP meta and `dist/_headers` (2,593 bytes) |

## Scorecard

| Area | Grade | Was | Why this grade |
| --- | --- | --- | --- |
| **Database** | **B+** | B+ | 18 tables, RLS forced, 33 functions, real reads and writes proven on production. Not A: migrations 0002 and 0003 are **written and not applied** — now measured, not assumed — so there is no database-side throttle on the ten anonymous functions and the live short-code rule is still exactly 7 characters. No backup has ever been dumped, no restore has ever been drilled, and 0001 went in by hand, so there is no migration history or CI gate behind the schema. |
| **Authentication** | **A-** | A- | Email confirmation is enforced *in the database* (`owner_is_verified()` on every owner table), cross-tenant isolation is proven, and a password-reset flow exists end to end in code and routing. Not A++: reset cannot complete until Site URL + Redirect URLs name the `/reset-password` origin, and the "unconfirmed account is refused" case has never been executed against the live project. |
| **Cyber security** | **B+** | C+ | One function now generates both the `<meta>` policy and the host header file (`frame-ancestors 'none'`, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, COOP, and a Permissions-Policy deliberately silent on clipboard/notifications). Short-code entropy is raised to 49.5 bits in the client, the mock and the canister, pinned by a drift test that reads every migration, strips SQL comments, and fails if the DDL, `tokens.ts` and the mock disagree. Provider keys are `sessionStorage` by default with an explicit per-provider device opt-in. Not A: **the header file is inert on this host** (caffeine.ai has no header surface, so clickjacking stays open in production), there is no CSP reporting (a meta cannot carry one), the throttle is unapplied, and **the credentials that were pasted into chat are still unrotated** — the largest real exposure in the project, and the only one that is purely a decision. |
| **Backend** | **C+** | C+ | Split, and the split is the grade. The Supabase adapter implements all 77 methods and typechecks against the same interface as the canister — but the live 77-method contract sweep has **still never been executed**, so the adapter is proven by types and unit tests, not by the database answering. The ICP canister half is review-only: no `dfx`, `mops` or `bindgen` runs on this machine, so `src/backend/dist/backend.wasm` cannot be rebuilt and Motoko edits cannot be typechecked. `ai-proxy` is written and undeployed. |
| Frontend and UX | A- | — | 408 green tests, responsive verified at 259–1440 px, PWA registered, build minified. Held back by nothing being deployed from this tree yet. |
| Testing and QA | A- | — | Unit + contract + drift guards + a runnable live sweep. Held back because the most important test (the live sweep) is the one that has not run, and the harness's lockfile is git-ignored, so it is not reproducible elsewhere. |
| Operations and CI | C | C | Backup workflow, restore drill, staging job and CI pipeline are all written. None has executed: the nightly workflow cannot run until two repo variables exist, no restore has been attempted, and the repo has no remote for CI to run on. |
| Repo hygiene | C+ | — | 72 modified and 32 untracked paths are uncommitted, two sessions are editing one tree concurrently, and `.gitignore` reached HEAD (commit `d4e6a7d`) carrying 27 NUL bytes — which made git treat it as binary *and* left `supabase/backup/snapshots/` matching nothing, so a `pg_dump` placed there would have been `git add -A`-able. Repaired in the worktree and confirmed with `git check-ignore`. |

## Two records disagree — here is what was measured

| Claim in `STATUS-REPORT.md` | Measurement available to this session | Standing |
| --- | --- | --- |
| "schema applied (0001 + 0002 + **0003**)" | A side-effect-free probe of the live `create_link` (valid URL, real code, deliberately short token, so it returns before any INSERT): 7-character code → `badToken`, 10-character code → **`badCode`**. | **Contradicted.** The widened validator is not live. Either 0003 was never applied, or 0002 was applied after it and restored the narrow rule — the exact ordering failure documented in `0003`'s header. |
| "77-method contract swept 16/16" | This session has never run it and cannot: it needs the DB password or a service key. The file now contains 17 steps, not 16. | **Unproven here.** Not disbelieved, not counted as evidence. A run that happened leaves a `link`/`class` row behind; none is asserted either way. |
| "first real backup taken", "ai-proxy deployed and booting", "importer exercised live" | No dump file, no deployed function URL, no import report is reachable from this working tree. | **Unproven here**, same rule. |

`verify.sql` check 9 in this repo compares the live `link.code` CHECK against the
live `create_link` body, and settles all of it in one run. Until that output is in
front of us, the migrations are graded as unapplied.

### Settled the next day (2026-09-28), by measurement

Both objections above were resolved from this machine, so the rows are kept as
written and answered here rather than quietly rewritten:

- **0002, 0003 and every migration since are applied** — 0001 through 0011, and
  all 14 read-only items of `verify.sql` (item 9 included) now answer as their
  comments claim. `HARDENING-REPORT.md` §2.8 and §4 record the runs.
- **The contract sweep has run.** `node supabase/e2e/replay-sweep.mjs` against
  `qjoijoxmnliarlyaqmoz` with `SUPABASE_SERVICE_ROLE_KEY` (the documented pooler
  route is gone: `GET /v1/projects/<ref>/database/connection-string` now answers
  404) reports **19/19**, and the step count moved twice after this file was
  written — the three newest steps drive the tables no other gate had ever had a
  client write (`reminder_settings`, `push_subscriptions`, `custom_session`). It
  deletes all three throwaway accounts at the end, so the "a run leaves a row
  behind" objection is closed too.


## The consequence, stated plainly

The frontend built from this tree mints **10-character** short codes. Production
currently rejects 10-character short codes. So shipping this build without
applying 0003 does not merely leave a hardening gap — it **breaks QR/link
creation** with a `badCode` error in the UI. Apply 0002, then 0003, in that order,
before this build goes out. (Until then, the deployed app and the older build stay
on the ~35-bit rule, which is the weaker of the two problems but not a small one:
the ten token-addressed functions still have no throttle, so guessing a 7-character
short code costs nothing but a request.)

## What moves each grade

- **Database B+ → A**: apply 0002 then 0003; run `verify.sql` and paste the output; take one `pg_dump` and restore it into a scratch database once; commit the migration history so CI has a revision to compare against.
- **Authentication A- → A++**: set Site URL + Redirect URLs; run the sweep so the unconfirmed-account refusal is observed rather than asserted; then MFA/OAuth federation, which Internet Identity cannot provide here (no OIDC endpoint to trust).
- **Cyber security B+ → A+**: rotate the leaked-class credentials (DB password, service key, the `sbp_` token, both AI keys) — this is the one item that changes the real risk profile today; deploy `dist` to a host that reads `_headers`, since generating it changed nothing until something serves it.
- **Backend C+ → B+**: run `replay-sweep.mjs` against the live project once. A++ is not reachable on this machine for the canister half at all; it needs a host with the ICP toolchain.

## Overall

**B+.** Three of the four areas are within one operational step of an A-: the code,
the tests and the documentation are in place, and what is missing is execution
against live systems — applying two migrations, running one sweep, taking one
backup, deploying somewhere that reads a header file, rotating four secrets. The
ceiling is not the code; it is that nothing has been proven against production
except the parts of 0001 that went in on 2026-09-27, and the short-code probe above
is the first fresh measurement of it since.

## What is not done yet

Not gaps in the grade — gaps in the work, so the next read of this project does not
have to rediscover them.

**Needs a credential, so it is yours to run**

- Rotate the DB password, the service-role key, the `sbp_` Management API token and
  both AI provider keys. Nothing in this repo holds any of them (`supabase/.env`
  does not exist; `.gitignore` covers it), but every one has been pasted into a chat.
- Apply `0002_rate_limits.sql`, then `0003_short_code_entropy.sql`, then run
  `supabase/verify.sql` and read checks 8 and 9.
- Set GoTrue's Site URL and Redirect URLs to include the `/reset-password` origin,
  or the reset flow is untestable.
- Run `node supabase/e2e/replay-sweep.mjs` once with `SUPABASE_DB_URL` (plus
  `NODE_PATH` pointed at a scratch `pg`) and paste the tail.
- Take one `pg_dump` and restore it into a scratch project once — the drill in
  `supabase/OPERATIONS.md` has never been executed, so "backups exist" is still a
  statement about a workflow file.
- Deploy `functions/ai-proxy` if provider keys should leave the browser at all.
- Deploy `dist` somewhere that reads `_headers`; on caffeine.ai the header half of
  the CSP work does nothing.
- Import the localStorage archive into the account (Settings → *Move data from this
  browser*), which is the only check that exercises `lib/archiveImport.ts` against
  Postgres rather than the mock.
- Commit. 72 modified and 32 untracked paths are uncommitted; `AGENTS.md`,
  `DESIGN.md`, `src/frontend/src/index.css`, `tailwind.config.js` and
  `TestBuilder.tsx` are hand-edited files that should stay out of any commit.

**Left open deliberately, with the reason**

- `apply-migration.mjs` still asserts checks 1–7 of `verify.sql`. Check 9 is a
  *comparison of two live objects* and check 8 is the cross-tenant file the script
  already runs; adding #9 there means teaching the script about two migrations
  instead of one, which is the same change as "apply 0002 and 0003 from CI", so it
  waits for that decision rather than half-doing it.
- The throttle was **not** load-tested from this machine. Proving `enforce_rate_limit`
  is live needs ~21 requests that trip it, which would briefly block link creation
  from this IP on production. A deliberate throttle of a live system is not a
  read-only probe, so it is left as a line in `verify.sql` and an experiment you can
  run when the project has a staging ref.
- `e2e/` at the repo root (another session's Playwright harness) is untouched. Its
  `package-lock.json` is git-ignored, so the harness is not reproducible elsewhere;
  that is a call for whoever owns it, not a fix to make from the outside.
- The canister half stays review-only. No amount of local work closes it: it needs
  `dfx`/`mops`, and this machine has no virtualization.

