# StudyForge — App Flow

*Version 1.0 · 2026-09-29. Route-level map of everything a person can do, in
the order they meet it. Routes as declared in `src/router.tsx`.*

## 1. Route map

**Public (no session):** `/` landing · `/login` · `/register` ·
`/verify-email` · `/forgot-password` · `/reset-password` · `/qr` (QR generator,
works signed-out) · `/r/$code` (scan redirect) · `/shared/$token` (read-only
topic/chapter page) · `/shared/note/$token` (read-only note) ·
`/manage/$token` (secret link management, backend-gated) ·
`/shared/note/$token`.

**Signed-in:** `/dashboard` · `/classes` + `/classes/$classId` ·
`/subjects/$subjectId` · `/chapters/$chapterId` · `/topics/$topicId` ·
`/test-builder` · `/practice/$sessionId` · `/test/$sessionId` ·
`/results/$sessionId` · `/custom-test/$sessionId` · `/custom-results/$sessionId`
· `/analytics` · `/ai-studio` · `/notes` + `/notes/$noteId` · `/share` ·
`/export` · `/settings`.

Signed-out visitors reaching a signed-in route are redirected to `/login` by
`RequireAuth`; the public sharing routes wait for the backend actor instead of
redirecting (a query disabled rather than pending must read as "loaded",
not "unavailable").

## 2. Onboarding and authentication

1. **Register** (`/register`): email, name, password ≥ 10 characters (one
   constant, enforced client- and server-side). Email+password only.
2. **Verify** (`/verify-email?email=…`): the branded confirmation mail's link
   lands back on the deployed origin. Until confirmed, sign-in answers
   `email_not_confirmed` and the database refuses every row (`owner_is_verified()`).
3. **Sign in** (`/login`): password grant; the app resolves the backend actor
   before first paint. Sign-out revokes the access token immediately
   (measured `403 session_not_found`).
4. **Recovery** (`/forgot-password` → mail → `/reset-password`): the reset
   session authorises the change; the flow holds the session afterwards.
5. Optional Cloudflare Turnstile gates register/sign-in/re-send/reset when the
   project switch is on; without a site key nothing changes.

## 3. Authoring flow (the core loop)

1. `/dashboard` → *New content*: create a **Class**.
2. Class page → **Subject** → Chapter → **Topic**. Breadcrumbs and sidebars
   keep the tree navigable; every level carries counts and its own empty state.
3. Topic page → author questions: multiple choice (options, correct one),
   true/false, or short answer with expected text; each with an optional
   explanation.
4. From any topic/chapter: **Practice** (instant feedback per question) or
   **Timed test** (one countdown, auto-submit) — or open `/test-builder` to mix
   subjects, chapters and topics, set count/duration, and shuffle questions
   and/or options. Builder runs grade in the browser and mirror into the
   account on finish.
5. `/results/$sessionId` (backend) or `/custom-results/$sessionId` (builder):
   score ring draws, number counts up, confetti at ≥ 75 %, then the full
   question review with answers and explanations.
6. `/analytics`: accuracy by class, subject and question type; the attempt
   history merges backend results and builder runs; the dashboard hero tracks
   accuracy and day streak.

## 4. AI Studio flow

`/ai-studio` → upload a PDF/image or paste text → choose a provider (Gemini key,
OpenRouter free model, local Ollama, or the offline rule-based parser) → the
browser extracts draft questions page-by-page (first unit alone, then five
concurrent; missing pages are named, and a retry **merges** instead of
discarding) → review, edit, approve or reject each draft → accepted drafts join
the topic's question bank. Keys live in `sessionStorage` by default; "keep on
this device" is an explicit opt-in.

## 5. Distribution flow

1. `/share` → pick a topic or chapter → **create share link** (read-only page
   at `/shared/$token`).
2. `/qr` (or the share flow) → mint a **short code** (`/r/<code>`, 10–12 chars)
   and QR code with size/error-correction options.
3. A visitor scans → `/r/$code` → `resolve_link` → the shared page. Scans are
   counted (`link_scan`) with country/UA-derived metadata.
4. The author manages the link at `/manage/$token` (secret edit token): pause,
   retarget, or delete. Visitors can report abuse at `/r/$code` — rate-limited,
   and a never-issued code answers exactly what an issued one does.
5. Shared pages are read-only, verification-gated in the database, and render
   the same question renderer as the app.

## 6. Notes flow

`/notes` → create/edit in the block editor (text, callouts, code, dividers) →
autosave with a Saving/Saved/Failed chip → read-only preview renders the same
stored document → optionally publish a read-only share at
`/shared/note/$token`.

## 7. Reminders flow

Settings → **Reminders**: choose the daily time, toggle the task nudge and the
analytics report, register push. The device mirrors the preference to
`reminder_settings`; a minute-tick posts the session to the `reminder-sender`
function, which reads the numbers, mails via Resend, and logs every attempt
(visible in Settings). A "send now" button tests the pipeline; a server-side
cron covers closed-app days.

## 8. Privacy and settings flow

Settings sections: Account (display name, study goal, daily target), Appearance
(four themes, applied immediately), Reminders, Privacy and export (download
JSON, restore from a file or from this browser's archive, clear local data —
account data survives), Security (session, change password, sign out).
Destructive actions require typed confirmation; "clear local data" never
touches account content.

## 9. States every page owns

- **Empty**: designed panels ("Nothing here yet", "No analytics yet", "No
  results to show") with the next action in place.
- **Loading**: route-level `LoadingState` fallbacks behind every lazy route,
  skeletons on data surfaces, and a themed boot shell before the bundle.
- **Error**: graceful not-found on missing ids, retryable error panels, a
  storage-health banner when `localStorage` fails, and toasts (sonner) for
  transient failures.
