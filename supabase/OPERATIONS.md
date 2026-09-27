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

Two independent mechanisms, because they fail differently:

1. **PITR (point-in-time recovery)** — Supabase restores the whole database to
   any second inside the retention window. On the **Free plan that window is
   seven days**, and it is not configurable; a bad migration on day eight is
   not recoverable this way. Enable it under Database → Backups (or buy a
   plan, which is the only way to extend it).
2. **Nightly `pg_dump`** — `.github/workflows/supabase-backup.yml` runs at
   03:17 UTC, stores a custom-format dump as an artifact for 14 days, and then
   runs `pg_restore --list` on it so a truncated dump fails loudly instead of
   sitting there looking like a backup.

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

## Restore drill

**Run it before you need it.** A backup that has never been restored is a
file, not a backup. Do this quarterly, and after any change to the schema:

1. Create a fresh Supabase project (the staging project works; **never**
   production).
2. SQL Editor → run `migrations/0001_init.sql` into it, exactly as README.md
   describes.
3. Restore the newest dump into it:
   `pg_restore --no-owner --no-privileges -d "postgresql://postgres.<staging-ref>:…@db.<staging-ref>.supabase.co:5432/postgres" backup-<stamp>.dump`
   Expect FK-order noise if you restore into a schema that already has tables —
   restore into an empty one instead.
4. Prove the restored database, in this order:
   - `node supabase/e2e/apply-migration.mjs --project <staging-ref>` covers the
     next two bullets in one command (it skips the migration because the schema
     is already there, asserts the first seven of `verify.sql`'s ten checks, then
     runs the RLS file) and is
     the only route that works on a machine without `psql`. The two files are
     still worth running in the editor if that command reports something you have
     to look at.
   - `supabase/verify.sql` — ten read-only checks. Check 4 (`role_table_grants`
     for `anon`) returning **zero rows** is the one that decides whether the
     publishable key is safe to ship.
   - `supabase/tests/rls_cross_tenant.sql` — two fake signed-in tenants in one
     transaction, asserting that A cannot read, update or delete B's rows, that
     an unconfirmed account cannot write, and that the anonymous link functions
     still answer. Everything happens inside `BEGIN … ROLLBACK`, so a run leaves
     no trace.
   - `node supabase/e2e/replay-sweep.mjs` — the whole 77-method contract driven
   - `node supabase/e2e/replay-sweep.mjs` — the whole 77-method contract driven
     through the real client against a real Postgres: it creates three throwaway
     accounts (two confirmed through GoTrue's public sign-up plus a direct
     database session, one left unconfirmed on purpose), exercises sessions,
     grading, notes, shares, links, settings and analytics, and deletes all three.
     No service-role key is needed when `SUPABASE_DB_URL` is set; the service role
     is the fallback. Exit 0 means every step matched the adapter's expectations.
   - the app itself: point `src/frontend/.env.local` at staging
     (`VITE_DATA_BACKEND=supabase`), sign in, and run Settings → *Import
     archive* with a real exported file. This is the only check that exercises
     `lib/archiveImport.ts` against Postgres rather than the mock.
5. Record the date, the dump used, and any step that failed — then fix the step,
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

## Known gaps

Stated plainly, because a runbook that hides its holes is worse than none:

- **No restore has ever been performed.** The drill above has never been
  executed end to end, and neither has any step of it — there is a database now,
  but no `pg_dump` of it. See README.md → *What is not done yet*.
- **`0001_init.sql` is live on production and has no CI history behind it.** It
  was applied by hand over a direct Postgres session on 2026-09-27, not by the
  migration job, so the pipeline has never had a schema revision to compare
  against and the first automated run will meet an existing schema.
- **`0002_rate_limits.sql` and `0003_short_code_entropy.sql` are written and not
  applied.** Until 0002 is, the ten token-addressed functions `anon` may execute
  have no database-side throttle. Until 0003 is, the database still refuses
  anything but a 7-character code (~35 bits) even though
  `lib/supabase/tokens.ts` now mints 10 (~50 bits) — so creating a short link
  against the live project fails as `badCode` until that migration lands, which
  makes it a functional requirement and not only a hardening one. 0003
  re-declares `create_link` and calls `enforce_rate_limit` only if it exists, so
  0003 calls `enforce_rate_limit` only if it exists, but it must be applied
  **after** 0002, whose own copy of `create_link` still validates exactly 7
  characters — re-running 0002 later would put the narrow rule back.
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
