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
| **Database** | **A++** | A++ | 0001–0012 all live; today's migration applied from this machine and read back four ways — constraint text, a `maroon` write that returned `23514` an hour earlier and `maroon accepted` now, no row left changed, battery 31/31 after | Nothing in the schema. The area's remaining unknown is not the schema but the recovery story: no backup has ever been dumped or restored |
| **Authentication** | **A** | A | Nothing changed in this pass; `auth-flow.mjs` 13/13, branded mail live, password floor 10 enforced both sides | HIBP plan-gated; `From` address is the authenticating Gmail account until the relay gets a verified domain |
| **Cybersecurity** | **A+** | A+ | The header policy is **served** (measured on the deployed origin), the forged-address throttle and TRUNCATE lockdown hold with permanent probes, and the battery re-passes after a schema change rather than only before one | The credential rotation in §6 — and it is now measurably *worse* than the last draft claimed: the `sbp_` token on disk answers `200` on `/v1/projects` and administers every project on the account |
| **Frontend & UX** | **A** | A | 491 tests green re-run on the pushed tree, biome and typecheck clean, build green, the four themes and the motion pass all inside the suite's reach | The canister half of the surface cannot run here; the ticker fix was measured in headless Edge, the `blur={false}` change was not re-measured in a browser |
| **Motion & theming** | **A** | — (new area) | Motion contract test pins lazy-loading, reduced-motion coverage and reachability; contrast floors measured per theme on the running app; built CSS proves `.dark` is the only dark canvas; `--scrim` gained a real consumer and the dead duplicate palette is gone; the count-up is now measured monotone 0 → 88 | 0012 was this area's blocker and it is closed. What is left is a real-device walk: the palettes are canvas-audited on the running app, not screenshot-compared at 320/390 px since the regrade |
| **Backend (canister + adapter)** | **B+** | B+ | 77-method adapter, 19/19 live sweep, 12 refusals documented | `backend.wasm` remains a trusted binary — no `dfx`/`mops` on this machine |
| **Testing & QA** | **A** | A- | 491 green including the motion surface contract and the theme-string pins in both suites, re-run after the last colour change rather than before it | The live sweeps are hand-run (they need a service key), not CI — see Operations |
| **Operations & CI** | **B** | C | Push → Vercel → headers measured on the deployed origin; `vercel.json` carries the policy; DEPLOY.md is truthful; **and the "a human must paste it" step disappeared** — 0012 was applied over HTTPS from this machine, verified, and recorded in `supabase/README.md` | No backup has ever been dumped or restored; no CI pipeline has ever run; the drift guards only bite a human who runs them |
| **Whole product** | **A-** | A | Everything above | Two standing risks, both human: un-rotated credentials (one measurably live with account-wide rights) and a recovery path that has never been exercised. Plus one process risk this pass hit directly — two agents in one tree, so a planned three-way commit split landed as one bundled commit |

## 5. Overall

**A-.** The schema layer closed its last gap today, which is why Database is
back at `A++` and Operations moved `B- → B`: nothing in `supabase/migrations/`
is now waiting on a human with the dashboard open. What holds the whole product
under `A` is not code either — it is a recovery path that has never once been
walked, and a set of credentials that were pasted into chat weeks ago and are
still valid (one of them, measurably, has rights over every project on the
account). The bottleneck is the dashboard and the password manager, not the
tree.

## 6. Your moves, in order

1. **Rotate credentials**: Gmail app password, Brevo/Resend key, database
   password, service key, both AI provider keys — and **delete the `sbp_`
   personal access token** in dashboard → Account → API tokens. That last one is
   the priority: an earlier note called it dead, and it is not — `200` on
   `/v1/projects` today, with one project visible and account-wide rights. The
   scratch copy at `%TEMP%\sf-deploy\sb-token.txt` can go the moment it is
   revoked.
2. **One backup → restore drill** (`supabase/OPERATIONS.md`) — the last
   "written but never executed" claim in the report.
3. **Decide what to do about `3edfe5f`.** Every change in §1 is in that one
   commit, and it is already pushed, so the light theme's orange-weight change
   is not separately revertable as planned. `git revert` of the whole commit
   would also undo Maroon Forge and the motion pass. Splitting it means a
   history rewrite on a branch a second agent session is actively working in —
   say the word and it is one careful sequence; otherwise view the slice alone
   with `git show 3edfe5f -- src/frontend/src/index.css` and read the `:root`
   hunk.
4. Optional: a browser walk of the four themes at 320 and 390 px, and the
   results page at exactly 75 % to see the confetti threshold.

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
