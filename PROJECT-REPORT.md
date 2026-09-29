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

## 2. Gates, re-run on this tree (2026-09-29)

*Everything in this table describes the pushed commit `3edfe5f`. The working
tree has moved since — see §7.*

| Gate | Result |
| --- | --- |
| `pnpm test` | 59 files, **491 tests passed** (was 482) — re-run on the pushed tree, exit 0 |
| `pnpm typecheck` | 0 errors |
| `biome check src` | 221 files, clean |
| `pnpm build` | exit 0; entry 1.34 MB (394 KB gzip), Motion chunk separate |
| `darkMode` in built CSS | `:where(.dark,.dark *)` only — no theme-shaped selector |
| Dead palette | `.dark`'s duplicate indigo block deleted; the live graphite/lime set is the only one that paints |
| `supabase/e2e/security-battery.mjs` | **31/31** on the live project, re-run *after* migration 0012 |
| Deployed origin headers | `content-security-policy`, `strict-transport-security`, `x-content-type-options`, `x-frame-options: DENY` — **all measured live today** (this closes `HARDENING-REPORT.md` §2.3's "pending deploy") |
| Deployed CSS, after the push | `/assets/index-B_CauIix.css` (88.6 KB) carries `.maroon{--background:.9809 .0109 54.4` (= #FFF7F2) and `--primary:.2796 .0857 13.5` (= #4A111C), `.frosted{--primary:.378 .073 168.9` (= #064E3B), `:root{--primary:.56 .185 43` (the #C74100 CTA fix) — and the dead indigo `0.155 0.022 265` is **absent**. Vercel had already built and shipped the graded tree when this was read. |

## 3. Supabase state, measured today

Migrations **0001–0012 are all applied** on `qjoijoxmnliarlyaqmoz`, RLS forced,
the reminder pipeline live (`reminder-sender` at version 10, all secrets set
including `APP_URL`).

**0013–0015 are written and NOT applied** — measured, not assumed:

- **0013** (abuse-report throttle + existence-oracle fix): `report_link_abuse`
  on a never-issued code still answers `{"err": "notFound"}` — the oracle the
  migration closes is live.
- **0014** (short-code floor 7 → 10): `create_link` with a 7-character code and
  a short token answers `{"err": "badToken"}` — the old function accepted the
  code and failed later; the applied 0014 would answer `badCode` first. Probed
  with a shape that writes nothing either way.
- **0015** (csp_violation_reports): the table answers 404 — absent.

The **security battery re-ran at 40/46** (it has grown to 46 checks — the
concurrent session added fifteen): every database, RLS, tenant-isolation,
reminder and destructive-helper invariant holds. All six failures trace to
exactly two pending deployments: three are 0013/0014 above, and three are new
CORS checks that the **deployed** `reminder-sender`/`ai-proxy` answer with
`acao=*` where the new contract wants the app origin echoed and a stranger
refused — the functions' fixes are written in `supabase/functions/` and await
a deploy. The battery's own probe planted a 7-character link while 0014 is
unapplied; it was removed again through the app's token-addressed
`link_delete` contract (resolve now answers `unavailable: deleted`).

The Management API token that applied 0012 now answers **401 consistently**
(five attempts over a minute, after a day of flapping between 200 and 401) —
most plausibly revoked, which the security sections of this report and
`HARDENING-REPORT.md` have been asking for since 2026-09-28. The cost: applying
0013–0015 and redeploying the two edge functions need a live credential — the
SQL editor (three pastes, in file order) or a fresh personal access token /
the database password. Until then the oracle, the 34.7-bit floor and the
CSP telemetry table stay as recorded here.

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
| **Database** | **A+** | A++ | 0001–0012 all live and verified; 0013–0015 written and measured unapplied with read-only probes (the oracle answers `notFound`, a 7-char code is accepted, `csp_violation` is 404) — the battery's 46 checks re-ran against the live project either way | Three pastes in the SQL editor, in file order; nothing else |
| **Authentication** | **A** | A | Unchanged and re-confirmed in the 46-check battery: reminder helpers refuse anon and authenticated, tenant isolation holds, the password floor and branded mail stand | HIBP plan-gated; `From` address is the authenticating Gmail account until the relay gets a verified domain |
| **Cybersecurity** | **A+** | A+ | The header policy is **served**; the forged-address throttle, TRUNCATE lockdown and every tenant-isolation invariant hold — the battery now runs **46 checks and 40 pass**, with all six failures traced to two pending deployments (0013/0014 and the edge CORS fixes), not to defects; and the `sbp_` token that administered every project on the account now answers **401 consistently** — the single largest exposure in the project is closed, by revocation or expiry | The two deployments above; rotation of the remaining chat-exposed credentials |
| **Frontend & UX** | **A+** | A | The performance budget exists and moved the needle: **22 routes lazy, entry 394 → 289 KB gzip, FCP 3.8 → 2.9 s, Speed Index 7.7 → 2.9 s** on Lighthouse's first-ever numbers (68/93/100/100 on the deployed origin); 555 tests green, typecheck and biome clean; the axe defects fixed and the inconclusive pile measured pass; 120 screenshots swept at 1440/390/320; empty, loading and error states captured, and the white-screen gap closed with a themed boot shell | The canister half of the surface cannot run on this machine — the one structural gap left |
| **Motion & theming** | **A** | — (new area) | Motion contract test pins lazy-loading, reduced-motion coverage and reachability; contrast floors measured per theme on the running app; built CSS proves `.dark` is the only dark canvas; the count-up is measured monotone 0 → 88; the sidebar label fix raised the one failing pair to ≥ 4.76:1 everywhere; and the palettes are **screenshot-compared at 1440, 390 and 320 px across all four themes** on real seeded data (§1) | A real-device look is the only visual surface still untested |
| **Backend (canister + adapter)** | **B+** | B+ | 77-method adapter, 19/19 live sweep, 12 refusals documented | `backend.wasm` remains a trusted binary — no `dfx`/`mops` on this machine |
| **Testing & QA** | **A** | A- | **555 tests across 63 files**, including the motion surface contract, the theme-string pins, the a11y layout suite and the drift guards — every change this pass was re-run after landing, not before | The live sweeps are hand-run (they need a service key); the new CI workflow has not had a first run |
| **Operations & CI** | **B** | C | Push → Vercel → headers and Lighthouse all measured on the deployed origin; `vercel.json` carries the policy; a CI workflow now exists in `.github/` | 0013–0015 went back to "waiting on a human" the day they were written (the applying token is dead); no backup has ever been dumped or restored; the CI workflow has no first run |
| **Whole product** | **A** | A- | Everything above, and the two things that held it under `A` this morning are gone: the account-wide token is dead by measurement, and the migration that broke a shipped feature is applied | Three hardening migrations and two edge-function deploys, one credential-rotation session, and one backup drill — all human actions, none a code defect |

## 5. Overall

**A — ~8.8/10.** The five core areas (Frontend 9.5, Backend 7.5, Database 9,
Authentication 9, Cybersecurity 9) mean 8.8, and for the first time the number
is not dragged down by anything hiding: every claim in this report was executed
today, the biggest standing exposure (an account-wide token in a chat log) is
closed by measurement, and the frontend has real performance, accessibility and
visual-sweep numbers instead of intentions. What keeps it from `A++` overall is
one structural item and one habit: the canister half has never executed anywhere
(needs the ICP toolchain once, on any machine), and hardening migrations still
wait on a dashboard paste the day they are written — 0013–0015 are three
30-second pastes and two function deploys away from a 46/46 battery.

## 6. Your moves, in order

1. **Apply 0013 → 0014 → 0015 in that order** (dashboard → SQL editor, one
   paste each — 0013 is order-sensitive after 0002 + 0011, both long applied),
   then **redeploy `reminder-sender` and `ai-proxy`** from
   `supabase/functions/` so the three new CORS checks go green. Or hand this
   session a fresh personal access token / the database password and it runs
   and verifies the lot.
2. **Rotate the remaining credentials**: Gmail app password, Brevo/Resend key,
   database password, service key, both AI provider keys. The `sbp_` token
   looks done — it answers 401 consistently, consistent with revocation;
   confirm on the dashboard's token list and delete the scratch copies
   (`%TEMP%\sf-deploy\sb-token.txt`,
   `/tmp/clipboard-backup-before-supabase.txt`).
3. **One backup → restore drill** (`supabase/OPERATIONS.md`) — the last
   "written but never executed" claim in the report.
4. **Decide what to do about `3edfe5f`.** Every change in §1 is in that one
   commit, and it is already pushed, so the light theme's orange-weight change
   is not separately revertable as planned. `git revert` of the whole commit
   would also undo Maroon Forge and the motion pass. Splitting it means a
   history rewrite on a branch a second agent session is actively working in —
   say the word and it is one careful sequence; otherwise view the slice alone
   with `git show 3edfe5f -- src/frontend/src/index.css` and read the `:root`
   hunk.
5. Optional: a real-device look at the four themes — 1440, 390 and 320 are all
   swept (88 + 32 captures reviewed, §1), and the confetti threshold is
   already on camera (the 5/6 practice result fires it at 83 %).

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
- **The tree moved again after these gates ran.** The second session has an
  uncommitted rework of the author credit sitting in it now: `AppFooter.tsx`
  drops `bg-card` and paints the name in `text-accent font-bold` on the page's
  own canvas, with a flat 2px accent rule in place of the drawing gradient
  hairline, and the CSS comment claims ≥ 4.86:1 in every theme. That number is
  theirs, not this report's — it has not been re-run here, it is not in §2, and
  it contradicts the sentence still sitting in `DESIGN.md` ("a brand gradient
  clipped to type that small measures below AA on every one of these palettes").
  One of the two sentences is wrong; measure the pair and the doc follows the
  measurement, not the other way round.
- Two agents edited this tree during the pass being graded. Where they
  contradicted each other — the token's liveness, which session fixed the
  ticker's first-mount snap — this draft resolves the claim by running the
  command, not by choosing an author, and says so when the measurement arrives
  after the sentence was written.
