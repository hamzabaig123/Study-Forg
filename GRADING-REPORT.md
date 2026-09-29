# StudyForge — Grading Report

## Regrade — 2026-09-30

*Grading the tree at `4509f9e`. This section exists because one gate changed
state overnight — CI went from red to green for the first time in the project's
life — and the tables underneath would otherwise keep asserting the opposite.
The 2026-09-29 pass stays exactly as written, below, including its log lines;
the rows that moved are restated here with the run that moved them.*

### Gates, run on this tree

| Gate | Result |
| --- | --- |
| `pnpm test` | 63 files, **572 tests passed** (874 s wall, 158 s of test time) |
| `pnpm typecheck` | 0 errors |
| `pnpm check` (biome) | 231 files, no fixes applied, 0 errors |
| `pnpm build` | exit 0 |
| `node test/pocketic/run-backend-lane.mjs` | `backend test lane skipped: stale_backend_wasm`, exit 0 — the lane declines rather than failing, because a Motoko edit cannot rebuild the wasm here |
| GitHub Actions `canister-build` @ `4509f9e` | **success, all ten steps**: `mops check` typecheck green, `mops build` green, `Upload wasm` green. Artifact `backend-wasm` — 364,419 bytes, `sha256:3e8e3f098c3d2ae8298c3be83f9a48020525a067fe262874835a0571e6587c18`. **The first `backend.wasm` this project has ever produced from source** |
| GitHub Actions `supabase-ci` @ `4509f9e` | **success** — `frontend` job ran install, 572 tests, typecheck, biome and build on the runner; `migration` and `replay-sweep` are `skipped`, not failed, because `SUPABASE_STAGING_PROJECT_REF` is unset. So the 572 tests now have a runner, which the row below said they lacked |

### What the red was, and who closed it

Two independent causes, found by two sessions in one tree, and **both** were
needed before the build step could pass:

1. `mops check` refused the chain ("2 pending migrations for check-limit=1"),
   fixed by folding `20260920_120000.mo` into `20260920_130000.mo` (`c0178a2`) —
   the migration `mops` itself names, done as a source edit since no canister was
   ever deployed and the split protected no state.
2. `mops build` then failed at its own `check-deploy` gate, "Tool 'pocket-ic' is
   not defined in [toolchain]" (`6c3d4ca` added `pocket-ic = "15.0.0"`, which is
   what that gate boots the built canister on).

Neither was visible locally, and the *second* one was not even readable: GitHub's
job-log endpoint answers **403 "Must have admin rights to Repository"** even on a
public repo, and the failed step's only annotation was "exit code 1". `540cba7`
made the workflow re-emit the compiler's last 40 lines as `::error::`
annotations, which the REST annotations API does expose without a token — the
reason cause 2 could be named at all.

A third cause, unrelated to Motoko, was found in the same sweep: **`supabase-ci`
has failed at step 3 of every run it ever had**, before installing anything, on
`pnpm/action-setup@v4` refusing to choose between the workflow's `version: 9` and
`package.json`'s `packageManager: pnpm@9.15.9` (`415361c` removed the input). The
gates that were green on this machine have now been green on a runner too.

### Rows that moved

| Area | Was (09-29) | Now | Why, and what still stops the next step |
| --- | --- | --- | --- |
| **Backend (canister + adapter)** | B+ | **A-** | The source now clears typecheck, build **and** a PocketIC boot in CI, and the wasm artifact exists with a readable digest — the thing that made `A-` impossible on 09-29 is measured, not claimed. **Not `A`**: no deploy. `mops build` producing a wasm is not the canister running; that still needs cycles, an Internet Identity registration, and `pnpm bindgen` on a machine with the toolchain |
| **Testing and QA** | A | **A+** | The 572 tests have a runner — `supabase-ci`'s `frontend` job is green on `4509f9e`, and `canister-build` compiles the backend half. **Not `A++`**: `migration` and `replay-sweep` skip for want of a staging project, so the ladder and the live sweep are still hand-run, and `supabase-backup` has still never fired |
| **Operations and CI** | B | **B+** | Two workflows, first green runs, on the same commit, with the artifact hash recorded above. **Not `A-`**: one backup dumped and restored is still a document, the staging project that would make the skipped jobs run does not exist, and the canister artifact is produced but never shipped |
| **Whole product** | A — 9.0/10 | **A — 9.1/10** | The five core areas are now Frontend 9.5, **Backend 8.5**, Database 10, Authentication 9, Cyber security 9; mean 9.1. The remaining gap is human sessions, not code: rotate the pasted credentials, drill one restore, deploy the canister CI now builds |

### One correction about this machine, measured today

`AGENTS.md` says the `mops` commands "fail with 'command not found'" here. That
was imprecise, and the imprecision matters because it hid a fixable step. What is
true, measured at 01:13 today: the **CLI installs and runs** on Windows
(`npm install ic-mops` in a scratch folder outside the repo → `mops --version`
answers `CLI 3.4.1`), and it stops one step later with its own sentence —
**"moc has no Windows build. Please use WSL."** `wsl -l -v` then reports no
installed distribution. So the toolchain is not missing because this machine
cannot host a Node CLI; it is missing because `moc` ships no Windows binary and
there is no Linux runtime installed to run the Linux one. Do not re-attempt
`mops check`/`mops build` here on the strength of the CLI working — the failure is
the compiler, and CI remains the only place this canister compiles.

---

## Regrade — 2026-09-29

*Grading the tree at `5e9b387`, pushed and deployed — `c45c9b1` since then is
documentation only, no code moved. Everything in the tables below was executed on
this machine today, or it says so in the grade column. Where a claim comes from the
sibling session working in this same tree, it is attributed and the measurement
that settles it is named. The 2026-09-27 pass is kept underneath, as written,
because "the grade moved and the old reasoning vanished" is the failure mode this
file exists to avoid.*

**The scale.** `A++` = executed, observed, nothing known broken. `A` = proven,
with a named gap that is not a defect. Below `A`, something is unproven or
unfixed — and *unproven* is not the same as *broken*, which is why two areas sit
at `A` while their last remaining items are human sessions.

### Gates, run on the graded tree

| Gate | Result |
| --- | --- |
| `pnpm test` | 63 files, **572 tests passed** (231 s) |
| `pnpm typecheck` | 0 errors |
| `biome check src` (`pnpm check`, CI's step) | 231 files, **0 errors** — it was **1 error** at `HEAD` this morning; the theme grid became a real `<fieldset>`, nothing was suppressed |
| `pnpm build` | exit 0; the deployed origin now serves this build (`index-DgtQf9MX.css`) |
| `pnpm security:headers` | 9 headers in both `vercel.json` files, no drift to write |
| `supabase/e2e/security-battery.mjs` (live) | **46/46** — and the one way to make it lie: two batteries in flight share the `create_link` limiter, so the entropy-floor probe came back `{"err":"rateLimited"}` and scored **45/46**. Run it alone or past the minute edge. |
| Deployed origin | all nine hardening keys present, CSP ends `report-to csp`, and an anonymous `POST` to `functions/v1/csp-collector` answers **204** — the reporting loop has a listener |
| GitHub Actions `canister-build` | **has run** (≥ 2 runs; the downloaded log covers the one at 14:13 UTC, commit line `abac926`, i.e. the empty-actor-baseline change). `mops install` and the `moc 1.16.0` + `lintoko 0.11.0` toolchain install are green; **`mops check` exits 1** at its stable-interface gate — "2 pending migration(s) but check-limit=1, fold all changes into `20260920_130000.mo`". `Build` and `Upload wasm` never ran, so no artifact exists yet |
| Accessibility (second axe pass) | 63 reported items → four causes, all landed; the browser's accessibility tree names all 9 selects; a contrast sweep of `/share`, `/export`, `/ai-studio` finds **0** failing text nodes; `/classes` outlines `H1 → H2` |

### Scorecard — 2026-09-29

| Area | Grade | Was (09-27) | Earned from | What stops `A++` |
| --- | --- | --- | --- | --- |
| **Database** | **A++** | B+ | 0001–0015 all live on `qjoijoxmnliarlyaqmoz`, RLS forced, the abuse-report oracle closed, the 10-character short-code floor refused below the line, the `cf-connecting-ip` throttle key, TRUNCATE/TRIGGER/MAINTAIN revoked — every one of those re-probed today against the running project, not read out of a file | Nothing in the schema. The recovery story is graded under Operations, because that is where the missing *run* lives |
| **Authentication** | **A** | A- | Email confirmation enforced in the database on every owner table, tenant isolation proven, password floor one constant shared by client and server (10), reset flow end to end, sign-out invalidating the access token immediately (`403 session_not_found`, measured), branded auth mail proven at a real inbox | Neither live policy read came from this session: the sibling's `GET /config/auth` returned `password_required_characters` null and `sessions_inactivity_timeout` 0 (a recorded choice, not an oversight — the app leans on refresh rotation), and the same call re-answered **401** here at 21:52, so those two values are credited, not reproduced. HIBP is Pro-plan only, and the `From` address is the SMTP account until the relay gets a verified domain |
| **Cyber security** | **A+** | B+ | One function emits both the `<meta>` and the served header set, and the set is *served* (Vercel reads `vercel.json`, not `dist/_headers`); CSP reporting closed at both ends; CORS answers one allowlisted origin instead of `*`; three Edge Functions hardened with chunked body caps, a timing-safe secret comparison and a database-backed limiter; 46/46 live | Rotation of the pasted credentials (a decision, not a defect) and the reminder-sender/ai-proxy **body caps' deploy state** — the 80 KiB probe came back `503` with an empty body, which is inconclusive, not a pass |
| **Backend (canister + adapter)** | **B+** | C+ | The adapter implements all 77 methods and the live contract sweep last reported **19/19** (2026-09-28); and the canister source has now been through a real toolchain for the first time in the project's life — `canister-build` installs `moc 1.16.0` + `lintoko 0.11.0`, resolves every declared package, and runs `mops check`, which printed **no type errors** before it stopped | Not `A-`, and one log line decides it: `mops check` **exits 1** at the stable-interface gate ("2 pending migration(s) but check-limit=1 — fold `20260920_120000.mo`, `20260920_130000.mo`"), so the job is red, `mops build` never ran and **no `backend.wasm` artifact exists**. A runner that refuses to certify the chain means less proven, not more (see *Two records disagree*). Deploy still needs cycles and an identity; the sweep needs a credential this session does not have |
| **Frontend and UX** | **A+** | A- | 22 lazy routes, entry 394 → **289 KB gzip**, FCP 3.8 → 2.9 s and Speed Index 7.7 → 2.9 s on Lighthouse's first numbers, every empty/loading/error state on camera, a themed boot shell closing the white-screen gap, and the accessibility audit closed as an edit list with the fixes verified in the browser's own accessibility tree | The canister half of the surface cannot run here, and the ~45 pseudo-element abstentions need the same external audit tool re-run against the deploy to be *seen* to go |
| **Testing and QA** | **A** | A- | 572 tests, three live probes that do not overlap (stranger battery, data-contract sweep, auth-protocol flow), drift guards that read the SQL and the Edge Function sources, and two out-of-repo harnesses that execute the real function bodies under a stubbed `Deno` | One workflow has run, and it is red; the 572 frontend tests still have no runner — `supabase-ci` and `supabase-backup` have no run log reachable from this machine — and both credential-carrying sweeps are hand-run |
| **Operations and CI** | **B** | C | Push → Vercel → headers and performance both measured on the deployed origin; the migration ladder is applied *and read back*; `reminder-sender` at version 10 with every secret set; CI is no longer hypothetical — `canister-build` runs on `master` and has already caught a real defect that no local gate could see | One backup dumped and restored — the drill in `OPERATIONS.md` is still a document; a first *green* run, which for `canister-build` means folding the two pending migrations the chain check names; and a first run of `supabase-ci` and `supabase-backup` |
| **Repo hygiene** | **A-** | C+ | Clean tree, clean `git check-ignore`, `supabase/.env` and every credential out of the repo, two concurrent sessions staging exact paths rather than `-A` | A 9-commit day split across two agents leaves messages that describe each other's work; nothing broken, just imprecise attribution |
| **Whole product** | **A — 9.0/10** | B+ | All of the above. The five core areas — Frontend 9.5, Backend 7.5, Database 10, Authentication 9, Cyber security 9 — mean 9.0, and every one of those numbers descends from a run in the table above rather than from a description | Three sessions, none of them code: rotate the credentials, drill one restore, give CI its first green run (Backend is the area holding the mean down, and it is one chain fold away) |

### What moved, in one line each

- **Database B+ → A++**: 0002–0015 applied and *read back*, so the throttle, the
  entropy floor, the oracle, the TRUNCATE revokes and the violation table are the
  database's rules rather than the client's manners.
- **Cyber security B+ → A+**: the header file stopped being inert (a host now
  serves it), reporting stopped posting into a 404, and the anonymous surfaces got
  a real per-address ceiling keyed on a header the caller cannot forge.
- **Frontend A- → A+**: it is deployed, it is fast by measurement rather than by
  hope, and the two axe passes' findings are code.
- **Backend C+ → B+**: the adapter has answered a live sweep, and the canister has
  answered a real toolchain — but the toolchain said no, in a way that is fixable
  by one fold.

### Two records disagree: is the canister half `A-` now?

The other session that edited this tree today graded Backend **A-** in
`PROJECT-REPORT.md` §4, on "the canister source typechecks in CI … mops check
green, stable-interface check green", and wrote "the wasm CI builds is uploaded as
an artifact every run". The runner's own log — `%TEMP%\sf-ci2\0_build.txt`, 24 KB,
downloaded 19:19, job `build`, commit line `abac926` — says something else, and
these are its last four lines of substance:

```
Run mops check
✗ Stable compatibility check failed for canister 'backend': too many pending
  migrations for check-limit=1
  Pending: 20260920_120000.mo, 20260920_130000.mo
##[error]Process completed with exit code 1.
```

Nothing after that step ran, so there is no build and no artifact, and no run in
the project's life has produced a `backend.wasm` from source. Two things are true
at once and only one of them is a grade: **the workflow works** — it installed the
pinned toolchain, resolved its declared packages, and caught a chain violation that no
local gate could ever have seen, which is precisely what it was written to do — and
**the canister is still not compiled**. `A-` would require the second one. Hence
`B+` here, and `PROJECT-REPORT.md` §4/§5 corrected to match this log in the same
commit. What moves it to `A-` is one sentence of Motoko: fold the two pending
migrations, get a green run, and read the artifact's hash.

### Opened since that pass, and still open

- `password_required_characters` / `sessions_inactivity_timeout`: **read** by the
  sibling session (null and 0 — no character-class rule, no idle timeout), and
  unread from here: `GET /v1/projects/<ref>/config/auth` answered **401** again at
  21:52. The token flaps, so neither session's answer is stable; nothing was
  PATCHed either way, and #121 stays open as a decision, not a mystery.
- Credential rotation: DB password, service key, `sbp_` token, Gmail app password,
  Brevo key, both AI keys. Every one was pasted into a chat at some point.
- The chain fold that unblocks the first green CI run: `mops` names
  `src/backend/migrations/20260920_120000.mo` and `20260920_130000.mo` as the two
  pending migrations and asks for them folded into the later one. Both files are in
  this repo, so it is a source edit — but no `moc` here can check the result, so it
  is only *proven* by the next runner. It belongs to whoever wrote that chain, and
  it is the single change between this tree and a `backend.wasm` built from source.
- The archive import has now been exercised against live Postgres through the real
  UI (see `PROJECT-REPORT.md` §1.2) — the last never-executed check on the 09-27
  list. The backup dump is the only one left in that family.

---

## The 2026-09-27 pass, kept as written

*Two of its headline objections were settled by measurement on 2026-09-28 and one
more on 2026-09-29: 0002 → 0015 are all applied, so the "shipping this build
breaks link creation" consequence below no longer holds (the live rule is now a
10–12-character floor), and `replay-sweep.mjs` has run 19/19. The grades above
supersede the ones below.*

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
- `e2e/` at the repo root has now been **run**, for the first time (2026-09-30).
  `e2e/seed.local.cjs` provisions a throwaway account through the real UI on the
  mock backend — register → local email confirm → class/subject/chapter/topic →
  five questions → a practice session the app itself scores 5/5 — and
  `SEED_LOCAL=1 node app.live.cjs` passes **34/34 checks, zero page errors**,
  reproducibly (run twice, exit 0 both times). It earned its keep on the first
  run: twelve routes failed "carries the entrance transition" because the motion
  pass moved the signed-in shell from the `animate-fade-up` class to a framer
  wrapper with inline `opacity`/`transform`. The check was stale, the app was
  right; it now names both mechanisms, and the probe that settled it prints
  exactly one matched element per route — the region's own wrapper, not a chart.
  Still unproven from this machine: `import.live.cjs` and the credential path of
  `app.live.cjs`, both of which need a real Supabase account. One caveat from the
  old line survives: `e2e/package-lock.json` is git-ignored (`.gitignore:21`), so
  the harness resolves `playwright-core` from its `^1.49.0` range rather than a
  pinned version — this run used **1.63.0**. A built-bundle version of the seed
  is not a gap but a boundary: `vite.config.js:77` and `lib/supabase/env.ts:119`
  together make "mock" impossible in any `vite build`, so the seed is a
  dev-server path by design and the deployed artifact is checked with credentials.
- The canister half stays review-only. No amount of local work closes it: it needs
  `dfx`/`mops`, and this machine has no virtualization.

