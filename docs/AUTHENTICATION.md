# StudyForge — Authentication

*Version 1.0 · 2026-09-29. How sign-in works, what the database enforces, and
the measured configuration of the live project.*

## 1. Model

Email + password, provided by **Supabase GoTrue** (measured v2.197.0). One
account owns every row it creates; there is no OAuth, no magic link, no MFA —
the app never calls `updateUser` for email changes, and the canister's Internet
Identity path cannot federate with Supabase (no OIDC endpoint/JWKS to trust),
so the two auth worlds are separate by design.

Two dev-only variants exist beside it: the **localStorage mock** keeps local
PBKDF2-hashed accounts (`studyforge.personal-accounts.v1`) for tests and
offline work, and the canister path keys on Internet Identity principals. The
same frontend guards serve all three.

## 2. The floor, the wall, and the door

- **Floor**: passwords are at least **10 characters**. One constant
  (`src/lib/passwordPolicy.ts`, `MIN_PASSWORD_LENGTH = 10`) is read by the mock
  auth, the Supabase session and every form input; a test pins it against the
  live project's recorded config. Enforced at registration and on password
  change — never at sign-in, so older accounts keep working.
- **Wall**: email confirmation is enforced **in the database**, not in the UI —
  `owner_is_verified()` sits on every owner table, so an unconfirmed account is
  refused before it can touch a row, whatever client it uses. Sign-in before
  confirmation answers `400 email_not_confirmed`.
- **Door**: no enumeration — an unknown address gets the same
  `invalid_credentials` as a wrong password (measured).

## 3. Sessions

- Access token: **1 hour** (`jwt_exp 3600`). Refresh token: rotating — each
  refresh invalidates both tokens and issues new ones (measured).
- Sign-out is immediate: the access token is refused `403 session_not_found`
  the moment logout completes (measured — a token does **not** live out its
  hour).
- Password change keeps the session alive; the old password stops working; the
  account owner is notified by mail (hijack signal; the body is still
  Supabase's default).

## 4. The flows

| Flow | Path | Details |
| --- | --- | --- |
| Register | `/register` → `/verify-email` | confirmation mail branded (`From: StudyForge`), link lands on the deployed origin; the address travels in `?email=` |
| Sign in | `/login` | optional Turnstile token when the project switch is on |
| Re-send confirmation | `/verify-email` | same gate and mail as registration |
| Forgot password | `/forgot-password` → mail → `/reset-password` | the reset **session** authorises the change; redirect origin must be allow-listed or GoTrue burns the link and refuses |
| Change password | Settings → Security | re-authenticates with the current password (and a Turnstile token when configured) before `updateUser` |

Branded confirmation and recovery templates live in `supabase/email-templates/`
and are pinned byte-identical to the live project by `e2e/auth-mail-brand.mjs`
(17 assertions, no mail sent). The `From` **address** is the SMTP account until
the relay moves to a verified sending domain — Gmail refuses a `MAIL FROM`
outside its own.

## 5. The human check

Cloudflare Turnstile is **env-gated and fail-closed**: with
`VITE_TURNSTILE_SITE_KEY` unset, no widget is fetched and every request is
byte-identical to a no-captcha build. With the project's `security_captcha_enabled`
switch on, the token gates **sign-up, sign-in, confirmation re-send and reset**
— and a widget that cannot load keeps the submit disabled ("Try again") rather
than sending unproven. Order matters: ship the client's site key before
throwing the project switch, or every sign-in reads as a wrong password.

## 6. Measured live configuration (read 2026-09-29)

| GoTrue field | Value |
| --- | --- |
| `password_min_length` | 10 |
| `password_required_characters` | null — no character-class rule; `aaaaaaaaaa` passes (a recorded choice; tighten with one `PATCH /config/auth`) |
| `sessions_inactivity_timeout` | 0 — no idle sign-out; rotation governs |
| `jwt_exp` | 3600 |
| `mailer_autoconfirm` | false |
| Leaked-password (HIBP) check | **not available on this plan** (402; Pro and up) |

## 7. Where it is enforced (code map)

| Concern | Code |
| --- | --- |
| Floor constant + messages | `src/lib/passwordPolicy.ts` (pinned by `passwordPolicy.test.ts`) |
| Supabase session, grants, refresh | `src/lib/supabase/session.ts` |
| Mock accounts (PBKDF2, 210k iterations) | `src/lib/localAuth.ts` |
| Forms + floor + captcha wiring | `pages/AuthPage.tsx`, `hooks/useCaptchaToken.ts` |
| Captcha seam | `src/lib/turnstile.ts`, `components/common/CaptchaField.tsx` |
| Database-side verification wall | `owner_is_verified()` on every owner table (`migrations/0001_init.sql`) |
| Live protocol proof | `supabase/e2e/auth-flow.mjs` (13 steps) |

## 8. Known limits

- `password_required_characters` is null by choice: `aaaaaaaaaa` is a valid
  password today. Tighten it with one `PATCH` (one field per call — the
  endpoint rolls a whole body back on a rejected key).
- HIBP breach screening is plan-gated (the client-side k-anonymity check in
  `passwordPolicy.ts` already talks to the pwnedpasswords range API with the
  prefix uppercased, `cache: no-store`, and degrades to "no opinion" offline).
- The `From` address is the authenticating Gmail account until the relay has a
  verified sending domain (`study-forg.app` DNS is still pending).
- Internet Identity has never been executed (no `dfx` locally); it is
  typecheck- and unit-verified only.
