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
`migrations/0008_helper_function_lockdown.sql` | Re-applies the walk-back this project never ran: `reminder_digest`, `due_reminders` and `enforce_rate_limit` are revoked from `public`, `anon` and `authenticated` again, re-granted to `service_role`, and `notify pgrst, 'reload schema'` pushes the denials to the API cache. Revokes come last, so ordering cannot undo them. **Applied.** Measured on the live project 2026-09-28: the three helpers carry execute for `postgres` and `service_role` only, and a request with just the publishable key gets `401 / 42501 permission denied for function` from `reminder_digest` and `due_reminders`.
`migrations/0009_push_subscriptions.sql` | One row per signed-in browser for web push: `endpoint` plus the browser's own `p256dh`/`auth` key material, unique on the endpoint, owner-only RLS with the same four policies. The delivery function reads them with the service key, so no function grants accompany it. **Applied.** Idempotent per fresh table; it must run after 0007.
`migrations/0010_digest_counts_every_test.sql` | Re-declares `reminder_digest(uuid, integer)` so it sums `result` **and** `custom_session`. The dashboard merges the two — a run built in the Test Builder is graded in the browser and mirrored into `custom_session` — but the digest read only `result`, so an account whose day was spent on built tests was mailed "0%, 0 answered, 0-day streak" while its own dashboard said 50% over 20 questions. Measured live on 2026-09-28. Same eight output columns, same owner scoping, same `service_role`-only grants re-asserted at the bottom. Run after 0002 (which creates `custom_session`) and after 0008. **Applied 2026-09-28**, and measured before/after against the account that complained: `reminder_digest(<owner>, 300)` went from `0% / 0 answered / 0-day streak` to `50% / 10 correct / 20 answered / streak 1 / 1 test today` — the dashboard's own numbers — while a library-only account kept its `89% / streak 3`, proving the union added rows rather than shifting the calendar.
`migrations/0011_trusted_client_address.sql` | Re-declares `enforce_rate_limit` so a window is keyed on the address the edge vouches for — `cf-connecting-ip`, which Cloudflare writes and refuses to pass through from a client — instead of the leftmost `x-forwarded-for` element, which the caller writes. The old key was measured live: 25 `create_link` calls carrying 25 invented addresses produced 25 accepted requests and 25 separate limiter rows, i.e. every public throttle was decorative. Falls back to the proxy-appended last `x-forwarded-for` element, then `x-real-ip`, then `unknown`. The file also takes back `TRUNCATE`, `TRIGGER` and (on 17 and up) `MAINTAIN` from `anon` and `authenticated` on every public table and from the `postgres` default privileges, because RLS does not apply to TRUNCATE and a signed-in account could otherwise wipe a table another account's rows live in. `REFERENCES` is deliberately left alone — the client roles' own FK inserts need it. **Applied 2026-09-28.** Measured after: the same forged-address burst is answered `20 accepted / 5 limited` with one limiter row keyed on the real address, and the battery's `shared_content` probe still trips at 121 on the honest path.
`functions/reminder-sender/` | The Deno function that does the sending 0006 describes: it authenticates a pg_cron tick by its `CRON_SECRET` bearer or a person by their own session, builds the digest from `reminder_digest`, mails it through Resend, and writes the attempt to `reminder_log`. Deploying it is three commands and a secret — see its file header — and the full setup, including the Resend sender restriction and the optional tick, is in [The reminder pipeline](#the-reminder-pipeline) below. On the mock backend the digest is a browser notification instead.
`verify.sql` | Fourteen read-only checks that prove the security claims instead of asserting them. 1–7 are the schema/RLS surface, 9 the short-code drift, 10 the data invariants `0004` turns into constraints — run 10 before applying 0004 and it names the rows that would make it raise — 11 the shape and the write surface `0006` promises, including that `reminder_log` has no client write policy at all, 12 the function-grant invariants `0008` promises: no client role may execute the two reminder helpers or the rate limiter, and 14 the client-address and privilege invariants `0011` promises: the limiter reads `cf-connecting-ip`, never the caller-written leftmost `x-forwarded-for` element, and no client role holds TRUNCATE/TRIGGER/MAINTAIN on any public table or in the stored default privileges
`email-templates/` | The five branded GoTrue emails (confirm signup, reset password, magic link, invite, change email) plus the paste instructions and suggested subjects. These are the dashboard's copy of record: edit here, paste there
`tests/rls_cross_tenant.sql` | Two fake tenants inside one `BEGIN … ROLLBACK`: proves A cannot read, write or delete B's rows, that an unconfirmed account cannot write, and that the anonymous link functions still answer. Run it in the SQL editor; it leaves no trace
`e2e/apply-migration.mjs` | Applies `0001_init.sql` over HTTPS through the Supabase Management API, then re-runs `verify.sql`'s first seven checks and the RLS file as assertions. Needs only `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; no `psql`, no Docker. It applies **0001 only** — the later migrations are pasted by hand until a runner that knows about all of them exists
`e2e/replay-sweep.mjs` | The whole write path, driven against a live database through the real client (supabase-js, the same one the adapter uses — this exercises the RPCs and tables behind the 77 methods, not each of the 77 calls). Needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and **either** `SUPABASE_DB_URL` **or** `SUPABASE_SERVICE_ROLE_KEY`; creates three throwaway accounts (two confirmed, one deliberately left unconfirmed) and deletes all three. No service key required in principle — see the header of the script — but `SUPABASE_DB_URL` only works if it is a **direct or pooler hostname** (`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<ref>`, database `postgres`; a `db.<ref>.supabase.co` host does not resolve outside Supabase's own network) **and** `pg` is reachable through `NODE_PATH`, since the driver is deliberately not a dependency here. On this machine the service-key route is the one that works. It is also the only gate that writes tables as a client rather than through a `security definer` function: the hierarchy, `note`, `activity`, `user_settings`, and the three that used to have no proof at all — `reminder_settings`, `push_subscriptions` and `custom_session`, the mirror every finished Test Builder run sends. Every one of those is then re-read as a *second* account, which must see zero rows
`e2e/security-battery.mjs` | The live stranger test: thirty-one read-only or self-cleaning probes over HTTPS — every public table refused to `anon`, the `service_role`-only helpers refused to a signed-in key, the token-addressed RPCs throttled, and a burst that forges its own `x-forwarded-for` per call answered by the limiter rather than let through. Needs only `SUPABASE_URL` + `SUPABASE_ANON_KEY` (`DEMO_EMAIL`/`DEMO_PASSWORD` add the authenticated write surface). Run it after every migration
`e2e/auth-flow.mjs` | The whole sign-up → confirm → sign-in → refresh → change-password → recovery → sign-out → delete path against a live GoTrue, in the order a real user meets it, ending with the throwaway account it created deleted. Needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which it uses for two admin routes on that one account — confirm and delete, with the delete repeated from the cleanup path if a step fails in between. `SUPABASE_PASSWORD_FLOOR` (default 10) is asserted on both the sign-up and the change-password route, so a dashboard policy change fails here rather than surprising a user
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
`set local role` in it. On 2026-09-27 the token then available returned 401 on
both `/v1/projects` and `/v1/projects/<ref>/database/query`, so nothing below was
run *through the script* and the schema was reached over a direct Postgres
session instead — see "Status" below. **That was the token, not the endpoint.**
A personal access token that belongs to the project's own account answers
`200` on `/v1/projects` and `201` on `database/query`, and a whole migration
file — dollar-quoted function bodies, `revoke`/`grant`, a trailing
`notify pgrst, 'reload schema'` — runs in one request. Migration 0010 was
applied exactly that way on 2026-09-28, as were the `APP_URL` secret
(`POST /v1/projects/<ref>/secrets`) and the `reminder-sender` redeploy
(`POST …/functions/deploy?slug=reminder-sender`, multipart, with the
`metadata` form part carrying `entrypoint_path`; a bare `.ts` file works and a
zip does not). `tests/rls_cross_tenant.sql` has still never been run through
`apply-migration.mjs`, so the RLS proof remains the SQL editor's job.

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
   so the denials reach the API promptly). Finish with
   `migrations/0009_push_subscriptions.sql` (web push needs it; the sender
   reads those rows with the service key) and
   `migrations/0010_digest_counts_every_test.sql`, which must come after both
   0008 and 0002 itself — it re-declares the helper 0008 locked down, over the table
   0002 created. Finally `migrations/0011_trusted_client_address.sql`, which
   re-declares the limiter 0005 introduced and 0008 revoked from the client
   roles, and takes the destructive table privileges back from both roles; it is
   idempotent and ends with `notify pgrst, 'reload schema'`.
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

`reminder_digest` is the only source of the numbers, which is why migration
0010 matters: through 0006 it summed `result` alone, while a Test Builder run is
graded in the browser and mirrored into `custom_session`. The dashboard merges
both, the helper did not, so an account whose day was built tests was mailed
"0%, 0 answered, 0-day streak" — the email and the app were reading different
halves of the same history. 0010 re-declares it over both tables.

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
`APP_URL` | yes in practice | The deployed app origin; the email's "Continue studying" button, the plain-text footer and the push click all point at `${APP_URL}/dashboard`. Set it to `https://study-forg-frontend-100.vercel.app`. It used to fall back to the project's API origin, which mailed every reader a link to `https://<ref>.supabase.co/dashboard` — Supabase's own dashboard, not the app. That fallback is gone: an app-triggered send borrows the page's origin from its `Origin` header, and a cron tick with nothing to borrow lands on the production origin compiled into `appOrigin()`.
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

## Gmail as the auth mailer (custom SMTP)

Verification and password-reset emails are sent by **Supabase Auth itself**,
not by `reminder-sender` — and the built-in mailer allows only a few per hour,
which is where "email rate limit exceeded" comes from. Pointing Supabase at a
Gmail app password removes that ceiling and sends from an address that exists.
Pure dashboard work, no code:

1. Google account → **Security** → 2-Step Verification → **App passwords** →
   create one for "Mail". That 16-letter password is `SMTP_PASS`; the account
   password is never accepted.
2. Supabase dashboard → **Authentication → SMTP Settings** → enable custom SMTP
   and fill in the field table under *Sending auth mail through an SMTP relay*
   below → Save. From then on, verification, password reset, invite and
   magic-link emails all ride Gmail. If anything goes wrong, the same toggle
   switches back to the built-in mailer instantly.
3. The reminder digest is a **separate** mail path and stays on Brevo's REST
   API with Resend behind it: `BREVO_API_KEY`/`BREVO_FROM` (and optionally
   `RESEND_API_KEY`) are function secrets for `functions/reminder-sender`, not
   SMTP settings. Nothing in this project speaks Brevo **SMTP** any more.

For web push, generate a P-256 VAPID pair once; the public half goes to the
browser (it already ships in `lib/push.ts`), the private half becomes the
`VAPID_PRIVATE_KEY` secret alongside `VAPID_PUBLIC_KEY`.

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

- **Site URL** — the origin links return the visitor to by default. Both mail
  flows the app starts send their own redirect, so this is the fallback rather
  than the only answer: `requestPasswordReset` sends the current origin plus
  `/reset-password`, and `register`/`resendConfirmation` send the current origin
  plus `/verify-email?email=<address>`, which is why a spent confirmation link
  still lands on the one screen that can re-send it and knows the address to
  re-send to.
- **Redirect URLs (allow-list)** — must contain every origin the app is served
  from, including `http://localhost:<port>` for development. `requestPasswordReset`
  sends `redirectTo` as the current origin plus `/reset-password`, and GoTrue
  answers a request whose redirect is not listed with `Redirect not allowed`,
  which the screen shows verbatim rather than swallowing. An email confirmation
  link sent from an unlisted origin fails the same way.
- **A link is spent by the first hit it gets, not by the app reading it.**
  GoTrue consumes the token while it builds the redirect, so a visitor who taps
  the link while nothing is listening on that origin — a dev server that is not
  running, a deployment that has been taken down — gets a dead page *and* burns
  the link: the next tap comes back
  `#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`
  with no session. supabase-js consumes such a fragment in silence, so
  `src/lib/authLinkError.ts` reads it and the landing screens name it
  (`AuthPage`'s reset and verify screens), instead of looking like a form that
  simply refuses to work. The fix is a live origin, not a retry.
- **Password recovery** uses the same allow-list; the app listens for the
  `PASSWORD_RECOVERY` auth event and holds that session at `/reset-password`
  until a new password is saved, so a link opened by a stranger who guessed the
  address cannot read the account's rows on the way past it.
- **Password policy** — `password_min_length` was **6** (Supabase's own default)
  until 2026-09-28, which is a five-minute dictionary job rather than a
  password. It is now **10**, and `mailer_notifications_password_changed_enabled`
  is **on**, so the owner of an account gets a mail when the password changes —
  the one signal that tells a person their session was taken over. Both are
  server-side: measured after the change, a 6-character signup is answered
  `422 weak_password {"reasons":["length"]}` and the UI shows GoTrue's own
  sentence, "Password should be at least 10 characters.", verbatim.
  **The browser floor used to be 8**, so a visitor could fill the form, pass the
  HTML validation, and only then be refused by the server. `src/frontend/src/lib/`
  **`passwordPolicy.ts`** is now the one place that number lives: `localAuth`
  (mock accounts), `supabase/session.ts` (the reset screen's own pre-flight) and
  all four `minLength` attributes in `AuthPage.tsx` read it, and
  `passwordPolicy.test.ts` fails if the constant and the number written above
  ever disagree. `e2e/auth-flow.mjs` asserts the server half, on both the public
  sign-up route and an authenticated `PUT /auth/v1/user`.
  The leaked-password (Have I Been Pwned) check could **not** be enabled here:
  `PATCH /config/auth` refuses the whole request with `402 Configuring leaked
  password protection via HaveIBeenPwned.org is available on Pro Plans and up`,
  which is also a warning about that endpoint — a rejected field rolls back the
  rest, so send one change at a time. Existing accounts keep working through a
  short password until they reset it; only new sign-ups and resets pay the
  minimum. To undo either value: `PATCH /config/auth` with
  `{"password_min_length": 6, "mailer_notifications_password_changed_enabled": false}`.

### Sending auth mail through an SMTP relay (Gmail)

Verification and password-reset mail are sent by **GoTrue**, not by this app and
not by `functions/reminder-sender`. That single fact decides the provider:
GoTrue's built-in mailer speaks **SMTP only**, so a REST-only provider (Resend
does, and Brevo's API half too) cannot be selected in the SMTP settings screen
— which is why the digest has its own mail path and the auth flows have to use
an SMTP one.

Until a relay is switched on, both emails leave through Supabase's built-in
sender, which is capped at **2 messages per hour** and sends from a shared
`*.supabase.co` address that Gmail files under Spam — that cap is the real
reason a second verification mail "never arrives" right after the first one
worked. After you configure your own relay, Supabase still starts it at
**30 messages per hour**, raisable under Authentication → **Rate limits**.

**Saving these settings does not test them.** The dashboard accepts wrong
credentials and reports nothing; the failure only surfaces on the next request,
so use `e2e/auth-mail-check.mjs` below as the actual check.

Dashboard → Authentication → **SMTP settings** (the fields map to GoTrue's
`smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_admin_email`,
`smtp_sender_name`):

| Field | Value |
| --- | --- |
| Host | `smtp.gmail.com` — no scheme, no `:587` appended, no trailing space |
| Port | **`587` with STARTTLS.** This is the pairing verified here |
| Username | the full Gmail address, `@gmail.com` included |
| Password | a 16-character **app password**, not the account password |
| Sender email | the same Gmail address (or an alias Google lets it send as) |
| Sender name | `StudyForge` |

An app password only exists once 2-Step Verification is on: Google account →
Security → 2-Step Verification → **App passwords**. The account password is
refused at `AUTH LOGIN` no matter how many times it is retyped, and Google
retired the "less secure apps" switch that used to accept it.

Measured against `smtp.gmail.com:587` from this machine on 2026-09-28 with
`e2e/smtp-relay-check.mjs` — the first relay this project has tried that got
past authentication:

```
  ← 220 smtp.gmail.com ESMTP … - gsmtp
  → EHLO studyforge-check.local
  ← 250 … STARTTLS …
  → STARTTLS   ← 220 2.0.0 Ready to start TLS
  ← encrypted session up in 1410 ms
  → AUTH LOGIN ← 334 (username) / 334 (password)
  ← 235 2.7.0 Accepted              authentication: passed
  → MAIL FROM:<…>       ← 250 2.1.0 OK    sender: accepted
  → RCPT TO:<…>         ← 250 2.1.5 OK    destination: accepted
```

The same run with the last character of the app password changed returns the
line that identifies the field on its own:

```
← 535 5.7.8 Username and Password not accepted. … https://support.google.com/mail/?p=BadCredentials
```

Three things this table cannot tell you:

- **The port must match the mode.** Gmail also answers `465`, and that one is
  *implicit* TLS — point GoTrue's `587` at it, or the reverse, and nothing is
  refused: the connection just sits there until the platform gives up with
  HTTP 504. Port 25 is blocked outbound as everywhere. `smtp-relay-check.mjs`
  prints the mode that worked; `SMTP_TLS=1` tests `465`.
- **A `535` from Gmail is a password problem, not a key problem.** Unlike
  Brevo, there is no second "API key" string to confuse it with; the two
  failures are the account password used instead of an app password, and an
  app password Google has revoked.
- **The `From` has to be the authenticated address.** Gmail accepts
  `MAIL FROM` for that user and its own aliases, and refuses anything else
  before anything is queued — so a custom sender name looks like an auth
  problem rather than a sender problem.

One ceiling to know about: a personal Gmail account is rate-limited by Google
and a sudden burst of identical mail is what flags it. That is no trouble for
verification and reset traffic, and it is a reason not to send a bulk campaign
from the same address.

Rollback is one click: clear the SMTP fields and GoTrue goes straight back to
the built-in sender. Nothing in the app changes either way, and no template is
touched — `email-templates/` stays the version of record for the HTML.

Prove it with `supabase/e2e/auth-mail-check.mjs`, which asks GoTrue for a
recovery mail and reads the response. GoTrue fails the request on the spot when
the mailer fails — but on the version this project runs (v2.197.0) the client
gets an anonymous `{"error_code":"unexpected_failure"}` and the provider's real
`535`/`550` line stays in the project's auth logs. So the script's value is the
**status and the timing**, which together say how far the send got; the field
that is wrong has to be read from Dashboard → Authentication → Logs, where the
same failure is logged under the `error_id` the response carries.

```bash
SUPABASE_URL=https://qjoijoxmnliarlyaqmoz.supabase.co \
SUPABASE_ANON_KEY=<publishable key> \
AUTH_TEST_EMAIL=<an address that already has an account> \
node supabase/e2e/auth-mail-check.mjs
```

`AUTH_TEST_EMAIL` must name an account that exists, because GoTrue answers a
recovery request for an unknown address with the same 200 it gives for a known
one (account enumeration protection) and sends nothing — a made-up address
would turn a broken relay into a passing test. The script creates no account
and sends mail to exactly one address; the link it generates expires unused.
Exit 0 = the mailer took the job (then read the four inbox checks it prints —
arrived, `via <your domain>`, link host, and the reason Gmail's *Show original
→ Encryption and delivery* gives if it went to Spam). Exit 1 = it refused; the
output names which *kind* of failure the shape is and where the exact field is
written down. Exit 2 = missing input.

### Why there is no Send Email hook here

**Deleted, on purpose.** A hook (`functions/auth-mail`) did exist here: it took
the token from GoTrue, built the `/auth/v1/verify` link itself and mailed it
through Brevo's REST API with Resend behind it, which is the same path the
digest already used. It was never deployed, and it is gone from the tree now —
Gmail SMTP is a working relay with no function to maintain, no second secret,
and no hook URL to rotate. Two consequences worth remembering if the hook is
ever rebuilt:

- GoTrue's SMTP settings do the whole job, so `email-templates/` stays the
  version of record for the HTML instead of the copy moving into a function.
- A hook caller has no user session, so a deployed hook needs `--no-verify-jwt`
  and has to authenticate the caller itself. Getting that wrong turns an Edge
  Function URL into a form anyone can post to and mail arbitrary addresses from
  a verified sender.

**When GoTrue masks the reason, ask the relay directly.**
`supabase/e2e/smtp-relay-check.mjs` runs the same conversation GoTrue runs —
EHLO, STARTTLS, encrypted EHLO, `AUTH LOGIN`, `MAIL FROM`, `RCPT TO` — and stops
there, so **no message is ever composed** and no daily quota moves. It reads the
credentials from the environment (`SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, all
documented in `supabase/.env.example`, which git ignores) and never prints them,
not even base64-encoded, because that is reversible. The payoff is the line
GoTrue keeps: run against the live relay with a deliberately wrong key it
answers

```
← 535 5.7.8 Username and Password not accepted.
```

and the script names the field that produced it — the app password, the sender
address, Google's daily ceiling, or the connection mode. `SMTP_TLS=1` tests port
465's implicit TLS; without it the script expects STARTTLS, which is what 587
speaks. Run against `smtp.gmail.com` with the right values it ends

```
← 235 2.7.0 Accepted        = authenticated: the key and the username are right
← 250 2.1.0 OK              = sender accepted: Gmail sends mail as this address
← 250 2.1.5 OK              = destination accepted, and nothing was ever sent
```

**Read the timing, not only the status.** A refused credential, a sender Gmail
will not send as, or a spent quota comes back in a couple of seconds. A request
that instead sits for tens of seconds until the platform answers **HTTP 504
`upstream request timeout`** never got a TLS session established at all — that
is a port/TLS mismatch (implicit TLS aimed at `587`, or STARTTLS at `465`), a
mistyped host, or a leftover port 25, and it means no verification or reset mail
is leaving the project while it lasts. Measured here on 2026-09-28, same
address, three runs:

| When | Response | Reading |
| --- | --- | --- |
| before the dashboard change | HTTP **504** after 35 784 ms | the outbound connection never completed — nothing to do with the key |
| with the Brevo SMTP key in the panel | HTTP **500** `unexpected_failure` after 2 205 ms | GoTrue reached the relay and was refused fast: a credential or sender field was wrong, and only the auth log named it |
| with the Gmail app password | HTTP **200**, and the mail arrived | the relay accepted the send and the message reached a real inbox |

The 504 → 500 → 200 move is the whole story: first the connection could not be
made, then it could and the credentials were wrong, then both were right.

**Both flows, end to end, on 2026-09-28.** `/auth/v1/signup` answered **200**
with a `confirmation_sent_at` stamp for a throwaway address, `/auth/v1/recover`
answered **200** in 3 002 ms for the same one, and **two real messages landed
in that inbox** — `Confirm your email address` and `Reset your password`, both
from `mmhb112010@gmail.com`. Following the signup link returned **303** to
`https://study-forg-frontend-100.vercel.app/verify-email?email=…` carrying a
fresh `access_token` (a link GoTrue hands a session to has accepted the
address), and the recovery link returned **303** to the deployed origin with
`type=recovery` in the fragment, which `RequireAuth` routes on to
`/reset-password`. Nothing about that needed a code change; the relay was the
only thing that was broken.

## Status of `qjoijoxmnliarlyaqmoz`

Applied on 2026-09-27 and verified against the live database, through a direct
Postgres session (`aws-0-<region>.pooler.supabase.com:5432`, user
`postgres.<ref>`, the database password) because `db.<ref>.supabase.co` does not
resolve from this machine and the Management API token then on hand refused to
authenticate. Everything since — 0008's confirmation, 0009, 0010, the `APP_URL`
secret and the `reminder-sender` redeploy — went through the Management API on
2026-09-28 with a token that does.

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

- `e2e/apply-migration.mjs` has still never completed a run, but the reason is
  no longer the endpoint: a personal access token belonging to this account
  answers `200` on `/v1/projects` and ran migration 0010 on 2026-09-28 through
  `POST /v1/projects/<ref>/database/query` (the token tried on 2026-09-27 was
  simply dead). The script is now a re-verification tool rather than the only
  way in — it will detect `public.question` and skip the apply step, and it
  applies **0001 only**, so a project missing 0002–0010 is not fixed by running
  it.
- The adapter has been driven against the live database by the sweep rather than
  method by method: `e2e/replay-sweep.mjs` reports **19/19** on
  `qjoijoxmnliarlyaqmoz` (first completed run 2026-09-28, through
  `SUPABASE_SERVICE_ROLE_KEY` after the pooler route stopped resolving), covering
  the hierarchy, a graded session, notes, both share types, the whole link
  surface, settings, activity, the reminder and push rows and the Test Builder
  mirror, as two signed-in users plus one deliberately unconfirmed account.
  `lib/supabase/adapter.test.ts` (41 cases) still proves the shapes against a
  fake transport and `tsc` proves all 77 methods against `backendInterface`; what
  the sweep adds is that the database answers. The 12 methods the adapter
  deliberately refuses are **not** covered by the sweep — they never reach the
  database, so their proof stays the unit tests and the documentation in
  `lib/supabase/system.ts`.
- The archive importer (`lib/archiveImport.ts`, offered from Settings) is written
  and tested against the mock backend, but it has not run against this database.
  It restores the library, not the practice history, because `start_session`
  dates an attempt server-side — an export of past attempts would move every one
  to today.
- `functions/ai-proxy` **is deployed** and has answered a real signed-in request
  (verified 2026-09-28: an unauthenticated call is refused `401`, and a request
  carrying a session token reaches the provider). It is still not wired to the
  studio — no frontend code calls it, so the extraction path in the browser keeps
  using the reviewer's own key. Deploying it is necessary for that to change, not
  sufficient.
- Backups, PITR and the restore drill are written down in `OPERATIONS.md`, and
  the nightly workflow exists, but neither has run: the Free plan caps the
  database at a seven-day PITR window, and no dump has ever been restored.
  `backup/restore.mjs` now makes the restore itself a command rather than a
  procedure, but it has only ever been exercised against a simulated database —
  both transports, every refusal path, a deliberately broken count — never
  against a real project, and `backup.mjs` has never produced a snapshot. Until
  those two things happen the honest statement is "we can restore", not "we can
  recover".
- Migrations 0001–0011 are **applied**. Verified 2026-09-27 by probing PostgREST
  with the publishable key alone: `question`, `custom_session`,
  `reminder_settings` and `reminder_log` answer 401 (table exists, zero `anon`
  grants) while the dropped `ai_draft` answers 404 — which also proves 0005
  ran. Re-verified 2026-09-28 over the Management API: `push_subscriptions`
  resolves (0009), `reminder_digest`'s body references `custom_session` (0010),
  and the three helpers' ACLs read `postgres` + `service_role` only (0008),
  which the publishable key confirmed by getting `401 / 42501` from
  `reminder_digest` and `due_reminders`.
- `functions/reminder-sender` **is deployed** — version 10 on 2026-09-28, built
  from this repository's `supabase/functions/reminder-sender/index.ts`. Every
  secret it reads is set (`BREVO_API_KEY`, `BREVO_FROM`, `RESEND_API_KEY`,
  `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and now `APP_URL`), and
  the pipeline was proven end to end the same day: a tick carrying `CRON_SECRET`
  answered `{"ok":true,"results":[{"email":"mm***@gmail.com","status":"sent"}]}`
  and wrote a `sent` row naming the channel —
  `[via brevo] [push skipped: no subscription for this account]`. The `pg_cron`
  tick was scheduled and exercised live earlier the same week; the `cron` schema
  is not reachable over PostgREST from this machine, so re-confirm with
  `select * from cron.job` in the SQL editor if in doubt.
- `studyforge.custom-sessions.v1` (Test Builder runs and their results) is not
  in the archive the exporter writes, and not erased by "Clear local data". It
  does have a table — `custom_session` (0002), fed by `lib/customSync.ts` as
  each run finishes, merged into dashboard progress and, since 0010, into the
  digest — but only the runs taken **while signed in on Supabase** are there. A
  device that built tests on the mock backend has history this project cannot
  mail.

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
