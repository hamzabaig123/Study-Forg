# StudyForge — Product Requirements Document

*Version 1.0 · 2026-09-29. Status: the product described here is built, deployed
at `study-forg-frontend-100.vercel.app`, and graded in the root reports. This
document describes what StudyForge **is and must do**; `docs/TRD.md` describes
how it is built, and `docs/ROADMAP.md` what may come next.*

## 1. Product

**StudyForge** is a study platform where one person organises course material
into a four-level hierarchy (Class → Subject → Chapter → Topic), authors
questions against it, practises with instant feedback or under a timer, and
reads their accuracy back by class, subject and question type. It also
publishes: any topic or chapter can become a public read-only page addressed by
a short code and a QR code, and any topic can export to a printable PDF.

One account owns everything it creates. There are no teams, no shared editing,
and no marketplace — it is a single-tenant workspace per account, with public
surfaces limited to read-only sharing and anonymous scan/report endpoints.

## 2. Users

- **The author** (primary): a student or teacher who writes the material, in
  English, on desktop or phone. Signs in with email + password; every row is
  owned by their account.
- **The visitor** (secondary): anyone holding a shared link, a short-code URL
  or the printed QR code. Signs in for nothing; reads only; may report abuse.

## 3. Features (all shipped)

### 3.1 Content hierarchy
Create, rename and delete Classes → Subjects → Chapters → Topics, each with a
description. Deleting a parent cascades to its children. Every list and detail
page carries its own empty state.

### 3.2 Questions
Three types per topic: multiple choice (any number of options, one correct),
true/false, and short answer (exact text match). Each carries an optional
explanation, shown during practice and on result review.

### 3.3 Practice and timed tests
A topic or chapter session walks its questions in creation order with instant
per-question feedback (practice) or one countdown that auto-submits (timed).
Grading is server-side (`start_session` / `complete_session`) against the
signed-in account.

### 3.4 Test builder (frontend engine)
Any mix of subjects, chapters and topics in one session; the author chooses
count, duration and whether questions and/or options shuffle. Runs and grades
in the browser, mirrors the finished run into `custom_session` so it counts in
analytics and the daily email.

### 3.5 Results and analytics
Every finished attempt lands in history. The dashboard shows accuracy and day
streak; the analytics page breaks accuracy down by class, subject and question
type, and lists every attempt (backend and builder runs merged).

### 3.6 AI Studio
Upload a PDF or image (or paste text); the browser extracts questions via the
reviewer's own Google Gemini key, an OpenRouter free model, or a local Ollama —
or parses plain text by rule with no key. Drafts are reviewed, edited and
accepted into a topic; nothing reaches the question bank unreviewed.

### 3.7 Notes
A private per-topic block-editor workspace with autosave, a read-only preview
rendered from the same stored document, and optional public sharing by secret
token.

### 3.8 Share, short links and QR
Publish a read-only page for a topic or chapter; mint a short code (`/r/<code>`)
and QR code with scan analytics; manage, pause, retarget or delete links
through a secret edit token. Public abuse reporting with a rate-limited,
oracle-free response.

### 3.9 Reminders
One daily email at the account's chosen local time: a task nudge and/or the
analytics report, delivered by a server-side function so the app need not be
open. Includes push notifications and a "send now" test.

### 3.10 Privacy and portability
Download the whole account as JSON; restore from a file or from this browser's
archive; clear local device data without touching the account.

### 3.11 Appearance
Four themes (Light — Vanilla & Burnt Orange, Dark — Graphite & Lime, Green —
Emerald Ink & Champagne, Maroon Forge), persisted per device and synced with
the account; measured WCAG floors in all four; full reduced-motion support.

## 4. Non-goals (deliberate, see also `DESIGN.md` constraints)

- No spaced-repetition scheduling, adaptive difficulty or shared workspaces.
- No multi-user collaboration on one hierarchy.
- No streak/goal tracking beyond the dashboard's streak figure.
- No payment, no marketplace, no in-app AI without the reviewer's own key.

## 5. Requirements the product must keep (enforced, not aspirational)

| Requirement | Enforced by |
| --- | --- |
| A visitor reads nothing that is not published | RLS: every owner table keyed on `auth.uid()`, `owner_is_verified()` gates unconfirmed accounts |
| A stranger cannot brute-force the public surface | `enforce_rate_limit` keyed on `cf-connecting-ip`; short codes ≥ 10 chars (49.6 bits); the abuse report answers one body either way |
| Passwords are at least 10 characters | One constant (`passwordPolicy.ts`) shared by client and server, pinned by tests against the live project |
| The host serves a real security policy | CSP + nine headers generated from one module, synced into `vercel.json`, with CSP violations reported to a deployed collector |
| The app works before JavaScript arrives | Themed boot shell in `index.html`; React replaces it on mount |
| Every state has a designed answer | Empty, loading (skeleton/`LoadingState` + boot shell) and error states captured on camera for all four themes |

## 6. Quality bar

555+ unit/contract tests green, `mops check` for the canister in CI, a
46-check live security battery, three dedicated live probes (auth protocol,
data contract sweep, auth mail), Lighthouse baselines (deployed origin
68/93/100/100, FCP 2.9 s on the current build), and 120 themed screenshots at
1440/390/320 px with zero overflow. Current grades: see `PROJECT-REPORT.md` §4
(A — 9.0/10; Database A++).
