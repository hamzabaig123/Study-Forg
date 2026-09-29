# StudyForge E2E checks

Browser-level checks that drive the **real app** — sign-in, dashboard, analytics,
test builder, notes, and the archive importer — using `playwright-core` and the
machine's installed Edge or Chrome. No browser download, no test framework: a
check either passes or prints what failed, and the exit code carries the result.

## Setup

```bash
cd e2e
npm install
```

Point the checks at a running app (dev server or deployment) with a confirmed
account. On Supabase, create one first — the app's own sign-up flow or the
dashboard's auth admin.

```bash
BASE_URL=http://localhost:5173 \
DEMO_EMAIL=demo@studyforge.test \
DEMO_PASSWORD='…' \
node app.live.cjs
```

On Windows the Edge path is auto-detected; override with `EDGE_PATH` if Edge
is not installed (any Chrome works: `EDGE_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"`).

## Running it without an account: `SEED_LOCAL=1`

Most of these checks assert on *data* — an attempt history, a percentage, the
accuracy hero — so a fresh profile proves nothing and a seeded one needs
credentials. `SEED_LOCAL=1` builds that data through the UI instead, on the mock
(localStorage) backend, in a throwaway browser context:

```bash
# from the repo root, in one terminal:
cd src/frontend && VITE_DATA_BACKEND=mock pnpm dev
# in another:
cd e2e && SEED_LOCAL=1 BASE_URL=http://localhost:5173 node app.live.cjs
```

`seed.local.cjs` registers `e2e+<timestamp>@studyforge.test` (password floor of
10 characters, confirmed with the verify-email screen's local **Confirm this
email** button), builds *E2E Organic Chemistry → E2E Bonding → E2E Covalent
bonds → E2E Molecular shape* one dialog at a time, authors three multiple-choice
and two true/false questions, then runs a practice session and answers all five
correctly. Nothing is injected into `localStorage` from outside, which is the
point: the run exercises form validation, the Radix dialogs, the mock canister's
methods and the merged analytics in one trip. The practice run is scored 5/5 by
the app's own grader before any check reads the dashboard.

It is mock-only on purpose. Against a Supabase or canister build
`registerAndConfirm` throws `the verify-email screen offers no local confirmation
button — this build is not on the mock backend` rather than signing up a real
account. Use the credential path for a deployed app.

**A build cannot be mock, so this is a dev-server path — measured, not assumed.**
`VITE_DATA_BACKEND=mock vite build --mode development` does inline `"mock"` into
the bundle, yet `selectDataBackend()`
(`src/frontend/src/lib/supabase/env.ts:119`) throws a mock selection away
whenever `import.meta.env.PROD` is true — which is *every* `vite build`, dev-mode
included, because `PROD` means "not `vite serve`" rather than "mode is
production". It falls through to the configured real backend so a stray mock
bundle can never persist somebody's account in their browser. Running the seed
against `vite preview` therefore reached `/verify-email` on the **Supabase**
backend, and the mock-only guard above refused to continue — the correct outcome:
no sign-up, no row, no write to the live project. The built artifact is checked
with credentials against a deployment; the seed is checked against `pnpm dev`.

First run of this path: 2026-09-30, **34 checks, all green, zero page errors**
across the ten-route tour (`/dashboard /classes /analytics /test-builder /notes
/ai-studio /share /export /qr /settings`).

## What each check covers

| Script | Covers |
| --- | --- |
| `seed.local.cjs` | provisioning, not checking: register → confirm → class chain → five questions → a graded practice session. Debug it a stage at a time with `UNTIL=register\|hierarchy\|questions\|session` against a dev server. |
| `app.live.cjs` | sign-in (or the seed above) → dashboard (accuracy hero, streak, no third-party credit) → the seeded class listed on `/classes` → analytics (history, percentages) → test builder (modes, shuffle) → notes workspace → a ten-route tour where each route must fill its content region and mount inside the entrance transition → zero page errors |
| `import.live.cjs` | the localStorage-mock → Supabase migration path: plants a mock archive, signs in, runs Settings → "Move data from this browser", asserts the report (create + dedupe paths) |

## When to run

- After any change to the session, analytics, or settings surfaces.
- After applying a new migration (`supabase/e2e/apply-migration.mjs`, then the
  replay sweep, then these).
- As the browser leg of CI once a project is wired up — see
  `.github/workflows/supabase-ci.yml`.
