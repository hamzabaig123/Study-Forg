mixin () {
  /// Static Markdown documentation of this backend's public API.
  public query func getApiDoc() : async Text {
    "# Study Platform Backend API\n\n" #
    "A study-content platform: build a class > subject > chapter > topic hierarchy, " #
    "author questions, run practice sessions and timed tests, review analytics, and " #
    "share or export content.\n\n" #
    "## Authentication and authorization\n\n" #
    "Every method below is a `shared` update or query call. All content, session, " #
    "analytics, sharing, and export methods are scoped to the calling principal: " #
    "each caller only ever reads and writes their own classes, subjects, chapters, " #
    "topics, questions, sessions, results, and share links. There is no cross-user " #
    "access. The unauthenticated read paths are `getSharedContent` and " #
    "`getSharedNote`, which resolve a share token to read-only content with answers " #
    "withheld. Every note and settings method requires a signed-in (non-anonymous) " #
    "caller. An anonymous caller receives `#notAuthorized` from note mutations that " #
    "return a result, `null` from note and settings reads, an empty list from note " #
    "listings, and a trap from `createNote` (which has no error channel).\n\n" #
    "The app's frontend pins an Internet Identity derivation origin, published at " #
    "`/.well-known/ii-derivation-origin` when available. An agent already holding " #
    "the user's Internet Identity authorization derives the correct per-app " #
    "principal against that origin (for example `icp identity link web <name> " #
    "--app <host>`). Such a delegation acts with the user's full authority in this " #
    "app until it expires.\n\n" #
    "## Content hierarchy\n\n" #
    "- `listClasses() : [ClassSummary]` — the caller's classes, newest first.\n" #
    "- `createClass(name, description) : ClassSummary`\n" #
    "- `renameClass(classId, name, description) : ?ClassSummary` — `null` when the " #
    "class does not exist or is not owned by the caller.\n" #
    "- `deleteClass(classId) : Bool` — cascades to every subject, chapter, topic, " #
    "and question beneath it.\n" #
    "- `getClass(classId) : ?ClassDetail` — the class plus its subjects.\n" #
    "- `listSubjects(classId)`, `createSubject(classId, name, description)`, " #
    "`renameSubject(subjectId, name, description)`, `deleteSubject(subjectId)` " #
    "(cascades), `getSubject(subjectId) : ?SubjectDetail`.\n" #
    "- `listChapters(subjectId)`, `createChapter(subjectId, name, description)`, " #
    "`renameChapter(chapterId, name, description)`, `deleteChapter(chapterId)` " #
    "(cascades), `getChapter(chapterId) : ?ChapterDetail`.\n" #
    "- `listTopics(chapterId)`, `createTopic(chapterId, name, description)`, " #
    "`renameTopic(topicId, name, description)`, `deleteTopic(topicId)` (cascades), " #
    "`getTopic(topicId) : ?TopicDetail`.\n" #
    "- `getTopicPath(topicId) : ?TopicPath` — the class > subject > chapter > topic " #
    "breadcrumb.\n\n" #
    "## Question bank\n\n" #
    "- `listQuestions(topicId) : [Question]` — oldest first, answers included.\n" #
    "- `createQuestion(topicId, prompt, questionType, answer, explanation) : ?Question`\n" #
    "- `updateQuestion(questionId, prompt, questionType, answer, explanation) : ?Question`\n" #
    "- `deleteQuestion(questionId) : Bool`\n" #
    "- `acceptDraft(topicId, draft) : ?Question` — promotes an AI draft into the " #
    "topic's question bank.\n\n" #
    "`questionType` is `#multipleChoice`, `#trueFalse`, or `#shortAnswer`. `answer` " #
    "is the matching `AnswerData` variant: `#multipleChoice({ options : [Option]; " #
    "correctOptionId : Id })`, `#trueFalse({ correct : Bool })`, or " #
    "`#shortAnswer({ expected : Text })`. `explanation` is optional.\n\n" #
    "## Practice and timed tests\n\n" #
    "- `startSession(request) : Result<SessionView, SessionError>` — `request` is " #
    "`{ scope : SessionScope; mode : SessionMode; questionCount : ?Nat; " #
    "durationSeconds : ?Nat }`. `scope` is `#topic(id)` or `#chapter(id)`; `mode` is " #
    "`#practice` or `#timedTest`. Practice draws every question in scope; a timed " #
    "test draws `questionCount` (default: all) and requires `durationSeconds`. " #
    "Errors: `#notFound` (scope not owned), `#noQuestions`, `#invalidInput(text)`.\n" #
    "- `getSession(sessionId) : ?SessionView` — the live session with answers " #
    "withheld.\n" #
    "- `submitAnswer(request) : Result<AnswerFeedback, SessionError>` — `request` is " #
    "`{ sessionId; questionId; answer : SubmittedAnswer }`. Returns `correct`, the " #
    "`correctAnswer`, and the `explanation`. Short answers are compared " #
    "case-insensitively after trimming whitespace. Errors: `#notFound`, " #
    "`#invalidInput` when the session is complete, the timer has expired, or the " #
    "question is not part of the session.\n" #
    "- `completeSession(sessionId) : Result<SessionResult, SessionError>` — grades " #
    "every answer submitted for the session, records the result (score, total, and " #
    "a per-question review with each `submitted` answer and `correct` flag), and " #
    "removes the live session. Questions never answered are recorded as " #
    "`submitted = null` and `correct = false`. Calling it again returns the same " #
    "recorded result (idempotent).\n" #
    "- `getSessionResult(sessionId) : ?SessionResult` — the recorded result.\n\n" #
    "Timed tests enforce `expiresAt` server-side: `submitAnswer` rejects answers " #
    "after expiry, and the frontend auto-submits by calling `completeSession` when " #
    "the countdown reaches zero.\n\n" #
    "## Dashboard and analytics\n\n" #
    "- `getDashboardStats() : DashboardStats` — class, subject, chapter, topic, and " #
    "question counts.\n" #
    "- `getRecentActivity(limit) : [ActivityItem]` — newest first.\n" #
    "- `getAnalyticsBreakdown() : AnalyticsBreakdown` — accuracy by class, subject, " #
    "and question type; each bucket carries `correct`, `total`, and " #
    "`accuracyPercent` (0–100).\n" #
    "- `getAttemptHistory() : [AttemptSummary]` — practice and test attempts, newest " #
    "first.\n\n" #
    "## Sharing and export\n\n" #
    "- `createShare(target) : Result<ShareLink, ShareError>` — `target` is " #
    "`#chapter(id)` or `#topic(id)`. Returns the existing link when one already " #
    "exists for that target. Errors: `#notFound`, `#notAuthorized`.\n" #
    "- `listShares() : [ShareLink]` — the caller's links, newest first.\n" #
    "- `revokeShare(token) : Bool` — afterwards the token no longer resolves.\n" #
    "- `getSharedContent(token) : ?SharedContent` — **the only unauthenticated " #
    "read**. Returns the title, breadcrumb, and questions with no answers and no " #
    "edit controls. `null` for an unknown or revoked token.\n" #
    "- `exportContent(target, format) : Result<ExportFile, ExportError>` — `format` " #
    "is `#csv` or `#pdf`. `ExportFile` carries `filename`, `mimeType`, and `content` " #
    "(the file body as text; the PDF is a valid single-page PDF document). Errors: " #
    "`#notFound`, `#notAuthorized`, `#empty`.\n\n" #
    "## AI Studio\n\n" #
    "- `getAiConfig() : AiConfigStatus` — whether a personal key is saved, plus a " #
    "masked hint. The key itself is never returned.\n" #
    "- `saveAiKey(key) : AiConfigStatus` / `removeAiKey() : AiConfigStatus`.\n" #
    "- `generateDrafts(request) : Result<GenerateResult, AiError>` — `request` is " #
    "`{ topicId; prompt; sourceText : ?Text; count : Nat }`. Returns drafts tagged " #
    "with the `source` that produced them (`#platform` or `#personalKey`).\n\n" #
    "## Notes workspace\n\n" #
    "Notes are private to the signed-in owner. Every read and write is scoped to " #
    "the caller's principal; a note owned by someone else is never returned.\n\n" #
    "- `createNote(title, subjectLabel, chapterLabel, topicLabel, documentJson, " #
    "searchText) : NoteView` — `documentJson` is the serialized block document " #
    "(`{version:1, blocks:[...]}`) with heading, paragraph, bullet list, callout, " #
    "formula, and divider blocks; `searchText` is the flattened plain text used for " #
    "search. New notes start at `revision = 1` with status `active`.\n" #
    "- `listNotes(searchQuery) : [NoteView]` — the caller's live notes, newest " #
    "updated first. `searchQuery` is optional and matched case-insensitively against " #
    "the title and the note text.\n" #
    "- `listTrashedNotes() : [NoteView]` — the caller's soft-deleted notes.\n" #
    "- `getNote(noteId) : ?NoteView` — `null` when the note does not exist or is not " #
    "the caller's.\n" #
    "- `updateNote(noteId, title, subjectLabel, chapterLabel, topicLabel, " #
    "documentJson, searchText, expectedRevision) : Result<NoteView, NoteError>` — " #
    "revision-checked: when `expectedRevision` differs from the stored revision the " #
    "call returns `#staleRevision({ expected; actual })` and writes nothing; " #
    "otherwise the revision is incremented and `updatedAt` refreshed. Errors: " #
    "`#notFound`, `#notAuthorized`, `#staleRevision`.\n" #
    "- `renameNote(noteId, title) : Result<NoteView, NoteError>` — bumps the " #
    "revision.\n" #
    "- `softDeleteNote(noteId) : Result<NoteView, NoteError>` — moves the note to " #
    "the trash (status `trashed`, `deletedAt` set).\n" #
    "- `restoreNote(noteId) : Result<NoteView, NoteError>` — returns a trashed note " #
    "to the live list.\n" #
    "- `permanentlyDeleteNote(noteId) : Result<(), NoteError>` — removes the note " #
    "and every share token pointing at it. Destructive and not recoverable.\n\n" #
    "## Note sharing\n\n" #
    "- `createNoteShare(noteId) : Result<NoteShareLink, NoteShareError>` — mints a " #
    "long random URL-safe token for one of the caller's live notes. Errors: " #
    "`#notFound` (unknown, not owned, or trashed), `#notAuthorized`.\n" #
    "- `listNoteShares() : [NoteShareLink]` — the caller's tokens, newest first.\n" #
    "- `revokeNoteShare(token) : Result<(), NoteShareError>` — afterwards the token " #
    "no longer resolves. Errors: `#notFound`, `#notAuthorized`.\n" #
    "- `getSharedNote(token) : ?SharedNote` — **unauthenticated read**. Returns only " #
    "`title`, `documentJson`, `revision`, and `updatedAt`. `null` for an unknown or " #
    "revoked token, or when the note has been soft-deleted.\n\n" #
    "## Settings\n\n" #
    "- `getMySettings() : ?UserSettingsView` — `null` when the caller has never " #
    "saved settings.\n" #
    "- `saveMySettings(displayName, studyGoal, dailyTarget, appearance) : " #
    "Result<UserSettingsView, SettingsError>` — upserts the caller's settings. " #
    "`displayName` is required (trimmed, at most 80 characters); an empty or " #
    "over-long name returns `#invalidInput(text)`. `dailyTarget` is a whole number " #
    "of questions per day and must be between 1 and 1000. `appearance` must be one " #
    "of `light`, `dark`, or `frosted` (case-insensitive). Any invalid field returns " #
    "`#invalidInput(text)` with a message naming the constraint.\n" #
    "- `exportMyData() : UserDataExport` — a JSON document of the caller's notes, " #
    "share tokens, and settings, with `filename` and `mimeType` " #
    "(`application/json`). Note text is never used in analytics.\n\n" #
    "## QR short links\n\n" #
    "Short links are public: creating one and resolving one need no sign-in. A " #
    "link's short URL is `<app>/r/<code>` and its secret manage URL is " #
    "`<app>/manage/<editToken>`. The QR code encodes the short URL, never the " #
    "target, so editing the target later changes where the same printed code " #
    "points.\n\n" #
    "- `createLink(targetUrl) : { #ok : CreatedLink; #err : CreateLinkError }` — " #
    "validates the target, mints a 7-character URL-safe `code` and a long random " #
    "`editToken`, and returns `shortUrl`, `manageUrl`, and the `editToken` exactly " #
    "once. Errors: `#invalidUrl(text)` and `#rateLimited`.\n" #
    "- `resolveCode(code, device, country) : ResolveResult` — returns " #
    "`#redirect({ targetUrl })` for an active link, or " #
    "`#unavailable(#notFound | #paused | #deleted | #rateLimited)`. A successful " #
    "resolution records a scan (timestamp, device class, and optional country " #
    "only — never a raw IP address).\n" #
    "- `getLinkByToken(editToken) : ?LinkDetail` — `null` for an unknown token.\n" #
    "- `updateTarget(editToken, targetUrl) : { #ok : LinkDetail; #err : " #
    "ManageLinkError }` — re-validates the new target. Errors: `#notFound`, " #
    "`#invalidUrl(text)`.\n" #
    "- `setPaused(editToken, paused) : { #ok : LinkDetail; #err : ManageLinkError }` " #
    "— a paused link resolves to `#unavailable(#paused)`.\n" #
    "- `deleteLink(editToken) : { #ok; #err : ManageLinkError }` — soft-deletes; a " #
    "deleted link resolves to `#unavailable(#deleted)`.\n" #
    "- `getScanStats(editToken) : ?ScanStats` — `totalScans` plus a `perDay` series " #
    "of `{ day : \"YYYY-MM-DD\"; count }` in UTC, ascending. `null` for an unknown " #
    "token.\n" #
    "- `reportAbuse(code, reason) : { #ok; #err : AbuseError }` — records a report " #
    "for an existing code. Errors: `#notFound`, `#invalidInput(text)`.\n\n" #
    "Target URLs must use `http` or `https`; `javascript:`, `data:`, and every " #
    "other scheme are rejected, as are private, loopback, and link-local hosts " #
    "(10.x, 172.16–31.x, 192.168.x, 127.x, 169.254.x, `::1`, `fc00::/7`, " #
    "`fe80::/10`) and targets pointing back at the app's own `/r/` path. Creation " #
    "is limited to 10 calls per minute per caller and resolution to 120 per minute " #
    "per caller; exceeding either returns `#rateLimited` / " #
    "`#unavailable(#rateLimited)`.\n\n" #
    "## Queryable data (OQL)\n\n" #
    "The canister also exposes a read-only Object Query Layer over its persisted " #
    "tables: `schema() : Text` returns the JSON schema of every registered entity, " #
    "and `execute(queryJson) : Text` runs a JSON query against it. Both are " #
    "`query` calls. Every registered entity — `class`, `subject`, `chapter`, " #
    "`topic`, `question`, `session`, `sessionResult`, `share`, `note`, " #
    "`noteShare`, `userSettings`, `shortLink`, `scan`, and `abuseReport` — is " #
    "`controllerOnly`: only the platform controller (the Data Intelligence agent) " #
    "may read them, and no end user, signed in or anonymous, can query them " #
    "directly. `execute` is read-only and never mutates state, so it is safe to " #
    "retry. The `shortLink` entity omits the secret `editToken` column, and the " #
    "`scan` entity records only timestamp, device class, and country — never a " #
    "raw IP address.\n\n" #
    "## Units and encodings\n\n" #
    "- All ids are `Nat`. All timestamps are `Int` nanoseconds since the Unix epoch " #
    "(`Time.now()`).\n" #
    "- `durationSeconds` is seconds; `expiresAt` is a nanosecond timestamp.\n" #
    "- Optional values are `?T`; absent descriptions and explanations are `null`.\n" #
    "- `accuracyPercent` is a `Float` in the range 0–100.\n\n" #
    "## Retry safety\n\n" #
    "- `createClass`, `createSubject`, `createChapter`, `createTopic`, " #
    "`createQuestion`, `startSession`, `createNote`, `createNoteShare`, " #
    "`createLink`, and `reportAbuse` are **not** idempotent: each call creates a " #
    "new record. Do not retry blindly.\n" #
    "- `resolveCode` is not idempotent either: every successful resolution appends " #
    "a scan record, so a retry inflates the scan count. Retry only after a " #
    "transport failure, never to re-check a result.\n" #
    "- `updateTarget`, `setPaused`, `deleteLink`, `renameNote`, `saveMySettings`, " #
    "`revokeNoteShare`, and `revokeShare` are safe to retry: each is a " #
    "last-write-wins update keyed by a token or the caller's principal, and " #
    "repeating it leaves the same final state.\n" #
    "- `createShare` is idempotent per target — it returns the existing link.\n" #
    "- `completeSession` is idempotent — a second call returns the recorded result.\n" #
    "- `updateNote` is safe to retry only with the revision the server last " #
    "returned; a retry with a stale revision returns `#staleRevision` and writes " #
    "nothing.\n" #
    "- `deleteClass`, `deleteSubject`, `deleteChapter`, `deleteTopic`, " #
    "`deleteQuestion`, `revokeShare`, `softDeleteNote`, `restoreNote`, " #
    "`permanentlyDeleteNote`, `revokeNoteShare`, and `deleteLink` are destructive; " #
    "`permanentlyDeleteNote` also removes the note's share tokens.\n";
  };
};
