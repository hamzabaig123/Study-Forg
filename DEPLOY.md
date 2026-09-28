# Deploying StudyForge — GitHub → Vercel

The frontend is a static Vite build, so Vercel hosts it and **every push to
GitHub redeploys automatically** — no manual upload, ever. The database, auth,
and the AI proxy stay on Supabase; Vercel only serves the app.

---

## 1. Push the app to GitHub

`origin` is already wired to `https://github.com/hamzabaig123/Study-Forg.git`,
and `master` is in sync with it, so this section is only for a fresh clone:

```bash
cd "D:\class 11 app\study fork"
git remote add origin https://github.com/<your-username>/studyforge.git
git push -u origin master
```

What is deliberately **not** in git: `src/frontend/.env.local` (local keys),
`supabase/.env` (DB password), and `supabase/backup/snapshots/` (your data) —
those stay on this machine.

## 2. Import into Vercel

1. vercel.com → **Add New… → Project** → pick the `studyforge` repo.
2. **Root Directory**: leave it **empty** (the repository root) ← this is the
   one setting that decides whether the rest works. `vercel.json` is read from
   the Root Directory, and the install/build/output settings that survive
   drift between the dashboard and the repo live in `vercel.json` at the root.
   Pointing the Root Directory at `src/frontend` makes Vercel run
   `cd src/frontend && pnpm install`, which is the command that fails: the
   workspace root — and therefore the root `package.json`, `pnpm-lock.yaml` and
   the root `devDependencies` — is still installed from there (pnpm walks up to
   the workspace), but Vercel never reads the root `vercel.json` that carries the
   working install command.
3. **Framework Preset**: Vite. The commands below come from `vercel.json`; if
   the dashboard shows different values, clear them so the file wins:

   | Setting | Value |
   | --- | --- |
   | Install Command | `pnpm install --no-frozen-lockfile` |
   | Build Command | `pnpm --dir src/frontend build` |
   | Output Directory | `src/frontend/dist` |

4. Under **Environment Variables**, add all three for *Production, Preview, and
   Development*:

| Name | Value |
| --- | --- |
| `VITE_DATA_BACKEND` | `supabase` |
| `VITE_SUPABASE_URL` | `https://qjoijoxmnliarlyaqmoz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the publishable key from `src/frontend/.env.local` |

These are build-time values: the URL and key are the *publishable* pair, which
is designed to ship in the browser — the database itself is protected by row
level security. Vite inlines them into the bundle at build time, so without
them the deployed app renders the "backend not configured" screen instead of
the dashboard. `VITE_SUPABASE_URL` also narrows the build-time
Content-Security-Policy to your exact project origin; with no URL the policy
falls back to `https://*.supabase.co`, which still works but names every
project on the platform.

5. **Deploy**. First build takes a couple of minutes.

### If the build fails at install

Two separate failures are possible here, and both were reproduced locally before
being fixed. If a deploy breaks with `Command "… pnpm install" exited with 1`,
it is one of them:

- **`@dfinity/pic` postinstall.** The root `devDependencies` include it, and its
  install script downloads a ~50 MB PocketIC binary (on Windows it throws
  `Unsupported platform: win32` outright). The backend test lane talks to a
  sidecar and never starts that server, so the binary is dead weight. It is
  declined by `pnpm.neverBuiltDependencies` in the root `package.json` — which
  is the key that works on the pnpm generation pinned by `"packageManager":
  "pnpm@9.15.9"`; `ignoredBuiltDependencies` in `pnpm-workspace.yaml` is the
  pnpm 10 spelling and pnpm 9 ignores it. Both are present, so the install is
  fine whichever generation corepack runs.
- **`ERR_PNPM_OUTDATED_LOCKFILE`.** `frozen-lockfile` defaults to **true** in
  CI, so `package.json` and `pnpm-lock.yaml` must be committed in sync or a bare
  `pnpm install` exits 1. `--no-frozen-lockfile` in the install command gets the
  deploy built regardless. It was needed for real: `@icp-sdk/auth` was dropped
  from `src/frontend/package.json` — nothing has ever imported it, `git log -S`
  on `src/frontend/src` comes back empty — without the lockfile being
  regenerated, so every frozen install failed on it: Vercel, and
  `.github/workflows/supabase-ci.yml`, which runs a bare `pnpm install`.
  `pnpm install --lockfile-only` regenerates it (the package stays in the
  lockfile as a transitive dependency of `@caffeineai/core-infrastructure`,
  which is why only three lines move). The durable rule: when a dependency is
  added or removed, run that command and commit `pnpm-lock.yaml` in the same
  commit as the `package.json`.

## 3. Tell Supabase where the app now lives

Auth emails point back at the app, so the confirmation link must land on your
Vercel domain:

1. Supabase → Authentication → **URL Configuration**.
2. **Site URL**: `https://study-forg-frontend-gk2p-rose.vercel.app` (update this
   when the production domain changes — the Site URL has to match wherever the
   app actually lives).
3. **Redirect URLs**: add the same URL.

Without this, the deployed app still works but every auth link lands on
localhost, because that is what the Site URL says. The app now asks for the
origin it is running on with **all three** links — password reset, sign-up
confirmation and its re-send — so the Site URL is the fallback rather than the
only thing that decides where a visitor ends up. The allow-list is not a
fallback: an origin that is not listed there is refused outright, so add the
Vercel domain *and* `http://localhost:5173` (the dev server's port) here.

> Measured 2026-09-28: the domain above answers **HTTP 404**, so nothing is
> deployed at it right now. Until a push rebuilds it, the only origin a link can
> land on is a dev server that is actually running — and because GoTrue spends
> the token while it builds that redirect, tapping a link with no server behind
> it burns the link as well as failing. See `supabase/README.md` → *Auth settings
> a deployed project needs*.

## 4. How updates work (the part you asked about)

After this one-time setup, deployment is automatic:

- `git push` → GitHub notices → Vercel builds → your changes are live in
  ~1–2 minutes.
- Every pull request also gets its own preview URL, so you can look at a
  change before merging it.
- You never "deploy" manually again; if a push turns out to be broken, the
  Vercel dashboard lets you roll back to the previous deployment with one
  click.

To change the app, edit files → commit → push:

```bash
git add <files>
git commit -m "Describe the change"
git push
```

## 5. What runs where

| Piece | Hosted on | Notes |
| --- | --- | --- |
| The app (static bundle) | Vercel | SPA routing handled by the root `vercel.json` |
| Database, auth, RPCs, rate limits | Supabase | row level security protects everything |
| `ai-proxy` (server-side AI) | Supabase Edge Functions | deploy separately; needs `GEMINI_API_KEY`/`OPENROUTER_API_KEY` in Edge Function secrets |
| Daily email/report + E2E checks | your machine while the app is open | see Settings → Reminders, `e2e/` |
| Speed Insights (real-user performance) | Vercel | Enable **Speed Insights** for the project in the dashboard; the app loads `/_vercel/speed-insights/script.js` itself, so no key or env var is needed |

## Gotchas already handled

- The root `vercel.json` rewrites deep links (`/dashboard`, `/analytics`, …) to
  `index.html` — without it, refreshing any page on Vercel would 404.
  `src/frontend/vercel.json` holds the same rewrite and is simply not read while
  the Root Directory is the repo root; it only matters if someone moves the Root
  Directory, which is the layout that fails at install (see above).
- That catch-all is **not** a bare `/(.*)`. It excludes `_vercel/` on purpose:
  Speed Insights loads `/_vercel/speed-insights/script.js` and posts vitals to
  `/_vercel/speed-insights/vitals`, and neither is a file in `dist/` — they are
  platform routes. A catch-all that matches them answers with `index.html`, and
  the browser then parses HTML as JavaScript (`SyntaxError: Unexpected token
  '<'`) while the dashboard reads "no data". The other exclusions (`assets/`,
  `icons/`, `favicon.ico`, `manifest.webmanifest`, `sw.js`, `theme-bootstrap.js`,
  `env.json`) keep the PWA, the theme bootstrap and the canister config out of
  the rewrite's reach too. Add a path here rather than widening the pattern.
- `src/frontend/dist` is gitignored, so Vercel always rebuilds it. A local
  `dist/` can therefore be stale: check that the CSP in `dist/index.html` names
  `https://va.vercel-scripts.com` before trusting a local preview to match the
  deploy.
- `dist/_headers` is a build artifact the CSP plugin writes next to the bundle,
  and Vercel *does* read it, so the directives a `<meta>` cannot carry —
  `frame-ancestors`, `Strict-Transport-Security`, `X-Content-Type-Options` — are
  live on Vercel. The same file is inert on the caffeine host, which has no
  header surface. That is a real difference between the two deploys, not a
  detail: on Vercel the app is protected against being framed.
- `src/frontend/env.json` stays at its committed placeholders: it configures
  the canister path, which the deployed app does not use.
- The caffeine credit is gone; the footer reads "© <year> StudyForge".
- If a deployment fails, read the Vercel build log: a failure before the
  `vite build` line is one of the two install failures above, and a failure
  after it is the application, not the pipeline.
