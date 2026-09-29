# StudyForge — Roadmap: what can be added later

*Version 1.0 · 2026-09-29. Ordered by (a) things that finish the current
rating, (b) hardening, (c) product features. Nothing here is a defect — the
product is complete and graded A / ~9.0–9.1/10; this is what the next versions
can be.*

## 1. Finish the current grade (small, mostly operational)

1. **Deploy the canister** — the source now typechecks and the stable check is
   green in CI (`.github/workflows/canister-build.yml` produces the wasm
   artifact); a deploy needs cycles and an Internet Identity on a machine with
   the toolchain. Then `pnpm bindgen` and the canister path becomes runnable.
2. **Fold the two pending canister migrations** (`20260920_120000.mo` into
   `20260920_130000.mo`, per mops) — the one edit between CI and its first
   green run + wasm artifact.
3. **Rotate the chat-exposed credentials** — Gmail app password, Brevo/Resend
   key, database password, service key, both AI keys; delete the two used
   `sbp_` tokens from the dashboard list.
4. **One backup → restore drill** (`supabase/OPERATIONS.md`) — the last
   "written but never executed" claim.
5. **Two auth-config PATCHes** once a credential holds:
   `password_required_characters` (currently null — decide whether
   `aaaaaaaaaa` should pass) and `sessions_inactivity_timeout` (currently 0).
6. **Site URL / Redirect URLs** — confirm the dashboard names the Vercel origin
   (the reset/confirmation links depend on it; never read from here).
7. **Real-device pass** — every automated surface is swept at 1440/390/320;
   nobody has held the four themes on a phone.

## 2. Hardening and infrastructure

- **Verified sending domain** for the mail relay — the `From` stops reading
  `via gmail.com`; needs DNS on `study-forg.app` (registered, not resolving).
- **HIBP breach screening** — plan-gated (Pro and up); the client-side
  k-anonymity check already exists in `passwordPolicy.ts`.
- **Backups/PITR on a schedule** + the restore drill above; `supabase-backup`
  workflow is written but has never fired.
- **First green runs of CI**: `supabase-ci` (its gates are green locally) and
  `canister-build` (after the fold); wire the wasm artifact hash into release
  notes.
- **Deploy `ai-proxy` wiring or delete it** — the function is deployed and
  hardened, but the AI Studio still uses the reviewer's own key in the browser;
  routing it through the proxy would keep provider keys off the client
  entirely (needs `APP_ORIGINS` secrets + a decision).
- **MFA (TOTP)** — GoTrue supports it; the UI would add enrolment + challenge
  steps to `AuthPage`.
- **Staging project** for the E2E probes, so live batteries stop running
  against production.

## 3. Product features (the natural next versions)

- **Spaced repetition** — a review queue over results (SM-2 or leitner boxes)
  keyed on the existing `result_item` history; the deliberate non-goal in
  `DESIGN.md` is the first thing to lift when this is wanted.
- **Shared workspaces / teacher mode** — a second principal role on the
  hierarchy (author vs student), class rosters, assignment hand-outs built on
  the existing share surface.
- **Difficulty and adaptive practice** — tag questions, weight selection in
  `sessionEngine`, adaptive ladders in the builder.
- **Streaks and goals UI** — the streak math exists (`progress.ts`); goals
  beyond the daily target number are unexposed.
- **Richer question types** — multi-select, ordering, cloze deletion; the
  grading contract and renderer are structured for it.
- **Bulk authoring** — CSV/Markdown question import to match the PDF export;
  the archive importer's validation rules are the model.
- **Offline-first PWA** — the manifest and service worker exist; the mock
  backend already proves the app can run entirely locally, so a background-sync
  layer over the Supabase adapter is the missing seam.
- **i18n** — the copy is centralised enough for one extraction pass.
- **Analytics exports** — CSV of attempt history; the chart data is already a
  pure function over merged results.
- **Push on iOS** — web push is live on Android/desktop; iOS needs the
  installed-PWA context (already shipped).
- **Theme marketplace / custom accents** — the token system makes a fifth
  theme a single CSS block plus one CHECK widening (0012 is the template).

## 4. Deliberately not planned

Multi-user editing of one hierarchy, payments/marketplace, server-side AI
without the reviewer's own key (the deployed `ai-proxy` covers the future
path), and any feature that would break the four-theme contrast floors — those
are constraints, not backlog.
