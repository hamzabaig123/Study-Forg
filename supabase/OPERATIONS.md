# Operations runbook

Everything here is about the database **after** `migrations/0001_init.sql` has
been applied — README.md covers the schema, the keys and how to apply the
migration. This file covers keeping it alive, proving it still works, and
getting the code from here to there.

Project ref used throughout: `qjoijoxmnliarlyaqmoz` (production). Staging is a
separate Supabase project with its own ref; nothing in this repo points at a
project by URL except `src/frontend/.env.local`, which is git-ignored.

## Where the credentials live

| Credential | Place | Reach |
| --- | --- | --- |
Publishable (anon) key | `src/frontend/.env.local` → `VITE_SUPABASE_ANON_KEY`, and the deployment environment | browser bundle. RLS is the access control |
Service role key | GitHub secrets named `SUPABASE_*_SERVICE_ROLE_KEY` **only**, and `supabase/.env` locally if you insist | bypasses RLS. Never in a `VITE_*` variable, never in a log, never in a PR |
DB password | `supabase/.env` as `DB_PASSWORD` (git-ignored), `SUPABASE_DB_PASSWORD` secret for the backup workflow | `pg_dump` / `pg_restore` / psql only |
`SUPABASE_ACCESS_TOKEN` | the environment for a run, and a GitHub secret | the Management API: `e2e/apply-migration.mjs` locally, `supabase link` / `db push` / `functions deploy` in CI. It administers every project on the account, so it belongs to a run, not to a file
Gemini / OpenRouter keys (for `ai-proxy`) | `supabase secrets set` on the project | the Edge Function's environment. Not readable from the browser |

If a service role key or the DB password has ever been pasted into a chat, a
commit message, or a `VITE_` variable, treat it as leaked: rotate it in the
dashboard (or `supabase management database keys update`) before the next
deploy, then re-run the restore drill below against the new value.

## Backups

Three mechanisms, because they fail differently:

1. **PITR (point-in-time recovery)** — Supabase restores the whole database to
   any second inside the retention window. On the **Free plan that window is
   seven days**, and it is not configurable; a bad migration on day eight is
   not recoverable this way. Enable it under Database → Backups (or buy a
   plan, which is the only way to extend it).
2. **Nightly `pg_dump`** — `.github/workflows/supabase-backup.yml` runs at
   03:17 UTC, stores a custom-format dump as an artifact for 14 days, and then
   runs `pg_restore --list` on it so a truncated dump fails loudly instead of
   sitting there looking like a backup.
3. **`node supabase/backup/backup.mjs`** — dumps every public table to one JSON
   snapshot under `backup/snapshots/` (git-ignored). It is not a substitute for
   either of the above: it carries rows, not the schema, and no sequences,
   indexes or policies. What it is, is readable and diffable by a human, and
   restorable by `backup/restore.mjs` on a machine that has neither `pg_dump`
   nor `pg_restore` — which is the only reason the drill below is executable
   here at all. Run it before and after any risky operation.

Dumps go through the **session pooler** host (identical to the direct
connection string). The transaction pooler cannot hold the advisory locks
`pg_dump` takes, so a dump through it produces a file that restores into
half-populated tables.

Connection string shape:

```
postgresql://postgres.<ref>:<password>@db.<ref>.supabase.co:5432/postgres
```

```bash
# one-off manual dump, using supabase/.env
set -a; . supabase/.env; set +a
pg_dump --format=custom --no-owner --no-privileges \
  "postgresql://postgres.qjoijoxmnliarlyaqmoz:${DB_PASSWORD}@db.qjoijoxmnliarlyaqmoz.supabase.co:5432/postgres" \
  > "manual-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

```bash
# the readable JSON snapshot the drill below restores
SUPABASE_ACCESS_TOKEN=<personal access token> SUPABASE_PROJECT_REF=<ref> \
  node supabase/backup/backup.mjs
```

## Restore drill

**Run it before you need it.** A backup that has never been restored is a
hypothesis, not a backup. Do this quarterly, and after any change to the schema.

There are two dump formats in this project and they restore differently:

| Dump | Written by | Restored by |
| --- | --- | --- |
custom-format `pg_dump` | `.github/workflows/supabase-backup.yml`, or the `pg_dump` one-liner above | `pg_restore --no-owner --no-privileges` — needs `pg_dump`/`pg_restore` on the machine running it, which this one does not have |
JSON snapshot under `backup/snapshots/` | `node supabase/backup/backup.mjs` | `node supabase/backup/restore.mjs` — needs `pg` **or** a Management API token, and nothing else |

The JSON route exists because the drill was never executable on this machine: no
`psql`, no Docker, no `pg_dump`. Run both if you can — the `pg_dump` is the
complete artifact (schema, grants, sequences, everything) and the JSON snapshot
is the one a human can open and diff.

### The direct-Postgres route (one real transaction)

```bash
SUPABASE_DB_URL="postgresql://postgres.<staging-ref>:<password>@<session-pooler-host>:5432/postgres" \
  NODE_PATH=<scratch folder that has pg installed> \
  node supabase/backup/restore.mjs \
    --snapshot supabase/backup/snapshots/<stamp>.json \
    --into <staging-ref> --confirm <staging-ref>
```

`pg` is deliberately not a dependency of this project. Install it in a scratch
folder outside the repo (`npm install pg`) and point `NODE_PATH` at it — the same
dance `e2e/replay-sweep.mjs` documents, and the reason `AGENTS.md` says the
pooler host is the one that resolves here. With `SUPABASE_DB_URL` set the whole
restore runs inside one `begin … commit`, so a failure halfway leaves the target
exactly as it was; the script prints which transport it used.

### The HTTPS route (no driver at all)

```bash
SUPABASE_ACCESS_TOKEN=<personal access token> \
  node supabase/backup/restore.mjs \
    --snapshot supabase/backup/snapshots/<stamp>.json \
    --into <staging-ref> --confirm <staging-ref>
```

The Management API hands **each request a fresh pooled connection**, so
`begin`/`commit` cannot span requests and the restore is posted as one script
instead. That is a weaker guarantee than the driver route: statements the API
already ran are committed. Prefer `SUPABASE_DB_URL` when you have it, and treat
an aborted HTTPS restore as a target to drop rather than resume.

Both routes accept:

- `--dry-run` — the full preflight (tables, columns, emptiness, account
  coverage, FK order) plus the first lines of the SQL, and zero writes. Run this
  first.
- `--into <ref>` / `--confirm <ref>` — the target, twice, and they must agree.
  Required even for a dry run: the script should never guess which project a
  command line means, and the variable that selects one is the same one that
  selected the project you were debugging ten minutes ago.
- `--snapshot <file>` — a specific dump. Without it the newest file in
  `supabase/backup/snapshots/` is used.
- `--create-missing-users` — inserts a password-less, identity-less row in
  `auth.users` for each owner the snapshot names but the target lacks, so the
  rows have a home. **Nobody can sign in as those accounts**, so this proves the
  data shape and nothing more; a real recovery needs the accounts.
- `--allow-nonempty` — truncate the target anyway. For a throwaway project only.
- `--force-into-source` — override the refusal to restore into the project the
  snapshot came from. Read the refusal below twice before using it.

What it refuses, all before writing anything: a target that is not empty
(`--allow-nonempty` excepted), an `auth.users` row missing for an owner
(`--create-missing-users` excepted), a snapshot whose `id` exceeds 2^53 (JSON
numbers would already have lost precision, so it would restore a *different*
row), circular foreign keys, and **its own source project** — restoring over the
database a snapshot came from is not a drill, it is a rewrite of production, and
because the TRUNCATE runs first a mistake there is not caught by a later
failure.

### Then prove the restored database

`restore.mjs` verifies its own write — row count per table, tables without RLS,
tables without FORCE, `anon` table grants — and prints `DRILL PASS` or
`DRILL FAIL`. That is the dump landing, not the app working. Continue in order:

1. `node supabase/e2e/apply-migration.mjs --project <staging-ref>` — asserts the
   first seven of `verify.sql`'s ten checks plus the RLS file in one command, and
   skips the migration because the schema is already there. The two files are
   still worth running in the editor if that command reports something you have
   to look at.
2. `supabase/verify.sql` — fifteen numbered sections, fourteen of which are
   read-only queries; **item 8 is not a query at all**, its own comment explains
   that cross-tenant isolation cannot be checked from the editor (which connects
   as `postgres`, where `auth.uid()` is null and the policies are bypassed) and
   points at step 3 below. Check 4 (`role_table_grants`
   for `anon`) returning **zero rows** is the one that decides whether the
   publishable key is safe to ship.
3. `supabase/tests/rls_cross_tenant.sql` — two fake signed-in tenants in one
   transaction, asserting that A cannot read, update or delete B's rows, that
   an unconfirmed account cannot write, and that the anonymous link functions
   still answer. Everything happens inside `BEGIN … ROLLBACK`, so a run leaves
   no trace.
4. `node supabase/e2e/replay-sweep.mjs` — the write path behind the 77-method
   contract driven through the real client against a real Postgres: it creates
   three throwaway
   accounts (two confirmed through GoTrue's public sign-up plus a direct
   database session, one left unconfirmed on purpose), exercises sessions,
   grading, notes, shares, links, settings and analytics, and deletes all three.
   No service-role key is needed when `SUPABASE_DB_URL` is set; the service role
   is the fallback. Exit 0 means every step matched the adapter's expectations.
   From this machine the fallback is the route that works: `verify.sql` and the
   Management API replaced the pooler harness, and
   `GET /v1/projects/<ref>/database/connection-string` — the endpoint that used
   to build one — answers **404** (see HARDENING-REPORT §2.8). Run it on its own,
   not alongside `security-battery.mjs`: both drive the anonymous `create_link`
   throttle, which counts per client IP in one-minute windows.
5. the app itself: point `src/frontend/.env.local` at staging
   (`VITE_DATA_BACKEND=supabase`), sign in **with an account that exists in the
   snapshot**, and open the dashboard — a count that matches is not the same as
   a page that renders. Then run Settings → *Import archive* with a real exported
   file, the only check that exercises `lib/archiveImport.ts` against Postgres
   rather than the mock.
6. Record the date, the dump used, and any step that failed — then fix the step,
   not the record.

## Edge Function: `ai-proxy`

Deploy and rotate:

```bash
supabase functions deploy ai-proxy --project-ref <ref>
supabase secrets set GEMINI_API_KEY=... OPENROUTER_API_KEY=... --project-ref <ref>
```

The function is `--no-verify-jwt` at the platform level because it verifies the
bearer token itself through `supabase.auth.getUser()`, which also catches a
token whose account was deleted since it was minted. It holds a **sliding
window rate limit of 20 requests per minute per account**, which is per-instance
(in-memory) — good enough to stop one tab hammering a free-tier key, not a
distributed throttle.

Rotating a provider key means: set the new secret, redeploy nothing (secrets are
read at request time), then confirm one extraction from the app. The old key
still has to be revoked at Google/OpenRouter; unsetting a Supabase secret does
not invalidate anything upstream.

The browser only offers this provider when Supabase is both configured and
selected (`SERVER_PROXY_AVAILABLE` in `lib/ai/providers.ts`), so an
unconfigured project shows the same three providers as it always did.

## Staging → production

`.github/workflows/supabase-ci.yml` runs the frontend gates on every PR, and —
only when `SUPABASE_STAGING_PROJECT_REF` is set as a repository variable —
applies `migrations/0001_init.sql` to staging with `psql` when the schema is not
there yet, runs `verify.sql`, hard-asserts that `anon` holds zero table grants,
runs `tests/rls_cross_tenant.sql`, deploys `ai-proxy`, and then runs the replay
sweep. That is the promotion gate: **a migration is only fit for production once
that job is green against a database that has it.**

Production apply stays manual — `node supabase/e2e/apply-migration.mjs
--project qjoijoxmnliarlyaqmoz`, `psql` with the connection string below, or a
paste into the SQL Editor — because:

- `0001_init.sql` is one script that creates 18 tables and drops nothing — it is
  safe on an empty database and untested on a populated one. Once there is real
  data, a migration must be authored as an alter, not a re-run.
- a script that aborts mid-way leaves RLS in a state that only a human should
  untangle, and the untangling needs the dashboard anyway (README.md describes
  the `drop schema public cascade` restart, which only works on an empty
  database).

Before that manual step: take a dump, run the same migration on staging, run
the four checks above, and only then apply.

Two probes are deliberately outside that job, because both need a credential CI
does not hold: `node supabase/e2e/security-battery.mjs` (no service key needed,
but it hammers the live throttles, which CI should not do to a shared project)
and `node supabase/e2e/auth-flow.mjs` (its two privileged calls need the service
key, and the workflow keeps that key out of runners on purpose). Run both by
hand against staging after a migration and again against production after the
apply — the auth flow is the one check that catches a GoTrue upgrade or a
dashboard policy change breaking sign-in before a user does.

The third hand-run probe is `node supabase/e2e/auth-mail-brand.mjs`, and it
belongs on the staging list even though it touches no data. Auth config is not
part of a migration and not part of the deploy: a fresh project starts with
Supabase's stock `smtp_sender_name` and its 184-character template bodies, which
is how this repository held branded HTML for a week while the live project sent
plain defaults. So after any project is created or restored, read the config back
before telling a user the mail is branded — and note that a `PATCH` to
`/config/auth` is atomic, so one rejected field in the body rolls the other
changes in that request back with it.

## Known gaps

Stated plainly, because a runbook that hides its holes is worse than none:

- **No backup has been taken and no restore has been performed.** The drill
  above is now a command rather than a procedure — `backup/restore.mjs` has been
  exercised end to end against a simulated database (both transports, every
  refusal path, a deliberately broken count) but never against a real project,
  and there is no snapshot on disk yet because `backup.mjs` has never been run.
  Until both happen the honest statement is "we can restore", not "we can
  recover". See README.md → *What is not done yet*.
- **`0001_init.sql` is live on production and has no CI history behind it.** It
  was applied by hand over a direct Postgres session on 2026-09-27, not by the
  migration job, so the pipeline has never had a schema revision to compare
  against and the first automated run will meet an existing schema.
- **`0002`–`0007` are live on production (verified 2026-09-27 by PostgREST
  probes — see README.md → *What is not done yet*) but have no CI history
  behind them.** They were applied by hand over a direct Postgres session, not
  by the migration job, so a fresh project (staging) still has to run them in
  order. 0003 re-declares `create_link`,
  so it must follow 0002, whose own copy still validates exactly 7 characters —
  re-running 0002 later would put the narrow rule back. And 0004's revoke of
  `enforce_rate_limit` from `authenticated` only holds if 0002 went first,
  because the bottom of that file runs a blanket
  `grant execute on all functions in schema public to authenticated`.
- **The security headers this project can send are the ones a `<meta>` can
  carry — unless the host reads the file the build now emits.** The
  Content-Security-Policy is stamped into the built `index.html`
  (see `src/lib/security/contentSecurityPolicy.ts`), which is enough to stop an
  injected script and most data exfiltration — but a meta cannot carry
  `frame-ancestors`, and neither can it carry `X-Content-Type-Options`,
  `Strict-Transport-Security` or `Permissions-Policy`. The same module therefore
  generates `dist/_headers` on every build with all of those, plus
  `frame-ancestors 'none'` appended to the identical CSP string, and a test
  asserts the two policies cannot drift.
  **That file is inert until a host serves it.** Cloudflare Pages and Netlify
  read the name as is; `caffeine.toml` — the target this repo is configured for
  — has no header surface, so **on the current deploy target clickjacking is
  still open**. Moving `dist` to a host that reads `_headers` closes it with no
  code change, and any proxy in front of the app can be given the same values.
- The nightly backup workflow cannot run until `SUPABASE_PROJECT_REF` and
  `SUPABASE_DB_PASSWORD` exist as repo variables/secrets, and GitHub Actions
  schedules do not fire on a repository's first run until a workflow has been
  run manually once.
- The CI typecheck step is a hard gate: `pnpm typecheck` reports no errors as of
  2026-09-27, so there is nothing suppressed with `continue-on-error`. Keep it
  that way — a workflow that reports without blocking is how a broken tree starts
  looking healthy.
- The artifact store is a second copy of every account's data, unencrypted at
  rest beyond GitHub's own encryption, and readable by anyone with `actions:read`
  on the repository. If that is unacceptable, change the workflow to upload to
  object storage with a lifecycle rule instead — do not simply disable the
  schedule and keep the belief that backups exist.
