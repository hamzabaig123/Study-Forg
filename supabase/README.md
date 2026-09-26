# Supabase data layer

The app's real database: one Postgres schema with row level security, replacing
the localStorage archive the app used when there was no server.

| Path | What it is |
| --- | --- |
`migrations/0001_init.sql` | 18 tables, FK cascades, checks, RLS, the token-addressed public functions, and the atomic `start_session` / `submit_answer` / `complete_session` / `dashboard_stats` functions
`verify.sql` | Seven read-only checks that prove the security claims instead of asserting them
`.env.example` | Copy to `.env` and fill in. **`.env` is git-ignored and must stay that way**

## Apply the migration

The development machine for this project has no `psql`, `dfx`, Docker or WSL2, so
the SQL cannot be applied from here. Run it once in the dashboard:

1. Supabase → your project → **SQL Editor** → New query.
2. Paste all of `migrations/0001_init.sql`, then **Run**. It is one script; if it
   aborts, fix the reported line and re-run from the top after
   `drop schema public cascade; create schema public; grant usage on schema public to anon, authenticated;`.
3. Run all of `verify.sql` and read each result against its comment. Check 4
   (`role_table_grants` for `anon`) returning zero rows is the one that matters
   most: it is what makes the publishable key safe to ship in the browser.

## Running the app against it

Three variables decide what the browser talks to, all read once in
`src/frontend/src/lib/supabase/env.ts`:

| Variable | Effect |
| --- | --- |
`VITE_DATA_BACKEND` | `mock`, `supabase` or `canister`. Wins over everything below
`VITE_USE_MOCK` | `true` keeps the localStorage archive and the browser-side accounts
`VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` | Both present and complete, with no flag set, selects Supabase

With nothing set and no key pasted, the app is exactly what it was before: the
mock on the dev server, the canister in a production build. A truncated key paste
is reported on the sign-in screen rather than sent on every request, which is the
most common way a configured project appears to do nothing.

Supabase replaces the browser-side accounts, so `AuthPage` shows the same
email/password form but reads and writes a real session (`lib/supabase/session.ts`)
— the id inside that session is what `auth.uid()` compares against in every RLS
policy. Set the project's **Site URL** to the deployed origin if you want the
confirmation link to land back on the app, and note that with "Confirm email" on,
sign-up returns no session until the link is clicked.

## What is not done yet

Stated plainly because each item needs the project itself, not this machine:

- The migration has never been applied. Until step 2 above happens on
  `qjoijoxmnliarlyaqmoz`, `VITE_DATA_BACKEND=supabase` reaches an empty database
  and every call fails with a missing-table error.
- No query has run against real Postgres. The adapter is proven against a fake
  transport that answers in PostgREST's shapes (`lib/supabase/adapter.test.ts`,
  41 cases) and against `backendInterface`'s 77 methods through `tsc`; the SQL
  functions beside it are reviewed, not executed.
- Nothing moves the existing localStorage archive into the new schema, so an
  account with data in it today cannot switch over yet.
- Backups, PITR and the restore drill are written down below but unpractised, and
  the Free plan caps the database at a seven-day PITR window.

## Which URL goes where

Getting this wrong is the usual way a project ends up with a database password
in a client bundle.

| Value | Where it belongs | Why |
| --- | --- | --- |
Project URL `https://<ref>.supabase.co` | `src/frontend/.env.local` as `VITE_SUPABASE_URL`, and the deployment environment | Public. PostgREST/Auth endpoint
**Publishable** key (`sb_publishable_…`) | `src/frontend/.env.local` as `VITE_SUPABASE_ANON_KEY`, and the deployment environment | Public by design. RLS is the access control, not this key
**Service role** key | Nowhere in this repo, and never in a `VITE_*` variable | Bypasses RLS entirely. If it appears in a bundle, every account's data is readable by anyone with the URL
DB password / `postgresql://…` URL | `supabase/.env`, which is git-ignored | Only `pg_dump`, `pg_restore` and psql need it — that is admin tooling, not the app

Use `supabase/.env` for backups and set `DB_PASSWORD` there; do not put it in
`src/frontend/.env.local`, because every `VITE_`-prefixed value is compiled into
the JavaScript we ship.

## Connection string

The direct-connection string is
`postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres`
— note the database is `postgres`, and the username is `postgres.<project-ref>`.
For scripted backups use the **session pooler** host (same as direct) so
`pg_dump` gets a stable connection; the transaction pooler breaks dumps because
it cannot hold the advisory locks `pg_dump` takes.
