# StudyForge — Project Report

*2026-09-29 · Scope: the whole tree after the four-theme + motion pass, the live
Supabase project (`qjoijoxmnliarlyaqmoz`), and the deployed origin
(`study-forg-frontend-100.vercel.app`). Every number below came from a command
that ran in this session; where something could not be executed from this
machine, it is marked unproven rather than graded. Letter grades continue the
`GRADING-REPORT.md` scale; the /10 table they descend from lives in
`HARDENING-REPORT.md` §3.*

## 1. What this pass shipped

**Four themes, three wire names.** `light` (Vanilla & Burnt Orange), `dark`
(Graphite & Lime), `frosted` (Green — Emerald Ink & Champagne), and a new
`maroon` (Maroon Forge). `frosted` keeps its stored name because it is persisted
`user_settings.appearance` data; `maroon` is a new stored value, so
`supabase/migrations/0012_maroon_appearance.sql` widens the column's CHECK —
written, verified against the live database, and **not yet applied** (§3).
Every token value in `DESIGN.md` is now the hex the running app actually
paints, measured with a canvas audit rather than remembered, and the contrast
floors are met in all four themes (body ≥ 11.9:1, muted ≥ 5.1:1, action text on
fill ≥ 4.53:1, `text-warning` ≥ 4.71:1, chart series ≥ 3:1 on card). The
light theme's long-standing 2.18:1 `--warning` miss is fixed by the same pass.

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
`transition: all`; the footer is one `AppFooter` everywhere, crediting the
author under a hairline that draws in from the left.

**This session's polish.** Two smoothness fixes on top of that pass, both
unit-verified: `NumberTicker` counted nothing on first mount (it started from
`from === value`, so a freshly opened score snapped instead of climbing — the
climb is the point), and `BlurFade`'s focus pull animated a filter over the
whole question-review subtree, which is where a forty-question list would
start to stutter; tall containers now set `blur={false}` and arrive on rise
and fade alone.

## 2. Gates, re-run on this tree (2026-09-29)

| Gate | Result |
| --- | --- |
| `pnpm test` | 59 files, **491 tests passed** (was 482) |
| `pnpm typecheck` | 0 errors |
| `biome check src` | 221 files, clean |
| `pnpm build` | exit 0; entry 1.34 MB (394 KB gzip), Motion chunk separate |
| `darkMode` in built CSS | `:where(.dark,.dark *)` only — no theme-shaped selector |
| Deployed origin headers | `content-security-policy`, `strict-transport-security`, `x-content-type-options`, `x-frame-options: DENY` — **all measured live today** (this closes `HARDENING-REPORT.md` §2.3's "pending deploy") |

## 3. Supabase state, measured today

Migrations 0001–0011: applied and previously verified item by item
(`HARDENING-REPORT.md` §2.8). **0012 is not applied.** Proven live: signing in
as the demo account and inserting its own `user_settings` row with
`appearance = 'maroon'` is refused `23514 … check constraint
"user_settings_appearance_check"`. Until the paste, the Maroon Forge theme
works fully device-local and only the account sync of that one value fails —
but it does fail, and that is the difference between Database A++ and A+.

The probe needed a credential this session did not have: the one `sbp_`
personal access token on disk is the documented-dead one (401 on
`/v1/projects`), and the database password was never written anywhere. The fix
is one paste by a human who has the dashboard open (§6).

## 4. Grades

`A++` = executed, observed, nothing known broken. `A` = proven, with a named
gap that is not a defect. Below that, something is unproven or unfixed.

| Area | Grade | Was (09-28) | Earned from | What stops the next step |
| --- | --- | --- | --- | --- |
| **Database** | **A+** | A++ | 0001–0011 live and verified; today's 0012 probe executed against the real constraint rather than assumed | One additive migration written and not applied — a 30-second paste closes it |
| **Authentication** | **A** | A | Nothing changed in this pass; `auth-flow.mjs` 13/13, branded mail live, password floor 10 enforced both sides | HIBP plan-gated; `From` address is the authenticating Gmail account until the relay gets a verified domain |
| **Cybersecurity** | **A+** | A+ | The header policy is now **served** (measured on the deployed origin today), not merely committed; forged-address throttle and TRUNCATE lockdown hold with permanent probes | The credential rotation from §5 of the hardening report is still open — the `sbp_` token is dead by measurement, which is half of that item done |
| **Frontend & UX** | **A** | A | 491 tests, biome clean, build green, the four themes and the motion pass all in the suite's reach | The canister half of the surface cannot run here; this session's two polish edits are unit-verified but not browser-visually re-verified |
| **Motion & theming** | **A-** | — (new area) | Motion contract test pins lazy-loading, reduced-motion coverage and reachability; contrast floors measured per theme on the running app; built CSS proves `.dark` is the only dark canvas | 0012 pending (account sync of `maroon`); no fresh browser walk of the new palettes on real screens since the regrade |
| **Backend (canister + adapter)** | **B+** | B+ | 77-method adapter, 19/19 live sweep, 12 refusals documented | `backend.wasm` remains a trusted binary — no `dfx`/`mops` on this machine |
| **Testing & QA** | **A** | A- | 491 green including the motion surface contract and the theme-string pins in both test suites | The live sweep is hand-run (needs a service key), not CI — see Operations |
| **Operations & CI** | **B-** | C | Push → Vercel → headers measured live on the deployed origin today; `vercel.json` carries the policy; DEPLOY.md is truthful | No backup has ever been dumped or restored; no CI pipeline has ever run; the drift guards only bite a human who runs them |
| **Whole product** | **A-** | A | Everything above | The one regression risk in the tree is a migration not pasted yet; the one standing exposure is un-rotated credentials |

## 5. Overall

**A-.** The ceiling moved from "nothing proven against production" to the
opposite problem: nearly everything *is* proven, and what remains is one
30-second paste, one credential-rotation session, and one backup drill. The
code is not the bottleneck; the dashboard is.

## 6. Your moves, in order

1. **Paste `supabase/migrations/0012_maroon_appearance.sql` into the Supabase
   SQL editor** (or hand this session the database password / a fresh personal
   access token and it runs `apply-migration.mjs`'s route itself). Re-running
   the probe afterwards should report `0012-APPLIED`.
2. **Rotate credentials**: Gmail app password, Brevo/Resend key, database
   password, service key, both AI provider keys. The dead `sbp_` token should
   also be deleted from the dashboard's token list.
3. **One backup → restore drill** (`supabase/OPERATIONS.md`) — the last
   "written but never executed" claim in the report.
4. Optional: a browser walk of the four themes on a real phone width, and the
   results page at exactly 75 % to see the confetti threshold.

## 7. Not counted, stated honestly

- The Internet Identity path still cannot be executed on this machine (no
  virtualization → no `dfx`) — typecheck- and unit-verified only.
- The two motion polish edits were verified by the suite and the contract
  tests, not by eyes on a running browser; the previous session's measured
  contrast audit covers the palettes, not this session's timing changes.
- `%TEMP%` scratch scripts (probes, the theme audit) are outside the repo by
  design; the report cites their *results*, which the committed tests re-pin.
