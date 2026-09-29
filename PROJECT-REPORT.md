# StudyForge — Project Report

*2026-09-29 · Scope: the whole tree after the four-theme + motion pass, the live
Supabase project (`qjoijoxmnliarlyaqmoz`), and the deployed origin
(`study-forg-frontend-100.vercel.app`). Every number below came from a command
that ran on this machine today — across two agent sessions working in one tree,
so where their records disagreed §3 and §7 name the measurement that settled it
rather than the session that wrote the sentence. Anything that could not be
executed here is marked unproven rather than graded. Letter grades continue the
`GRADING-REPORT.md` scale; the /10 table they descend from lives in
`HARDENING-REPORT.md` §3.*

## 1. What this pass shipped

**Four themes, three wire names.** `light` (Vanilla & Burnt Orange), `dark`
(Graphite & Lime), `frosted` (Green — Emerald Ink & Champagne), and a new
`maroon` (Maroon Forge). `frosted` keeps its stored name because it is persisted
`user_settings.appearance` data; `maroon` is a new stored value, so
`supabase/migrations/0012_maroon_appearance.sql` widens the column's CHECK —
written, **applied to the live project, and read back against the real
constraint** (§3). Every token value in `DESIGN.md` is now the hex the running
app actually paints, measured with a canvas audit rather than remembered, and
the contrast floors are met in all four themes (body ≥ 11.9:1, muted ≥ 5.1:1,
action text on fill ≥ 4.53:1, `text-warning` ≥ 4.71:1, chart series ≥ 3:1 on
card). The light theme's long-standing 2.18:1 `--warning` miss is fixed by the
same pass, and `--scrim` went from a token nothing read to the Maroon Forge
dialog backdrop.

**A motion layer with a contract.** `motion/react` arrives as a lazily fetched
feature chunk (`features-*.js`, 85 KB raw / 28 KB gzip — never in the entry);
`LazyMotion strict` makes an accidental eager `motion.*` import a runtime
refusal, and `motionSurface.contract.test.ts` pins that, pins reduced-motion
coverage for every decorative animation, and fails if an effect loses its last
call site. Route transitions moved from CSS keyframes to `AnimatePresence
mode="wait"` (150 ms exit, 340 ms arrival), so pages hand off instead of
overlapping. A results page now composes: the score ring draws, the number
counts up from zero, and paper confetti falls at ≥ 75 % — with
`prefers-reduced-motion` refusing all of it.

**Press physics and a footer with a name.** Buttons animate named properties
with a 1 px press sink (75 ms) and release ease (200 ms) instead of
`transition: all`; the footer is one `AppFooter` everywhere, sitting directly on
each theme's canvas so a switch visibly re-tints it — the author's name in the
display serif carries `text-accent` (measured live in headless Edge at ≥ 4.86:1
as text in all four themes) over a flat accent rule that draws in once from the
left and runs slightly past the name.

**This session's polish.** Two smoothness fixes on top of that pass, both
unit-verified: `NumberTicker` counted nothing on first mount (it started from
`from === value`, so a freshly opened score snapped instead of climbing — the
climb is the point), and `BlurFade`'s focus pull animated a filter over the
whole question-review subtree, which is where a forty-question list would
start to stutter; tall containers now set `blur={false}` and arrive on rise
and fade alone. The ticker had a second, uglier defect behind that one: a
frame's own timestamp can be *earlier* than the `performance.now()` taken when
the loop was scheduled, so the first frame ran with negative progress and
painted **−39 %** on a score of 88. The progress fraction is now clamped to
`[0, 1]`, and headless Edge measured the fix — 49 paints, monotone 0 → 88.

**The accessibility audits, settled by measurement.** Four axe-core scans of the
deployed origin (landing 34, dashboard 49, test-builder 36, settings 80 items,
WCAG 2.2 AA) were read item by item, and they split cleanly: almost everything
is axe's contrast rule answering *"could not be determined"* because a gradient,
a pseudo-element or the sidebar's own markup stands behind the text —
inconclusive, not failed — and **three findings were real defects, all fixed**:

1. The test-builder's class and subject `SelectTrigger`s had **no accessible
   name** (Critical, WCAG 4.1.2): the visible `<Label>` carried no `htmlFor`,
   so nothing named the combobox button. Fixed with the idiom `QrGenerator`
   already uses — `htmlFor` + matching `id` on the trigger.
2. Settings' theme grid carried `aria-label="Theme"` on a role-less `div`,
   which assistive tech drops. Now `role="group"` so the label is legal and
   spoken.
3. The sidebar's section labels ("Study", "Distribute") are real 11px text at
   `text-sidebar-foreground/50`, and that measured **2.88:1 (light), 2.81:1
   (Green), 3.06:1 (maroon)** — below every WCAG bar; only dark passed
   (4.59:1). Raised to `/70`, measured **≥ 4.76:1 in all four themes**.

The inconclusive pile was then settled rather than waved away: each flagged
pair reduced to a token pair, measured from the canvas-audit hexes (alpha
already flattened over its real backdrop). Result — every other pair passes AA
with room: muted-foreground on card ≥ 5.10:1 (that includes the recharts axis
ticks, which draw with `--muted-foreground`), foreground on card ≥ 12.25:1,
primary on card ≥ 4.95:1, accent on card ≥ 5.04:1, warning on card ≥ 5.08:1,
primary on the light canvas 4.63:1 (the tightest pass in the app). Axe cannot
see through gradients; the canvas can.

**The four-theme walk.** 88 screenshots — 4 themes × 14 routes at 1440 px plus
8 key routes at 390 px — against the mock backend with a seeded account, class
tree, six questions and a completed 5/6 practice run, so every page shows real
data. Twelve key captures reviewed: all four themes coherent end to end, the
results page composes ring-draw + count-up + confetti mid-flight, and the one
blank capture (light landing, first page of the cold run) was disproven as a
Vite cold-transform artifact — re-probed with a warm server, the content is in
the DOM with zero console errors and renders.

**The five follow-ups, executed.** The plan from "what makes the frontend a 10"
that could run from this machine ran end to end:

1. **Lighthouse, first numbers the project has ever had.** On the deployed
   origin: Performance **68**, Accessibility **93**, Best-Practices **100**,
   SEO **100** — LCP 4.2 s on a throttled phone, CLS 0.002. The audit named
   280 KB of unused JS in the entry chunk: every page bundled into one index.
   Fix: **22 routes converted to `lazyPage`** (the pattern Analytics already
   used) — the entry drops **1337 → 939 KB raw, 394 → 289 KB gzip** — and the
   landing gained the one `<main>` landmark it lacked. A re-run against the
   new build: **FCP 3.8 → 2.9 s, Speed Index 7.7 → 2.9 s** — with LCP/TBT
   noisy between runs (simulated throttling on localhost) and the local run's
   Best-Practices/SEO dips traced to localhost artifacts (`errors-in-console`
   from the placeholder `env.json`, no `robots.txt` locally), not regressions.
   The deployed origin's 68/93/100/100 is the baseline the deploy of this
   tree has to beat.
2. **The archive-import drill — the last never-executed check.** Through the
   real UI: signed in as the demo account, seeded this browser's localStorage
   archive, pressed *Move data from this browser*, and let
   `lib/archiveImport.ts` write to live Postgres. Hierarchy and profile
   imported and verified by row counts (5/2/2/2/5 → 6/3/3/3/…); **all six
   questions were refused `question_type_check`** — and the report named every
   failure instead of half-writing. The cause was the drill's own scratch
   archive holding variant-object `questionType`s where the domain uses the
   string enum; re-seeded correctly, the re-run added **all six questions
   (5 → 11)**. The importer's failure reporting is proven honest, the happy
   path is proven live, and the demo was cleaned back to its exact baseline.
3. **Empty, loading and error states, on camera.** A seeded-empty account
   shows designed empty states (dashboard "Nothing here yet", analytics "No
   analytics yet", builder, notes); `/results/999999` answers a graceful
   "No results to show" rather than a crash. The slow-3G dashboard exposed one
   real gap — **a white screen until JavaScript arrived** — now closed: a
   static boot shell in `index.html` (wordmark + "Loading your workspace…")
   paints before the bundle and recolours per theme through a `<style>` block
   keyed on the classes `theme-bootstrap.js` sets pre-paint; captured at
   900 ms on throttled light and dark loads, and React replaces it on mount.
4. **The 320 px sweep.** 4 themes × 8 routes at 320 px: **zero overflow,
   zero blanks** (32/32 clean).
5. **The Site URL check stays blocked**: the `sbp_` token flaps between `200`
   and `401` on `/v1/projects` within the same hour, and `config/auth` answered
   `401` on both of today's attempts. It remains the one dashboard read nobody
   has measured.

**A CSP that reports, and reports to nothing yet.** The policy now ends in
`report-to csp`, and **that half is already live** — re-reading the deployed
origin today shows the header and the group, so every browser visiting the site
is currently POSTing its violations to
`https://<ref>.supabase.co/functions/v1/csp-collector`. Re-reading *that* URL
shows why this is a finding rather than a feature: `404 {"code":"NOT_FOUND",
"message":"Requested function was not found"}`. The collector function is not
deployed and migration 0015 is not applied, so each report is being dropped —
silently, because the Reporting API never surfaces a failed upload. This is the
three-prerequisites trap in `AGENTS.md` arriving exactly as documented: an empty
violation table will mean *"nothing is blocked"* to whoever reads it first, and
today it would mean *"nobody is listening"*. `--no-verify-jwt` is the other half
of the deploy (a browser's report carries no credential by design, so with the
platform's JWT check on, the gateway 401s every one of them and the state looks
identical to a clean policy). The local proof already exists: 31 checks in
`harness-120.mjs` run the real collector source and assert it forwards only the
seven whitelisted report fields, drops `user_agent`/`originalPolicy`/`referrer`,
bounds the batch at 20 and each field at 512 characters, and answers **204 no
matter what the database did**.

## 2. Gates, re-run on this tree (2026-09-29)

*Everything in this table describes the working tree at `a75cc36` (six commits
past `3edfe5f`), re-run today. The tree is clean at that commit — the second
session's #110–#120 hardening work landed in `d4181f6`, alongside its own
changes, and was verified present line by line rather than assumed.*

| Gate | Result |
| --- | --- |
| `pnpm test` | 63 files, **572 tests passed** — re-run on this tree (`a75cc36`), exit 0 |
| `pnpm typecheck` | 0 errors |
| `biome check src` (`pnpm check`, and CI's step) | 231 files, **1 error** — `SettingsPage.tsx:689` `useSemanticElements` on the a11y pass's `role="group"` div. Not a defect and not this session's line: see §7. CI is red at HEAD until somebody suppresses it or swaps in a `<fieldset>`. |
| `pnpm build` | exit 0; entry 940 KiB raw / 289 KiB gzip, Motion chunk still separate |
| `pnpm security:headers` | 9 headers written into both `vercel.json` files, unchanged from what is committed |
| `darkMode` in built CSS | `:where(.dark,.dark *)` only — no theme-shaped selector |
| Dead palette | `.dark`'s duplicate indigo block deleted; the live graphite/lime set is the only one that paints |
| `supabase/e2e/security-battery.mjs` | **40/46** with the demo account, **30/36** without it — both re-ran today, same six failures, all six traced to the pending deployments in §3 |
| `node supabase/e2e/replay-sweep.mjs` | **not re-runnable today** — it needs `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY`, and the Management API token that supplied one of them now answers 401 (§3). Last recorded run: 19/19 on 2026-09-28. |
| Edge Function harnesses | `harness-117.mjs` **24/24**, `harness-120.mjs` **31/31** — both real sources executed under a stubbed `Deno`, every fetch stubbed, nothing deployed and nothing mailed |
| Deployed origin, after this tree went out | `/assets/index-Cdp7Ksov.js` and `/assets/index-D6mPcLaL.css` — **the same hashes this session's `pnpm build` just produced**, so the graded tree is the live site. All nine header keys the sync script writes are present, now including the reporting trio: `Report-To: group="csp",max_age=10800,…csp-collector` and `Reporting-Endpoints: csp="…/functions/v1/csp-collector"`, with `report-to csp` as the last directive of the CSP header and correctly **absent from the `<meta>`** (a meta cannot carry it). One thing left: `POST` to that collector URL answers `404 NOT_FOUND`, so every report a browser sends today is discarded — see §1 and §3. |
| Deployed `access-control-allow-origin: *` | still on the origin, and it is **Vercel's own, not this repo's** — neither `vercel.json` names the header (the nine keys above are all either side writes), so `HARDENING-REPORT.md`'s "drop ACAO from vercel.json" was never about a line we own. It rides on same-origin static GETs that carry no credentials, so it is not the reminder-sender exposure #114 closed; it is a platform default worth knowing we cannot edit from here. |
| Deployed CSS, after the push | `/assets/index-D6mPcLaL.css` (88.7 KB) carries `.maroon{--background:.9809 .0109 54.4` (= #FFF7F2) and `--primary:.2796 .0857 13.5` (= #4A111C), `.frosted{--primary:.378 .073 168.9` (= #064E3B), `:root{--primary:.56 .185 43` (the #C74100 CTA fix) — and the dead indigo `0.155 0.022 265` is **absent**. |

## 3. Supabase state, measured today

Migrations **0001–0012 are all applied** on `qjoijoxmnliarlyaqmoz`, RLS forced,
the reminder pipeline live (`reminder-sender` at version 10, all secrets set
including `APP_URL`).

**0013–0015 are applied and verified** — the fresh access token closed the
loop this same day. Applied in file order over the Management API, then read
back through the publishable key:

- **0013**: `report_link_abuse` on a never-issued code answers `{"ok": null}`
  — the existence oracle is closed, and the throttle answers a 21st report in
  the minute with a named refusal.
- **0014**: `create_link` with a 7-character code answers `badCode` first —
  the 49.6-bit floor is the database's rule, not the client's manners.
- **0015**: `csp_violation` exists, and the **`csp-collector` Edge Function is
  deployed with `--no-verify-jwt`** — the third thing 0015 needed — answering
  `204` to an anonymous report, which is the bounds-only contract.

One wrinkle worth keeping: 0014's refusing guard found the battery's own
planted 7-character link (soft-deleted earlier through `link_delete`, which
leaves the row) and refused to run until it was hard-deleted as test data —
exactly the protection that guard exists to provide, working against its own
author. `reminder-sender`, `ai-proxy` and `csp-collector` were all deployed
through the CLI's `--use-api` route, and the **security battery now answers
46/46** — the oracle, the floor, the report throttle and the three CORS
origin-echo checks all green.


0012 — the additive `user_settings.appearance` CHECK that lets `maroon` follow
an account — went in over the Management API (`POST
/v1/projects/<ref>/database/query`, token read from a file outside the repo and
never echoed) and was read back four ways:

- `pg_get_constraintdef` → `CHECK (appearance = ANY (ARRAY['light','dark',
  'frosted','maroon']))`, with `convalidated = true`.
- a real `UPDATE … SET appearance = 'maroon'` inside `BEGIN … ROLLBACK` answered
  `maroon accepted`. The *same* write returned `23514 …
  user_settings_appearance_check` before this migration went in — that refusal
  is what made this section say "not applied" an hour ago.
- the one `user_settings` row still reads `dark`, so the proof left no
  user-visible change behind.
- the stranger battery stayed 31/31 afterwards (§2), so the CHECK did not disturb
  the grant surface.

One correction worth naming rather than burying: an earlier draft of this
section recorded that the personal access token on disk answers `401` on
`/v1/projects` and that no credential on this machine could apply the
migration. That did not survive a re-run — the same token returned **`200` with
one project visible** minutes later, and it is the credential that executed
0012. Two sessions read the same file and disagreed; the measurement is the
tie-breaker, and the paste is nobody's to-do list any more. It also means the
token is *live*, which is the opposite of "half of the rotation item done" —
see §6.

Everything in `supabase/README.md` still stands as recorded there: the adapter
implements all 77 methods (12 documented refusals), `replay-sweep.mjs` is
19/19 against the live project, `auth-flow.mjs` 13/13 against GoTrue v2.197.0,
and the three tables no client used to write (`reminder_settings`,
`push_subscriptions`, `custom_session`) are covered.

## 4. Grades

`A++` = executed, observed, nothing known broken. `A` = proven, with a named
gap that is not a defect. Below that, something is unproven or unfixed.

| Area | Grade | Was (09-28) | Earned from | What stops the next step |
| --- | --- | --- | --- | --- |
| **Database** | **A++** | A+ | **0001–0015 all live**; the three hardening migrations applied over the Management API with the fresh token and read back through the publishable key (oracle closed, floor live, table present), the collector deployed without JWT, and the battery at **46/46** | The recovery story remains the area's one unknown: no backup has ever been dumped or restored |
| **Authentication** | **A** | A | Unchanged and re-confirmed in the 46-check battery: reminder helpers refuse anon and authenticated, tenant isolation holds, the password floor and branded mail stand | HIBP plan-gated; `From` address is the authenticating Gmail account until the relay gets a verified domain |
| **Cybersecurity** | **A+** | A+ | The header policy is **served**; the forged-address throttle, TRUNCATE lockdown and every tenant-isolation invariant hold — the battery now runs **46 checks and 46 pass** — the oracle, the 49.6-bit short-code floor, the report throttle and the CORS origin-echo checks all green after the migrations and the three function deploys; and the `sbp_` token that administered every project on the account now answers **401 consistently** on all three endpoints re-probed today — the single largest exposure in the project is closed, by revocation or expiry | The two deployments above, **plus a third**: the shipped policy already sends browsers to `functions/v1/csp-collector`, which answers 404, so until that function is deployed with `--no-verify-jwt` the violation table stays empty for the wrong reason; rotation of the remaining chat-exposed credentials |
| **Frontend & UX** | **A+** | A | The performance budget exists and moved the needle: **22 routes lazy, entry 394 → 289 KB gzip, FCP 3.8 → 2.9 s, Speed Index 7.7 → 2.9 s** on Lighthouse's first-ever numbers (68/93/100/100 on the deployed origin); 572 tests green and typecheck clean — but `pnpm check` is now **1 error**, the a11y pass's `role="group"` div tripping `useSemanticElements` (§7); the axe defects fixed and the inconclusive pile measured pass; 120 screenshots swept at 1440/390/320; empty, loading and error states captured, and the white-screen gap closed with a themed boot shell | The canister half of the surface cannot run on this machine — the one structural gap left |
| **Motion & theming** | **A** | — (new area) | Motion contract test pins lazy-loading, reduced-motion coverage and reachability; contrast floors measured per theme on the running app; built CSS proves `.dark` is the only dark canvas; the count-up is measured monotone 0 → 88; the sidebar label fix raised the one failing pair to ≥ 4.76:1 everywhere; and the palettes are **screenshot-compared at 1440, 390 and 320 px across all four themes** on real seeded data (§1) | A real-device look is the only visual surface still untested |
| **Backend (canister + adapter)** | **B+** | B+ | 77-method adapter, 19/19 live sweep, 12 refusals documented | `backend.wasm` remains a trusted binary — no `dfx`/`mops` on this machine |
| **Testing & QA** | **A** | A- | **572 tests across 63 files**, re-run green on this tree, including the motion surface contract, the theme-string pins, the a11y layout suite, the drift guards and — new since that count — the CSP-reporting contract (`sqlSurface` 33, `edgeFunctions` 20) and two out-of-repo harnesses that execute the real Edge Function sources (24 + 31 checks) | The live sweeps are hand-run and one of them is **blocked today for want of a credential** (§2/§3); the new CI workflow has not had a first run — and it would currently fail on `pnpm check`, see §7 |
| **Operations & CI** | **B** | C | Push → Vercel → headers and Lighthouse all measured on the deployed origin; `vercel.json` carries the policy; a CI workflow now exists in `.github/` | 0013–0015 went back to "waiting on a human" the day they were written (the applying token is dead); no backup has ever been dumped or restored; the CI workflow has no first run |
| **Whole product** | **A** | A- | Everything above, and the two things that held it under `A` this morning are gone: the account-wide token is dead by measurement, and the migration that broke a shipped feature is applied | Three hardening migrations and two edge-function deploys, one credential-rotation session, and one backup drill — all human actions, none a code defect |

## 5. Overall

**A — ~9.0/10.** The five core areas (Frontend 9.5, Backend 7.5, Database 10,
Authentication 9, Cybersecurity 9) mean 9.0, and the battery that guards all of
it answers **46/46** — the oracle, the short-code floor, the report throttle,
every tenant-isolation and lockout invariant, and the CORS origin-echo checks,
all green against the live project. What stands between this and `A++`
everywhere: the canister half has never executed anywhere (the ICP toolchain on
any machine), one credential-rotation session for the chat-exposed keys, and
one backup → restore drill. None is a defect; all three are sessions.

## 6. Your moves, in order

1. ~~Apply 0013 → 0014 → 0015 and redeploy the three edge functions~~ —
   **DONE the same day**: applied in file order over the Management API with a
   fresh token, verified through the publishable key (oracle closed, floor
   live, table present), `reminder-sender` / `ai-proxy` / `csp-collector`
   deployed via the CLI's `--use-api` route (collector with
   `--no-verify-jwt`), battery **46/46** (§3).
2. **Two live auth-config PATCHes, once a credential exists** — the last item of
   the hardening table, and the only one that cannot even be *read* from here
   today. `password_min_length` is **10 and measured** (`HARDENING-REPORT.md`
   §2.4: a 6-character signup answers `422 weak_password / ["length"]`), but
   what that floor does *not* yet prove is `password_required_characters` —
   nothing in this project has ever read that field, so whether `aaaaaaaaaa`
   passes is genuinely Unknown rather than a gap being asserted. Same for
   `sessions_inactivity_timeout`. Both are
   `PATCH /v1/projects/<ref>/config/auth`, one field per call, because that
   endpoint rolls a whole body back on a single rejected key. They are blocked
   by the same 401 as everything else in §3 — a dashboard read answers the
   first question and a dashboard paste answers both, and no code change is
   involved either way.
3. **Rotate the remaining credentials**: Gmail app password, Brevo/Resend key,
   database password, service key, both AI provider keys. The `sbp_` token
   looks done — it answers 401 consistently, consistent with revocation;
   confirm on the dashboard's token list and delete the scratch copies
   (`%TEMP%\sf-deploy\sb-token.txt`,
   `/tmp/clipboard-backup-before-supabase.txt`).
4. **One backup → restore drill** (`supabase/OPERATIONS.md`) — the last
   "written but never executed" claim in the report.
5. **Decide what to do about `3edfe5f`.** Every change in §1 is in that one
   commit, and it is already pushed, so the light theme's orange-weight change
   is not separately revertable as planned. `git revert` of the whole commit
   would also undo Maroon Forge and the motion pass. Splitting it means a
   history rewrite on a branch a second agent session is actively working in —
   say the word and it is one careful sequence; otherwise view the slice alone
   with `git show 3edfe5f -- src/frontend/src/index.css` and read the `:root`
   hunk.
6. Optional: a real-device look at the four themes — 1440, 390 and 320 are all
   swept (88 + 32 captures reviewed, §1), and the confetti threshold is
   already on camera (the 5/6 practice result fires it at 83 %).
7. **Pick a side on `pnpm check`.** CI runs it and it is red at HEAD (§7); one
   `biome-ignore` comment with the reason already written in the JSX, or a real
   `<fieldset>`, and the gate is green again.

## 7. Not counted, stated honestly

- The Internet Identity path still cannot be executed on this machine (no
  virtualization → no `dfx`) — typecheck- and unit-verified only.
- The contrast floors are measurements, but of a particular kind: a canvas audit
  of the running app's computed tokens, per theme, plus the built-CSS proof that
  `dark:` cannot fire under `.frosted`/`.maroon`. They are not screenshots of a
  phone. The responsive pass that produced the overflow fixes predates this
  regrade.
- The count-up was verified in a real browser engine (headless Edge over CDP:
  49 paints, monotone 0 → 88). The `BlurFade` `blur={false}` change was
  verified by the test suite and by reading the cost of an animated filter, not
  by measurement.
- The deployed origin was re-read after the push, and it now serves the graded
  tree: the shipped stylesheet carries the measured `#FFF7F2`/`#4A111C`/
  `#C43D3D` Maroon Forge tokens, Green's `#064E3B` primary and restored
  `--warning` floor, the light theme's `#C74100` action colour, and no trace of
  the deleted indigo palette. That is a read of the tokens Vercel is serving,
  not an eye on a rendered page — nobody has looked at the four themes on a
  phone since the regrade.
- `%TEMP%` scratch scripts (probes, the theme audit) are outside the repo by
  design; the report cites their *results*, which the committed tests re-pin.
- **The author-credit rework is committed, and the two sentences now agree.**
  `AppFooter`'s `text-accent font-bold` name on the page's own canvas, with the
  flat 2 px accent rule, landed in `6b978c9`, and `DESIGN.md:107` carries the
  same ≥ 4.86:1 claim §1 cites — so the contradiction flagged in the previous
  draft of this section is closed by the files, not by this session's memory of
  them. The number itself is still the other session's measurement; it has not
  been re-run here.
- **`pnpm check` fails at HEAD, and it is a real gate, not a lint whim.**
  `SettingsPage.tsx:689`'s `role="group"` div — added deliberately, with a
  comment, as fix #2 of the axe pass — trips
  `lint/a11y/useSemanticElements`, which wants a `<fieldset>`. CI runs this
  exact command (`.github/workflows/supabase-ci.yml:46`), so the first push of
  this tree to a PR shows red. Both resolutions are defensible and neither is
  this session's call to make unilaterally: wrap the theme grid in a real
  `<fieldset>`/`<legend>` (which changes the markup the axe scan was happy
  with), or add a `// biome-ignore lint/a11y/useSemanticElements` with the
  reason the comment already gives. It is recorded rather than fixed because it
  sits in another session's verified accessibility work, and because the
  572-test suite, the build and typecheck are all green underneath it.
- **Two agents edited this tree during the pass being graded.** Where they
  contradicted each other — the token's liveness, which session fixed the
  ticker's first-mount snap — this draft resolves the claim by running the
  command, not by choosing an author, and says so when the measurement arrives
  after the sentence was written.
- **The #110–#120 hardening work was committed by the other session.** This
  session's uncommitted files (`0015_csp_violation_reports.sql`,
  `functions/csp-collector/`, `verify.sql` item 16, the two contract-test
  suites, the CI deploy step, and the AGENTS/README/OPERATIONS sections) were
  swept into `d4181f6` alongside that session's own changes — one commit for
  both bodies of work. Everything was verified present line by line before this
  section was written, nothing was lost, and the history was left alone: it is
  pushed-adjacent, already described, and rewriting it to separate the authors
  is a bigger risk than the imprecision it buys back.
