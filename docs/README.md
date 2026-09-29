# StudyForge — Documentation Index

*2026-09-29. Where everything lives.*

## The documentation set (`docs/`)

| Document | What it covers |
| --- | --- |
| [`PRD.md`](PRD.md) | Product requirements: what StudyForge is, who it serves, every shipped feature, non-goals, enforced requirements, the quality bar |
| [`TRD.md`](TRD.md) | Technical requirements: the three-backend architecture, security requirements and how each is enforced, performance budgets and numbers, correctness guards, delivery gates, deployment topology, live GoTrue configuration |
| [`APP-FLOW.md`](APP-FLOW.md) | Every route and flow: onboarding/auth, the authoring loop, sessions and results, AI Studio, distribution (share/QR/scan), notes, reminders, privacy, and the empty/loading/error states |
| [`AUTHENTICATION.md`](AUTHENTICATION.md) | The auth model end to end: GoTrue sessions, the 10-character floor, the database verification wall, branded mail, reset flow, Turnstile seam, measured live config, code map |
| [`DATABASE-SCHEMA.md`](DATABASE-SCHEMA.md) | All 22 tables, the RLS model, the definer functions, the full migration history 0001 → 0015, operational notes |
| [`UI-UX-DESIGN.md`](UI-UX-DESIGN.md) | The design system: four themes, contrast floors, typography, the motion system, component vocabulary, all app states, accessibility findings, responsive measurements |
| [`ROADMAP.md`](ROADMAP.md) | What can be added later: the grading finishers, hardening/infrastructure, product features, and the deliberate non-goals |

## Root reports (grading and history)

- **`PROJECT-REPORT.md`** — the current report and grades (A — ~9.0/10, per-area
  letters, earned from commands that ran on 2026-09-29).
- **`GRADING-REPORT.md`** — the grading history with the 09-27 pass kept as
  written and the regrades answered by measurement.
- **`HARDENING-REPORT.md`** — the 2026-09-28 security hardening pass (throttle,
  TRUNCATE, password floor, auth protocol probe, branded mail).

## Operational references

- `AGENTS.md` — working instructions and hard-won learnings for anyone (human
  or agent) editing this tree.
- `DEPLOY.md` — the GitHub → Vercel → Supabase deployment guide, including the
  Turnstile and domain procedures.
- `DESIGN.md` — the measured token tables (per-theme hex/OKLCH) and
  constraints; `docs/UI-UX-DESIGN.md` is the design system around them.
- `supabase/README.md` — the integration state, Edge Function secrets, the
  reminder pipeline SQL, and reading the CSP violation table.
- `supabase/OPERATIONS.md` — the backup/restore drill and staging→production
  procedure.
