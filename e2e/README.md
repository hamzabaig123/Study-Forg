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

## What each check covers

| Script | Covers |
| --- | --- |
| `app.live.cjs` | sign-in → dashboard (accuracy hero, streak, no third-party credit) → analytics (history, percentages) → test builder (modes, shuffle) → notes workspace → zero page errors |
| `import.live.cjs` | the localStorage-mock → Supabase migration path: plants a mock archive, signs in, runs Settings → "Move data from this browser", asserts the report (create + dedupe paths) |

## When to run

- After any change to the session, analytics, or settings surfaces.
- After applying a new migration (`supabase/e2e/apply-migration.mjs`, then the
  replay sweep, then these).
- As the browser leg of CI once a project is wired up — see
  `.github/workflows/supabase-ci.yml`.
