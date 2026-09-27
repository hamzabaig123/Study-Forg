# Deploying StudyForge — GitHub → Vercel

The frontend is a static Vite build, so Vercel hosts it and **every push to
GitHub redeploys automatically** — no manual upload, ever. The database, auth,
and the AI proxy stay on Supabase; Vercel only serves the app.

---

## 1. Push the app to GitHub

The repo currently has no remote. Create an empty repository on GitHub (no
README, no .gitignore — the repo already has both), then:

```bash
cd "D:\class 11 app\study fork"
git remote add origin https://github.com/<your-username>/studyforge.git
git push -u origin master
```

Everything the app needs is committed. What is deliberately **not** in git:
`src/frontend/.env.local` (local keys), `supabase/.env` (DB password), and
`supabase/backup/snapshots/` (your data) — those stay on this machine.

## 2. Import into Vercel

1. vercel.com → **Add New… → Project** → pick the `studyforge` repo.
2. **Framework Preset**: Vite (usually auto-detected).
3. **Root Directory**: `src/frontend` ← important, the app lives in a subfolder.
4. **Build Command**: `pnpm build` · **Output Directory**: `dist` (defaults).
5. Under **Environment Variables**, add all three for *Production, Preview, and
   Development*:

| Name | Value |
| --- | --- |
| `VITE_DATA_BACKEND` | `supabase` |
| `VITE_SUPABASE_URL` | `https://qjoijoxmnliarlyaqmoz.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the publishable key from `src/frontend/.env.local` |

These are build-time values: the URL and key are the *publishable* pair, which
is designed to ship in the browser — the database itself is protected by row
level security. The `VITE_SUPABASE_URL` variable also feeds the build-time
Content-Security-Policy, so leaving it unset would make the deployed app block
its own Supabase calls.

6. **Deploy**. First build takes a couple of minutes.

## 3. Tell Supabase where the app now lives

Auth emails point back at the app, so the confirmation link must land on your
Vercel domain:

1. Supabase → Authentication → **URL Configuration**.
2. **Site URL**: `https://<your-project>.vercel.app` (your final domain when
   you add one later — update this then).
3. **Redirect URLs**: add the same URL.

Without this, sign-up on the deployed app still works but the confirmation
email sends the user to localhost.

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
| The app (static bundle) | Vercel | SPA routing handled by `src/frontend/vercel.json` |
| Database, auth, RPCs, rate limits | Supabase | row level security protects everything |
| `ai-proxy` (server-side AI) | Supabase Edge Functions | deploy separately; needs `GEMINI_API_KEY`/`OPENROUTER_API_KEY` in Edge Function secrets |
| Daily email/report + E2E checks | your machine while the app is open | see Settings → Reminders, `e2e/` |

## Gotchas already handled

- `src/frontend/vercel.json` rewrites deep links (`/dashboard`, `/analytics`,
  …) to `index.html` — without it, refreshing any page on Vercel would 404.
- `src/frontend/env.json` stays at its committed placeholders: it configures
  the canister path, which the deployed app does not use.
- The caffeine credit is gone; the footer reads "© <year> StudyForge".
- If a deployment fails, check Vercel's build logs first — the usual cause is a
  missing environment variable, and the log names exactly which one.
