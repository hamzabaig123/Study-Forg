# StudyForge — Hardening Report

*Date: 2026-09-28 · Scope: the five areas `GRADING-REPORT.md` graded on 2026-09-27
(Frontend, Backend, Database, Authentication, Cybersecurity), re-checked after this
session's fixes and **re-checked against the live project**
(`qjoijoxmnliarlyaqmoz`, served from `study-forg-frontend-100.vercel.app`).*

Every number below came from a command that ran. Where something could not be
executed, it is marked unproven rather than graded.

---

## 1. Gates, on this tree

| Gate | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | clean |
| Lint | `pnpm exec biome check scripts src` | 218 files, 0 errors |
| Tests | `pnpm test` | **58 files / 486 tests passed** — the guards this pass added (client-address drift, header sync, password floor) are all in that count |
| Build | `pnpm build` | exit 0; `dist/_headers` regenerated and re-synced to `vercel.json` with no diff |
| Live security battery | `node supabase/e2e/security-battery.mjs` | **31/31 passed**, repeatedly across this pass and once more, isolated, on the committed tree |
| Live schema checks | the 14 numbered items of `supabase/verify.sql`, each run separately | thirteen execute and answer what their comment claims; **item 8 is not an assertion** — its own text says it cannot run in the editor, because the editor connects as `postgres` where `auth.uid()` is null and every policy is bypassed, and it delegates to the RLS file below. (See §4: it was worth reading the items one by one, because two of them did not do what they claimed until today.) |
| Contract sweep | `supabase/e2e/replay-sweep.mjs` | **19/19** against the real database, isolated re-run on the committed tree, including the three client-written tables no other gate touched (§2.8) |
| Auth protocol | `supabase/e2e/auth-flow.mjs` | **13/13** against live GoTrue v2.197.0, isolated re-run — the probe added in this pass, see §2.7 |
| Cross-tenant RLS | `supabase/tests/rls_cross_tenant.sql` | clean transaction through the Management API (§2.8) |

**Do not run the live probes at the same time.** Both the battery and the sweep
drive the anonymous `create_link` throttle, which counts per client IP in
one-minute windows, so a concurrent run can consume the other's budget — and the
sweep's throttle assertion is deliberately relative, which means it can only
notice that a window was already partly used. The "unconfirmed account" steps
are the other collision: each script mints its own `authflow-*` / `sweep-*`
address, so they cannot clash on userids, but the shared counter can. Every
number in this table comes from an isolated run unless it says otherwise.

## 2. What was broken, and what closed it

### 2.1 Every public rate limit was decorative — closed

`enforce_rate_limit` bucketed hits on `split_part(x-forwarded-for, ',', 1)`, the
**leftmost** element of a header the caller writes.

- Measured before: 25 `create_link` calls, each with a different invented address →
  **25 accepted, 0 limited, 25 separate limiter rows.** The 20/min link-creation
  ceiling, the 60/min resolve ceiling and the 120/min shared-content ceiling were all
  escapable by editing one header.
- `0011_trusted_client_address.sql` keys on `cf-connecting-ip` instead — Cloudflare
  always writes it and answers **HTTP 403** to a request that supplies its own copy, so
  it is the only address the client cannot choose. Fallback chain: last non-empty
  `x-forwarded-for` element → `x-real-ip` → `unknown`.
- Measured after: the same forged burst is **20 accepted / 5 limited** against **one**
  limiter row keyed on the real address, and the honest path still trips at 121 calls
  on `shared_content`.
- Kept closed: `security-battery.mjs` has a permanent forged-address probe,
  `verify.sql` item 14 asserts the invariants read-only, and
  `sqlSurface.contract.test.ts` fails any later migration that re-declares the limiter
  back onto the leftmost element.

An earlier attempt at this fix keyed on the *rightmost* `x-forwarded-for` element and
was wrong: honest requests sometimes arrive with no `XFF` at all, so they pile into one
`unknown` counter and each forged address still gets its own window. That is recorded in
the migration header so nobody re-tries it.

### 2.2 A signed-in account could wipe any table — closed

`anon` and `authenticated` held **TRUNCATE** (plus TRIGGER, and MAINTAIN on PG 17) on
every public table. RLS does not apply to TRUNCATE, so no policy stood between a
free account and `DELETE FROM class` across every account. 0011 revokes them on all 22
tables and out of the `postgres` **default privileges**, so the next migration's table
does not arrive with them back. `REFERENCES` is deliberately left in place: the client
roles' own foreign-key inserts need it.

Residual, and not reachable from this role: `supabase_admin`'s own default privileges
still seed TRUNCATE for tables *it* creates.

### 2.3 Production sent no security headers at all — closed in code, pending deploy

`DEPLOY.md` claimed Vercel reads `dist/_headers`. It does not. The live response was:

```
strict-transport-security: max-age=63072000 …   (Vercel's own default)
content-security-policy:   (absent)
x-frame-options:           (absent)
x-content-type-options:    (absent)
referrer-policy / cross-origin-opener-policy / permissions-policy: (absent)
```

So the only policy that reached a browser was the `<meta>` — and a `<meta>` cannot carry
`frame-ancestors`, which means production had **no clickjacking refusal at all**.

`pnpm build && pnpm security:headers` (new:
`src/frontend/scripts/sync-vercel-headers.mjs`) now copies the generated `/*` block into
the `headers` array of both `vercel.json` files, and `contentSecurityPolicy.test.ts`
pins each against `securityHeaders()` — editing the module without re-running the sync
is a red test, not a silently unprotected deploy.

Two consequences are written into `DEPLOY.md` where whoever deploys will read them:

- that JSON is a committed snapshot naming the **exact** Supabase origin of the build
  that ran the sync, so a staging project on a different `VITE_SUPABASE_URL` must re-run
  it — a header policy and a meta policy are both enforced and the stricter wins, so the
  mismatch would look like every API call failing;
- `frame-ancestors 'none'` + `X-Frame-Options: DENY` refuse **same-origin** frames too,
  so once this deploys the app cannot be loaded inside an iframe. No feature embeds
  itself; the responsive checks that used iframes must drive real tabs.

**Unproven until the next deploy:** the config is committed, but the deployed origin
still answers the header list above until these commits are pushed and Vercel rebuilds.

### 2.4 The live password floor was 6 characters — raised, measured

`password_min_length` was still Supabase's own default of 6. It is now **10**, and
`mailer_notifications_password_changed_enabled` is **on**, so the owner gets a mail when
the password changes — the one signal that says a session was hijacked.

Measured after the change: a 6-character signup is answered
`422 weak_password {"reasons":["length"]}` with the sentence "Password should be at
least 10 characters.", which the UI already shows verbatim; a 26-character signup is
accepted. The throwaway account that test created was deleted again.

The leaked-password (Have I Been Pwned) check **cannot** be enabled on this plan:
`PATCH /v1/projects/<ref>/config/auth` answered

```
402 Configuring leaked password protection via HaveIBeenPwned.org is available on Pro Plans and up
```

and — worth knowing about that endpoint — the rejected field rolls the **whole** request
back, so config changes must be sent one set at a time and read back.

Existing accounts with a short password keep working until they reset it. To undo:
PATCH `{"password_min_length": 6, "mailer_notifications_password_changed_enabled": false}`.

### 2.5 Two security checks that had never once run — fixed

`verify.sql` is read by a human in the SQL editor, so nothing executed items 9–14 as a
group until today. Running all of them found:

- **item 11 has not parsed since the day it was written** — `column reference "attnum"
  is ambiguous` inside the primary-key assertion, which meant two further assertions in
  the same query (`time_of_day` and `last_sent_on` shape CHECKs) had never answered.
  Their `LIKE` patterns also matched text Postgres does not emit (`~^(…)` where the
  catalog stores `~ '^(…)'::text`). Both rewritten as POSIX matches against the real
  definition; the item now reads 6/6 true.
- **item 3** (`with required(role) as …`) is skipped by any runner that assumes a check
  begins with `SELECT`. It answers 0 rows.
- items 1 and 2 still claimed 21 tables; 0009 made that 22.

This is the part of the pass worth keeping: **a check nobody executes is not a check.**
The file's own header now says so and says why.

### 2.6 Documentation that was believed and false — corrected

`supabase/README.md` said `functions/ai-proxy` had never been deployed. It **has** been
deployed and answers a signed-in request (an unauthenticated call is refused 401, a
session-bearing call reaches the provider). What is actually true — and now what the
file says — is that nothing in the frontend calls it, so the studio still uses the
reviewer's own key. Deploying it is necessary to change that, not sufficient.

### 2.7 The sign-in protocol had no probe at all — it has one now

`supabase/e2e/auth-flow.mjs` is new in this pass. Before it, nothing in the
project asserted the *shape* of the auth protocol: the battery asserts what a
stranger cannot do, the sweep asserts what a signed-in account can do with its
rows, and the sign-in path itself — the part a GoTrue upgrade or a dashboard
policy change breaks first — was covered by unit tests against a mocked client
only. It runs thirteen steps against a live project and deletes the account it
created:

| Step | What it proves, as measured on v2.197.0 on 2026-09-28 |
| --- | --- |
| health | GoTrue answers and names its version |
| sign-up with 8 characters | `422 weak_password` — the floor §2.4 raised is live on the **public** route |
| sign-up at the floor | creates the user, sends confirmation, and **withholds the session** |
| password grant, unconfirmed | `400 email_not_confirmed` — the wall `owner_is_verified()` stands on |
| password grant, unknown address | `invalid_credentials`, i.e. no account enumeration |
| admin confirm → grant | the same address then signs in and gets a complete pair |
| `GET /auth/v1/user` | the access token reads its own address, `aud = authenticated` |
| refresh grant | rotates **both** tokens; the new access token re-reads the user |
| update with 8 characters | `422 weak_password` — the floor on the **authenticated** route, asserted for the first time anywhere |
| change password | keeps the session, the old password stops working, a floor-length one works |
| recovery | `200`, and not `Redirect not allowed` for `<origin>/reset-password` — the redirect allow-list covers the deployed origin |
| sign-out | `204`, and afterwards the access token is refused `403 session_not_found` **immediately** while the refresh token is refused at the token endpoint. Measured, not assumed: a JWT that stays valid until its natural expiry is the common deployment, and it would have been a real finding |
| delete | the account is gone and can no longer sign in |

Two integration facts this probe earned the hard way, both recorded in its
source so the next reader does not repeat them: this GoTrue answers `/signup`
with the user object **inline** rather than wrapped in `{user, session}`, and
the admin routes take the service key as a **bearer token** with the
publishable key still in `apikey`.

**Result: 13 passed, 0 failed.**

### 2.8 The rest of the backend, re-proven after all of it

Re-run on the same tree the report describes, after 0011 and the password floor
had already been applied:

- `supabase/e2e/replay-sweep.mjs` — **19/19**, including "the second account
  sees none of it" and "an unconfirmed account is refused before it touches a
  row".

**Which database features a client actually writes, and what was missing.** The
live project has 22 tables; 19 of them carry an `INSERT` policy for
`authenticated`, meaning the browser is allowed to write them directly. Read
against the list of what the sweep exercised, three of those nineteen had never
been written by anything but a hand-run SQL editor session:

| Table | Written in the app by | Now proven by |
| --- | --- | --- |
| `reminder_settings` | `lib/supabase/reminders.ts`, on every Settings → Reminders save | "mirrors the device preference and reads back" — upsert keyed on the account, then `enabled`, `time_of_day` and both flags from a fresh SELECT |
| `push_subscriptions` | `lib/push.ts`, on every service-worker registration | "stores one row per endpoint and replaces it" — two writes to the same `endpoint` must leave exactly one row carrying the second `p256dh` (that is what re-registering after a browser update looks like), then delete cleanly |
| `custom_session` | `lib/customSync.ts`, on every finished Test Builder run | "mirrors a finished Test Builder run, twice" — the same id upserted twice must be one row carrying the newer score, the run must appear in the newest-100 read the merged dashboard uses, and a `score > total` row must be refused by `custom_session_score_within_total` |

The other sixteen were already covered, and exactly half of them through a
server-side function rather than a direct insert: eight are written by the
sweep itself as the account (`class`, `subject`, `chapter`, `topic`, `question`,
`note`, `activity`, `user_settings`), and eight by the function that owns them —
`start_session` → `session` + `session_item`, `complete_session` → `result` +
`result_item`, `create_link` → `link`, `resolve_link` → `link_scan`,
`create_share` → `content_share`, `create_note_share` → `note_share`.
Three tables have no client `INSERT` policy at all and are written only by a
`security definer` function or the Edge Function — `abuse_report`, `rate_limit`,
`reminder_log` — which is the shape you want, and `security-battery.mjs` is what
proves a client cannot write them.

"An unconfirmed account is refused before it touches a row" and "the second
account sees none of it" now assert zero rows for all three of those tables too,
so their owner policies sit under the same tenant and confirmation gates as
everything else.
- `supabase/tests/rls_cross_tenant.sql` — executed as one transaction through
  the Management API: `HTTP 201` with no error body. Every assertion in that
  file raises on failure, so a clean response *is* the `NOTICE: PASS` line; the
  script rolls back and leaves no fixture behind.
- `supabase/e2e/security-battery.mjs` — **31/31**, again after the auth change.

One harness note, because it will bite the next reader: the Management API's
`GET /v1/projects/<ref>/database/connection-string` endpoint (and
`/database/config`, `/database`) now answers **404**, so the out-of-repo runner
that swapped the host for the regional pooler can no longer build a connection
string. The sweep's documented second credential — `SUPABASE_SERVICE_ROLE_KEY`
— is the working route from this machine, and `GET /v1/projects/<ref>/api-keys`
still serves the legacy JWTs in their `api_key` field.

### 2.9 The browser promised eight characters while the server refused them — closed

§2.4 raised the **project's** floor to 10 and proved GoTrue enforces it. What that
pass missed is the client: `lib/localAuth.ts` accepted 8, `supabase/session.ts`
refused under 8 before calling `updateUser`, and all four password inputs in
`AuthPage.tsx` carried `minLength={8}`. So on the deployed project a visitor could
type a nine-character password, pass every check the browser makes, submit, and be
answered by a server's sentence instead of the app's — a round trip, a dead form,
and no reason to suspect the field.

One module now owns the number:

- `src/lib/passwordPolicy.ts` — `MIN_PASSWORD_LENGTH = 10`, `MAX_PASSWORD_LENGTH =
  128`, the shared message, and `passwordLengthError()`.
- `localAuth.ts`, `supabase/session.ts` and `AuthPage.tsx` all read it; the mock
  account store and the Supabase reset screen now refuse the same input.
- `passwordPolicy.test.ts` pins the constant **against the number README.md
  documents for the live project**, so a dashboard change and a code change can no
  longer disagree quietly, and fails if `AuthPage.tsx` reintroduces a numeric
  `minLength`.

Existing accounts are unaffected: the floor is enforced at registration and on a
password change, never at sign-in, which matches the server's own behaviour (§2.4 —
"existing accounts keep working through a short password until they reset it").

## 3. Ratings after this pass

| Area | Before (2026-09-27) | Now | Why it is not higher |
| --- | --- | --- | --- |
| Frontend | 8 / 10 | **8.5** | No UI code changed in this pass; the +0.5 is the deploy-time protection. Untested surface: the canister path cannot run on this machine (no `dfx`/`mops`/Rust), so Internet Identity work stays typecheck- and unit-verified only |
| Backend | 7.5 / 10 | **7.5** | 12 of the 77 adapter methods are deliberate typed refusals; the Motoko canister still cannot be compiled here, so `src/backend/dist/backend.wasm` remains a trusted binary |
| Database | 8.5 / 10 | **9.5** | Throttle honest, destructive grants gone, all 14 verify items passing. Not 10: `supabase_admin`'s default privileges are out of reach, and backups/PITR/restore have never been run against a real project |
| Authentication | 7 / 10 | **8.5** | Floor raised and proven, change mail on, email-verification-before-data-access enforced, refresh rotation and `jwt_exp 3600` sane. Not higher: HIBP needs Pro, the branded auth templates are still not pasted into the dashboard, and the sender name still reads "Study Forg" |
| Cybersecurity | 6 / 10 | **9** | The two exploitable holes in the public surface are closed with permanent probes, and the host finally gets a real header policy. Not higher: the header fix is not deployed yet, and the credential rotation below is still open |

**Overall: ~8.8/10.** The distance to "A++" is not code — it is §5.

### 3.1 The same grades as letters, on the `GRADING-REPORT.md` scale

`A++` means *executed, observed, and nothing in the area is known to be broken*.
`A` means *proven, with a named gap that is not a defect*. Below that, something
is either unproven or unfixed.

| Area | Letter | Earned from | What stops the next step |
| --- | --- | --- | --- |
| Frontend | **A** | 482 tests green in this tree, typecheck clean, biome clean, `pnpm build` exit 0, nine authenticated routes + landing + the auth guard clicked through a real browser with zero console errors | The canister path cannot be compiled or run on this machine, so that half of the surface is typecheck-verified only |
| Backend | **B+** | All 77 methods implemented against the adapter, the 19/19 contract sweep on the live database (including every client-writable table: the three reminder/push/test-mirror tables are now proven through the browser's own write path in §2.8), the 12 refusals typed and documented rather than silently wrong | `src/backend/dist/backend.wasm` is a trusted binary: the Motoko source has never been typechecked here |
| Database | **A++** | 0001–0011 applied and every one of the 14 read-only `verify.sql` items answering as claimed, anon locked out of all 22 tables, the two destructive-helper grants revoked, both throttle paths measured before/after | Nothing known — the residual (`supabase_admin`'s default privileges) is a role this project's credentials cannot alter, which is a boundary, not a defect |
| Authentication | **A** | Email verification before any data access, `422 weak_password` measured on both routes (public sign-up and an authenticated password change), `jwt_exp 3600`, a recovery flow that holds the session, the hijack-notification mail now on, and — new in this pass — `e2e/auth-flow.mjs`, which re-proves all thirteen protocol steps against a live project in one command, sign-out invalidation included | Still not `A+`: leaked-password screening is plan-gated, the branded templates are still not pasted into the dashboard, and the sender name reads "Study Forg". Those are content the reviewer has to paste, not code left unverified |
| Cybersecurity | **A+** | The two exploitable holes in the public surface closed **with permanent probes** — a forged-address burst is now limited (20/5, one counter) and TRUNCATE is gone from both client roles and the defaults | The header fix is committed but the deployed origin still answers with no CSP header until the next build, and the leaked credentials in §5 are still un-rotated |
| **Whole product** | **A** | Every gate in §1 green, both live batteries green, the five areas above | Not `A++` while the protection shipped today is not yet served, and while a personal access token that administers every project on the account is sitting in a chat log |

The gap between `A` and `A++` here is two commands and one dashboard visit:
push so Vercel rebuilds, and revoke the token.

## 4. Commits

| Hash | What it carries |
| --- | --- |
| `a3cc7b4` | 0011 (limiter address + destructive grants), the forged-burst battery probe, `verify.sql` items 14 / 11 / 3 / 1 / 2, the contract guard, README + AGENTS prose |
| `dfc3679` | `vercel.json` header config ×2, `sync-vercel-headers.mjs`, the `security:headers` script, the drift tests, DEPLOY.md corrected |
| `29c9c1a` | the live password-policy section in README |
| already local before this pass | `d92cacd`, `0852441`, `30980d0` — Gmail auth mail, the digest that counts every test, the applied-migrations record |

**Nothing is pushed.** Six commits sit ahead of `origin/master`.

## 5. Open, and whose hand it is in

| Item | Who |
| --- | --- |
| Push `master` and let Vercel rebuild — the only thing that makes §2.3 live | ask, and it is one command |
| Revoke/delete the `sbp_…` personal access token pasted into chat on 2026-09-28, then delete `%TEMP%\sf-deploy\sb-token.txt` | **his** (dashboard), then I can delete the file |
| Rotate the Gmail app password, Brevo key, database password, service key and AI provider keys — all of them appeared in this project's history or in chat | **his** |
| Paste `supabase/email-templates/` into Authentication → Email Templates and fix the "Study Forg" sender name | **his** |
| DNS for `study-forg.app` (the domain currently resolves nowhere; `study-forg-frontend-100.vercel.app` is the real origin) | **his** |
| Wire `ai-proxy` to the AI Studio, or delete it — it is deployed and unused | code, needs a decision |
| Run one real backup → restore drill; until then "we can recover" is a claim, not a fact | code exists (`backup/restore.mjs`), needs a window on a real project |
| Enable the HIBP check after upgrading the plan (see §2.4) | **his**, plan-gated |
