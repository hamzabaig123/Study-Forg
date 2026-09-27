# Supabase data layer

The app's real database: one Postgres schema with row level security, replacing
the localStorage archive the app used when there was no server.

| Path | What it is |
| --- | --- |
`migrations/0001_init.sql` | 18 tables, FK cascades, checks, RLS, the token-addressed public functions, and the atomic `start_session` / `submit_answer` / `complete_session` / `dashboard_stats` functions

`migrations/0002_rate_limits.sql` | Per-IP minute windows in front of the ten anonymous token functions, and the `custom_session` table. **Applied.**

`migrations/0003_short_code_entropy.sql` | Widens `link.code` from exactly 7 characters to 7–12 and re-declares `create_link` with the same range, so the client can mint ~50-bit codes. **Must be applied after 0002**, whose own copy of `create_link` still validates exactly 7 characters — whichever of the two runs last owns that function. **Applied.**
`migrations/0004_correctness.sql` | Nine failure modes the first three files allowed: one result per session (unique index plus a row lock in `complete_session`), a revision check in `update_note` that actually holds, `resolve_link` clamping a browser locale that is not a country code, cast-free `trueFalse` grading, the duration bound `start_session` was missing, `create_link` and `resolve_link` answering a throttle with the reason the UI already has copy for, `enforce_rate_limit` taken back off `authenticated`, and the indexes the list pages needed. **Applied.** It runs before, between or after 0002/0003 without error — every step that needs them asks the catalog first — but its `enforce_rate_limit` revoke only *holds* if 0002 went first, so the documented order is 0001 → 0002 → 0003 → 0004.
`migrations/0005_limiter_window_and_cleanup.sql` | Makes `enforce_rate_limit`'s `p_window_seconds` parameter real (0002 truncated to the minute and ignored it), prunes finished windows on every hit, and drops the never-referenced `ai_draft` table. **Applied.** Run after 0004: it re-declares the function 0004 step 8 revoked privileges on, and inherits that revoke.
`migrations/0006_reminders.sql` | The per-account reminder half of the schema: `reminder_settings` keyed by `user_id` (fire time, the account's UTC offset, which sections it carries, the day it last fired) with the four owner policies in the house style and shape CHECKs, plus `reminder_log` — read-only for its owner, writable only by the delivery function, so a client cannot record a send it did not make — and the two `security definer` views the runner needs (`reminder_digest(uuid, integer)` for one account's numbers, `due_reminders()` for the whole tick). Both are `service_role` only: they answer across accounts, so no signed-in client may call them, and the blanket function grant at the bottom of the file is walked back for them and for `enforce_rate_limit`. Additive — no other object is touched. The digest's recipient is the account's sign-in address, so nothing here stores an address a user typed. **Applied.** Any hand order works, but after 0002 it is the honest state of the rest of the schema
`migrations/0007_reminder_grants.sql` | The grants 0006's tables were missing — 0001's harden block repeated: DML on `reminder_settings` and read on `reminder_log` for `authenticated`, RLS enabled and forced on both, and the five owner policies re-asserted idempotently. **Applied.**
`migrations/0008_helper_function_lockdown.sql` | Re-applies the walk-back this project never ran: `reminder_digest`, `due_reminders` and `enforce_rate_limit` are revoked from `public`, `anon` and `authenticated` again, re-granted to `service_role`, and `notify pgrst, 'reload schema'` pushes the denials to the API cache. Revokes come last, so ordering cannot undo them. **Written — needs one paste into the SQL editor** (verify.sql check 12 proves it once applied).
`functions/reminder-sender/` | The Deno function that does the sending 0006 describes: it authenticates a pg_cron tick by its `CRON_SECRET` bearer or a person by their own session, builds the digest from `reminder_digest`, mails it through Resend, and writes the attempt to `reminder_log`. Deploying it is three commands and a secret — see its file header — and the full setup, including the Resend sender restriction and the optional tick, is in [The reminder pipeline](#the-reminder-pipeline) below. On the mock backend the digest is a browser notification instead.
`verify.sql` | Twelve read-only checks that prove the security claims instead of asserting them. 1–7 are the schema/RLS surface, 9 the short-code drift, 10 the data invariants `0004` turns into constraints — run 10 before applying 0004 and it names the rows that would make it raise — 11 the shape and the write surface `0006` promises, including that `reminder_log` has no client write policy at all, and 12 the function-grant invariants `0008` promises: no client role may execute the two reminder helpers or the rate limiter
`email-templates/` | The five branded GoTrue emails (confirm signup, reset password, magic link, invite, change email) plus the paste instructions and suggested subjects. These are the dashboard's copy of record: edit here, paste there
`tests/rls_cross_tenant.sql` | Two fake tenants inside one `BEGIN … ROLLBACK`: proves A cannot read, write or delete B's rows, that an unconfirmed account cannot write, and that the anonymous link functions still answer. Run it in the SQL editor; it leaves no trace
`e2e/apply-migration.mjs` | Applies `0001_init.sql` over HTTPS through the Supabase Management API, then re-runs `verify.sql`'s first seven checks and the RLS file as assertions. Needs only `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; no `psql`, no Docker. It applies **0001 only** — the later migrations are pasted by hand until a runner that knows about all of them exists
`e2e/replay-sweep.mjs` | The 77-method contract driven against a live database through the real client. Needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and **either** `SUPABASE_DB_URL` **or** `SUPABASE_SERVICE_ROLE_KEY`; creates three throwaway accounts (two confirmed, one deliberately left unconfirmed) and deletes all three. No service key required — see the header of the script
`functions/ai-proxy/` | The Edge Function that calls Gemini or OpenRouter with keys held on the server, so the browser never stores one. Deploy command in its header
`backup/backup.mjs` | Dumps every public table to one readable JSON snapshot under `backup/snapshots/` (git-ignored — that folder holds other people's homework). Needs `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`
`backup/restore.mjs` | The other half: restores a JSON snapshot into a **different** project and then proves it — row counts, RLS and `anon` grants re-read after the write, not assumed from the schema file. `--into <ref>` and `--confirm <ref>` are both required and must agree; `--dry-run` does the whole preflight and writes nothing; it refuses a non-empty target, an `auth.users` owner the snapshot needs, and its own source project. Both transports and every flag are in OPERATIONS.md → *Restore drill*
`OPERATIONS.md` | Backups, PITR, the restore drill, key rotation and the staging → production path
`.env.example` | Copy to `.env` and fill in. **`.env` is git-ignored and must stay that way**

The CI side lives outside this folder: `.github/workflows/supabase-ci.yml`
(frontend gates, then staging migration + `verify.sql` + the RLS file + the
replay sweep when a staging project is wired up) and
`.github/workflows/supabase-backup.yml` (nightly `pg_dump`).

## Apply the migration

Two routes, and they are alternatives rather than steps: the script, or the
dashboard by hand. The script refuses to re-apply over a schema that already
exists (it checks for `public.question` first), so the second run is a report
rather than a second migration; if a hand-run aborts partway, the recovery is the
`drop schema public cascade` step below rather than a partial re-run.

### With the script (no psql, no Docker)

```
SUPABASE_ACCESS_TOKEN=<personal access token> \
SUPABASE_PROJECT_REF=<ref> \
node supabase/e2e/apply-migration.mjs
```

Add `--dry-run` to check the project and print what it would do without writing,
or `--project <ref>` to point the same file at staging and then production. The
token comes from dashboard → Account → **Advanced → API tokens**; it is the only
secret the script reads, it belongs in the environment and never in a committed
file, and it is far broader than the app needs (it can administer every project
on the account), so keep it out of CI secrets and paste it only for the run.

The script applies the migration, then asserts the same seven things `verify.sql`
asks a human to read — 18 tables, 18 with RLS on and forced, no table missing an
owner policy, zero `anon` table grants, exactly the ten token-addressed functions
`anon` can execute, no `SECURITY DEFINER` function without a pinned `search_path`,
no policy admitting `anon` — and finally runs `tests/rls_cross_tenant.sql`. A
failed count prints the rows behind it, so a leaked grant is named rather than
merely counted. Exit 0 = everything holds; 1 = a check failed; 2 = the token or
the ref is unusable.

The last step — `tests/rls_cross_tenant.sql` through the same endpoint — is the
one that depends on the Management API accepting a multi-statement script with
`set local role` in it. That endpoint has never answered this account: the one
access token tried on 2026-09-27 returned 401 on both `/v1/projects` and
`/v1/projects/<ref>/database/query`, so nothing below has been run *through the
script*. The schema and every check in it were reached instead over a direct
Postgres session — see "Status" below — which proves the SQL, not the transport.
If the API is refused again, the migration and the seven checks the script
have a live equivalent already; finish with the RLS file in the dashboard editor.

### By hand, in the dashboard

1. Supabase → your project → **SQL Editor** → New query.
2. Paste all of `migrations/0001_init.sql`, then **Run**. It is one script; if it
   aborts, fix the reported line and re-run from the top after
   `drop schema public cascade; create schema public; grant usage on schema public to anon, authenticated;`.
   Then paste `migrations/0002_rate_limits.sql` and
   `migrations/0003_short_code_entropy.sql`, **in that order**. 0002 carries its
   own copy of `create_link` with the old 7-character validator, so running it
   after 0003 would silently put the narrow rule back. If you skip 0002, 0003
   still works — it calls the throttle only when that function exists.
   Then paste `migrations/0004_correctness.sql`, and after it
   `migrations/0005_limiter_window_and_cleanup.sql` and
   `migrations/0006_reminders.sql`. 0004 will not error if an
   earlier file is missing — each step that depends on 0002 (`enforce_rate_limit`,
   `rate_limit`, `custom_session`) or on 0003 (the widened `link.code`) first asks
   the catalog whether that object exists — but run it **after** 0002 all the
   same, because 0002's closing `grant execute on all functions … to
   authenticated` hands `enforce_rate_limit` back to every signed-in user, and
   0004 step 8 is what takes it away. It also refuses rather than repairing: if
   any session already has two result rows, or a stored `custom_session` breaks a
   check 0004 adds, the script raises and names the count, leaving every row
   intact. `verify.sql` check 10 is the dry run of exactly that question. 0005
   re-declares the limiter 0004 just tightened, so it comes after, and 0006 is
   additive so its position only matters for the count check 1 reports — but
   its own blanket `grant execute on all functions … to authenticated` runs
   *after* its walk-back and re-grants `enforce_rate_limit` and the two
   cross-account helpers (`reminder_digest`, `due_reminders`) to every signed-in
   user; measured live on 2026-09-28, that let a signed-in account execute
   `due_reminders()` and read every due account's contact details. Finish with
   the two reminder files: after 0006, paste `migrations/0007_reminder_grants.sql`
   and then `migrations/0008_helper_function_lockdown.sql` (both idempotent;
   0008 re-applies the revokes last and ends with `notify pgrst, 'reload schema'`
   so the denials reach the API promptly).
3. Run all of `verify.sql` and read each result against its comment. Check 4
   (`role_table_grants` for `anon`) returning zero rows is the one that matters
   most: it is what makes the publishable key safe to ship in the browser.
4. Paste the five files in `email-templates/` into dashboard → Authentication →
   **Email Templates**, one per template, with the subjects listed in that
   folder's README. The Site URL in Authentication → URL Configuration has to be
   the deployed app origin first, or the confirmation link lands nowhere.
5. Required for real email delivery: deploy `functions/reminder-sender` and set
   its secrets. The full recipe — the four secrets, the Resend sender
   restriction, and the optional pg_cron tick for closed-app days — is in
   [The reminder pipeline](#the-reminder-pipeline) below. Without it there is
   no email at all: the test send and the daily scheduler both surface the
   function's error, and on the mock backend the digest is a browser
   notification instead.
6. Then run `tests/rls_cross_tenant.sql` in the same editor, and once the
   publishable key and either a direct database URL or a service role key are
   available on a machine that has Node,
   `node supabase/e2e/replay-sweep.mjs`. The CI workflow runs all three
   against staging, so a project wired up there needs none of this by hand.

## The reminder pipeline

The daily digest is **built and sent by** `functions/reminder-sender`: the
in-app scheduler (`startReminderScheduler`,
one tick a minute while the app is open) waits for the account's local send
time, then POSTs the user's own access token to the function, which reads the
numbers from `reminder_digest`, mails them through [Resend](https://resend.com)
to the sign-in address, and writes the attempt to `reminder_log` — visible in
Settings → Reminders, failed attempts included. Because the recipient is always
the account's sign-in email, nothing in the pipeline sends to an address a user
typed.

The request body carries one flag: `{ "daily": true }` from the scheduler (the
run may consume the day, by stamping `reminder_settings.last_sent_on`) and
`{ "daily": false }` from the settings page's test button (same pipeline, never
stamps — a test press used to eat that evening's digest). The greeting name is
`user_settings.display_name`, falling back to the address's local part, exactly
as `due_reminders()` resolves it for the cron tick. The browser's own
`buildDigest` copy — including its HTML rendering — is what the mock backend
surfaces as a notification, not what this function mails.

The function reads four secrets (Edge Functions → Secrets in the dashboard, or
`supabase secrets set` with the CLI):

| Secret | Required | What it does |
| --- | --- | --- |
`RESEND_API_KEY` | yes | The mail transport. Without it every send answers "RESEND_API_KEY is not set on this project". Free tier: 3 000 emails/month.
`APP_URL` | recommended | The deployed app origin; the email's "Continue studying" button links to `${APP_URL}/dashboard`. Without it the link points at the Supabase project URL.
`RESEND_FROM` | no | Custom sender for a verified domain: `StudyForge <notices@yourdomain.com>`. Default: `onboarding@resend.dev`.
`CRON_SECRET` | only for the tick | The bearer the scheduled pg_cron tick must carry; the function compares it character for character. The value lives in `supabase/.env`.

**The Resend sender restriction:** until a domain is verified, Resend delivers
the default `onboarding@resend.dev` sender only to the Resend account owner's
own address — and the digest is addressed to the sign-in email. Create the
Resend account with the same address you sign into StudyForge with, or verify
a domain and set `RESEND_FROM`. A test send that fails with "You can only send
testing emails to your own email address" is this restriction, not a bug.

If a secret is added and the very next test send still reports it missing,
redeploy the function (its dashboard page has a Redeploy button) — some setups
only pick secrets up on redeploy.

**The optional cron tick** covers the days the app is closed; open-app days
need nothing but the secrets, because the browser scheduler calls the function
itself. No migration carries the `cron.schedule` call, so run it once in the
SQL editor after enabling the `pg_net` extension:

```sql
select cron.schedule(
  'studyforge-reminder-tick',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/reminder-sender',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

The function decides who is due (`due_reminders()` from 0006 compares each
account's local send time), so the tick can safely run every 10 minutes in UTC.
Confirm afterwards with `select * from cron.job`, and remove it again with
`select cron.unschedule('studyforge-reminder-tick')`.

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

### Auth settings a deployed project needs

Three dashboard settings, and each one is the reason a flow works here and fails
there:

- **Site URL** — the origin links return the visitor to by default.
- **Redirect URLs (allow-list)** — must contain every origin the app is served
  from, including `http://localhost:<port>` for development. `requestPasswordReset`
  sends `redirectTo` as the current origin plus `/reset-password`, and GoTrue
  answers a request whose redirect is not listed with `Redirect not allowed`,
  which the screen shows verbatim rather than swallowing. An email confirmation
  link sent from an unlisted origin fails the same way.
- **Password recovery** uses the same allow-list; the app listens for the
  `PASSWORD_RECOVERY` auth event and holds that session at `/reset-password`
  until a new password is saved, so a link opened by a stranger who guessed the
  address cannot read the account's rows on the way past it.

## Status of `qjoijoxmnliarlyaqmoz`

Applied on 2026-09-27 and verified against the live database, through a direct
Postgres session (`aws-0-<region>.pooler.supabase.com:5432`, user
`postgres.<ref>`, the database password) because `db.<ref>.supabase.co` does not
resolve from this machine and the Management API refused its token:

- `migrations/0001_init.sql` ran in one implicit transaction: 18 tables, RLS on
  and forced for all 18, 33 public functions.
- All seven `verify.sql` assertions pass as counts — including zero `anon` grants
  in `public`, exactly the ten token-addressed functions `anon` can execute, and
  no `SECURITY DEFINER` function with an unpinned `search_path`.
- `tests/rls_cross_tenant.sql` prints `PASS` and leaves nothing behind: A reads
  only its own rows, B cannot read/update/delete/insert across the boundary, an
  unconfirmed account cannot write at all, `anon` is refused both tables while
  `resolve_link` still answers and records its scan for the owner, and
  `report_link_abuse` rejects a code the service never issued.
- The app writes real rows: `POST /rest/v1/class` and `/rest/v1/activity` both
  return 201 with `owner_id` set to the signed-in `auth.uid()`, and
  `dashboard_stats`, `class_rows` and `attempt_history` answer 200, so the
  dashboard's error cards are gone.

Four spots in the checks needed correcting before they could pass, and every one
of them was wrong in the check rather than in the database: `verify.sql` #3
looked at `qual` where INSERT policies keep their expression in `with_check`, #4
counted `role_table_grants` across every schema while Supabase grants anon on its
own `storage.*` tables, #7 compared `pg_policies.roles` (`name[]`) against a
`text[]` literal, and `tests/rls_cross_tenant.sql` had a `RAISE` with a `%` and no
argument — which plpgsql rejects at block-compile time. See "What is not done
yet" for what the run did *not* cover.

## What is not done yet

Still true, and each item needs either the project itself or a different
credential:

- `e2e/apply-migration.mjs` has never completed a run: its Management API
  endpoint is behind a personal access token this account has not supplied
  (the one token tried returned 401). The SQL it asserts has all been executed
  by hand over Postgres, so the script's value now is the report it prints —
  treat its first run as a re-verification rather than a migration; it will
  detect `public.question` and skip the apply step.
- The adapter has not been driven method by method against the live database.
  `lib/supabase/adapter.test.ts` (41 cases) proves the shapes against a fake
  transport, `tsc` proves all 77 methods against `backendInterface`, and the
  dashboard/analytics/notes reads answer 200 for real — but
  `e2e/replay-sweep.mjs`, which exercises every method as two signed-in users
  plus one deliberately unconfirmed account, has never run. It no longer needs a
  service role key to do so.
- The archive importer (`lib/archiveImport.ts`, offered from Settings) is written
  and tested against the mock backend, but it has not run against this database.
  It restores the library, not the practice history, because `start_session`
  dates an attempt server-side — an export of past attempts would move every one
  to today.
- `functions/ai-proxy` has never been deployed, so the fourth extraction provider
  the dialog offers only appears once Supabase is both configured and selected,
  and has never answered a real request.
- Backups, PITR and the restore drill are written down in `OPERATIONS.md`, and
  the nightly workflow exists, but neither has run: the Free plan caps the
  database at a seven-day PITR window, and no dump has ever been restored.
  `backup/restore.mjs` now makes the restore itself a command rather than a
  procedure, but it has only ever been exercised against a simulated database —
  both transports, every refusal path, a deliberately broken count — never
  against a real project, and `backup.mjs` has never produced a snapshot. Until
  those two things happen the honest statement is "we can restore", not "we can
  recover".
- Migrations 0001–0007 are **applied**. Verified 2026-09-27 by probing
  PostgREST with the publishable key alone: `question`, `custom_session`,
  `reminder_settings` and `reminder_log` answer 401 (table exists, zero `anon`
  grants) while the dropped `ai_draft` answers 404 — which also proves 0005
  ran.
- `migrations/0008_helper_function_lockdown.sql` is **written, not applied** —
  the one migration standing between this project and its own security claim.
  Until it runs in the SQL editor, any signed-in user can execute
  `due_reminders()` (and, with the right arguments, `reminder_digest()`) and
  read other accounts' reminder contacts whenever they are due;
  `enforce_rate_limit` is also re-granted to `authenticated`. The battery
  (`e2e/security-battery.mjs`) fails its `due_reminders refuses authenticated`
  check until it is applied.
- `functions/reminder-sender` **is deployed** — its own "RESEND_API_KEY is not
  set" error reached the Settings toast on 2026-09-27, which means the deploy,
  the session auth and the `reminder_settings` read all work. The remaining gap
  is mail: `RESEND_API_KEY` is **not set yet** (Edge Functions → Secrets, with
  the Resend sender restriction from *The reminder pipeline* to watch). The
  `pg_cron` tick was scheduled and exercised live earlier the same day — a tick
  answered 200, with attempts failing only on the missing key. The `cron`
  schema is not reachable over PostgREST from this machine, so re-confirm with
  `select * from cron.job` if in doubt.
- `studyforge.custom-sessions.v1` (Test Builder runs and their results) is
  device-local in every mode: it is not in the archive the exporter writes, not
  erased by "Clear local data", and has no table in this schema.

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
