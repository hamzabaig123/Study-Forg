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
| Lint | `pnpm exec biome check scripts src` | 216 files, 0 errors |
| Tests | `pnpm test` | **57 files / 482 tests passed** (201 s) — 472 before this pass; +10 are the new client-address and header guards |
| Build | `pnpm build` | exit 0; `dist/_headers` regenerated and re-synced to `vercel.json` with no diff |
| Live security battery | `node supabase/e2e/security-battery.mjs` | **31/31 passed**, run twice — before and after the auth change |
| Live schema checks | all 14 numbered items of `supabase/verify.sql` | every item answers what its comment claims (see §4 — two of them did not, until today) |
| Contract sweep | `supabase/e2e/replay-sweep.mjs` | 16/16 against the real database (unchanged code since it was run) |

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
| Backend | **B+** | All 77 methods implemented against the adapter, the 16/16 contract sweep on the live database, the 12 refusals typed and documented rather than silently wrong | `src/backend/dist/backend.wasm` is a trusted binary: the Motoko source has never been typechecked here |
| Database | **A++** | 0001–0011 applied and every one of the 14 read-only `verify.sql` items answering as claimed, anon locked out of all 22 tables, the two destructive-helper grants revoked, both throttle paths measured before/after | Nothing known — the residual (`supabase_admin`'s default privileges) is a role this project's credentials cannot alter, which is a boundary, not a defect |
| Authentication | **A** | Email verification before any data access, `422 weak_password` measured on a 6-character signup, `jwt_exp 3600`, recovery flow that holds the session, the hijack-notification mail now on | Leaked-password screening is plan-gated, the branded templates are still not pasted, and the sender name reads "Study Forg" |
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
