# StudyForge — Database Schema

*Version 1.0 · 2026-09-29. Supabase Postgres, project `qjoijoxmnliarlyaqmoz`.
**0001–0015 all applied and verified**; RLS forced on every table. Source of
truth: `supabase/migrations/` (15 files), asserted by `supabase/verify.sql`,
`tests/rls_cross_tenant.sql` and the 46-check live battery.*

## 1. The shape in one paragraph

Everything an account owns hangs off `auth.uid()`. The content tree is
`class → subject → chapter → topic → question` (+ `note` beside questions).
Practising writes `session` + `session_item`, then `result` + `result_item`
through definer functions that own grading. Publishing writes `link` (short
code + QR), `link_scan` (analytics), `content_share` / `note_share` (read-only
pages). Settings, reminders and push are per-account mirrors. A third group —
`abuse_report`, `rate_limit`, `reminder_log`, `csp_violation` — is written only
by definer functions or Edge Functions and has **no** client policies at all.

## 2. Tables (22)

| Group | Table | Purpose | Written by |
| --- | --- | --- | --- |
| Content | `class`, `subject`, `chapter`, `topic` | the 4-level tree, `name` + `description`, cascade deletes downward | client (INSERT policy for `authenticated`) |
| Content | `question` | topic questions; `question_type` CHECK (`multipleChoice`/`trueFalse`/`shortAnswer`), `answer` jsonb, `explanation` | client |
| Sessions | `session`, `session_item` | one practice/timed run; items are the question snapshot in order | `start_session` (definer) |
| Sessions | `result`, `result_item` | graded outcome; `score`/`total`; graded with `for update` locks so a double-tap cannot write twice | `complete_session` (definer) |
| Notes | `note` | block-document workspace per topic, revision-tracked (`for update` on save) | client |
| Sharing | `content_share`, `note_share` | read-only pages; tokens are CSPRNG | `create_share` / `create_note_share` (definer) |
| Links | `link` | short code `code` **CHECK length 10–12** (49.6-bit floor), `target_url`, `status`, `edit_token_hash`; managed by token | `create_link` (definer, `anon`-granted) |
| Links | `link_scan` | one row per resolve with derived country/platform | `resolve_link` (definer, `anon`-granted) |
| Settings | `user_settings` | display name, study goal, daily target, `appearance` CHECK (`light`/`dark`/`frosted`/`maroon`) | client |
| Reminders | `reminder_settings` | per-account daily time + toggles | client |
| Reminders | `reminder_log` | every digest attempt, failures included | `reminder-sender` Edge Function only |
| Push | `push_subscriptions` | one row per endpoint, upsert-replace | client |
| Builder | `custom_session` | Test Builder runs mirrored by the browser; `score ≤ total` CHECK | client (upsert on own id) |
| Abuse | `abuse_report` | visitor reports on links | `report_link_abuse` (definer, `anon`-granted) |
| Limits | `rate_limit` | `(bucket, ip)` window counters | `enforce_rate_limit` (definer) + `ai-proxy` (service key) |
| Telemetry | `csp_violation` | CSP violations, keyed `(directive, blocked_host, route, disposition)`, `hits` counter; nothing identifying a visitor | `record_csp_violations` (service_role, via `csp-collector`) |

## 3. Row-Level Security model

- **Owner tables** (19 of 22 carry an INSERT policy for `authenticated`): every
  policy requires `auth.uid() = owner_id` **and** `owner_is_verified()` — an
  unconfirmed account is refused before touching a row, whatever client it uses.
- **Anon is locked out of everything** except what a definer function does for
  it; the battery proves `401` on all 22 tables directly, and
  TRUNCATE/TRIGGER/MAINTAIN are revoked from `anon`, `authenticated` **and**
  the `postgres` default privileges (RLS does not apply to TRUNCATE — that
  grant was a cross-tenant wipe one `DELETE FROM class` away).
- **Service-only tables** (`abuse_report`, `rate_limit`, `reminder_log`,
  `csp_violation`) have no client INSERT policy at all.
- The cross-tenant file `tests/rls_cross_tenant.sql` raises on any leak and
  rolls back; last run clean through the Management API.

## 4. Key functions (definer unless noted)

| Function | Does |
| --- | --- |
| `start_session(p_scope, p_mode, …)` | validates scope + duration, snapshots questions into `session_item` |
| `complete_session(p_session_id)` | grades under `for update`, writes `result`/`result_item`, refuses a second write |
| `create_link(p_target_url, p_code, p_edit_token)` | validates URL (`badUrl`), code against `^[2-9a-hjkmnp-z]{10,12}$` (`badCode`), token ≥ 24 (`badToken`); throttled |
| `resolve_link(p_code)` | answers one shape for every state (active, paused, deleted, expired, rate-limited); records the scan |
| `report_link_abuse(p_code, p_reason)` | 20/min per address; **answers `{"ok":null}` for issued and never-issued codes alike** (no existence oracle); writes only `if found` |
| `enforce_rate_limit(bucket, ip, limit, window)` | the throttle; keyed on `cf-connecting-ip` → last non-empty XFF → `x-real-ip` → `unknown` |
| `reminder_digest` / `due_reminders` | service-only (`postgres` + `service_role`); the Edge Function reads due digests |
| `record_csp_violations` | groups a batch, upserts on the violation key, `service_role` only |
| `create_share` / `create_note_share` | CSPRNG tokens; the token is the only address for management |

## 5. Migration history (all applied)

| Migration | What it did |
| --- | --- |
| `0001_init` | 18 tables, RLS, 32 functions, the hierarchy + sessions + sharing core |
| `0002_rate_limits` | `enforce_rate_limit` + `custom_session` (order-sensitive: before 0003) |
| `0003_short_code_entropy` | `link.code` widened to `{7,12}`, re-declared `create_link` |
| `0004_correctness` | nine behaviour fixes: `for update` locks, cast-free trueFalse grading, duration bound, locale-as-country fix, throttle reason passthrough, limiter re-revoke, five indexes |
| `0005` / `0006` / `0007` | limiter grant shape; the 0006 walk-back lesson; digest support |
| `0008_helper_function_lockdown` | idempotent revokes of the service-only helpers, applied **last**, ending with `notify pgrst, 'reload schema'` |
| `0009` / `0010_digest_counts_every_test` | schema growth; the digest sums `result` **and** `custom_session` |
| `0011_trusted_client_address` | limiter keyed on `cf-connecting-ip`; TRUNCATE/TRIGGER/MAINTAIN revoked everywhere |
| `0012_maroon_appearance` | `user_settings.appearance` CHECK widened to include `maroon` |
| `0013_abuse_report_throttle_and_oracle` | 20/min bucket + one body either way (existence oracle closed) |
| `0014_short_code_floor` | `link.code` floor 7 → 10 (the 49.6-bit rule), counts before it alters |
| `0015_csp_violation_reports` | the violation table + `record_csp_violations`, service-role only |

## 6. Operational notes

- Reads/writes go through PostgREST (`/rest/v1`) with the publishable key;
  RLS is the security boundary, not the key.
- `verify.sql` (16 items) asserts grants, constraints and the limiter key
  read-only; `sqlSurface.contract.test.ts` reads the migration files and fails
  on drift (limiter key, entropy floor, oracle, grants).
- Applied via `supabase/e2e/apply-migration.mjs` (Management API) or the SQL
  editor; order matters only where headers say so (0002 before 0003/0004).
- **No backup has ever been dumped or restored** — the drill in
  `supabase/OPERATIONS.md` is written and is the one operational claim left
  unproven.
