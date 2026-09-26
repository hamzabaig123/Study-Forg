/**
 * Row → view mapping for the Supabase adapter.
 *
 * This file is the only place a database shape becomes a domain shape, which is
 * what makes the adapter reviewable: the queries say what to fetch and every
 * transformation lives here, next to the contract it has to satisfy.
 *
 * Three conversions do most of the work:
 *
 *   - ids and counts arrive as JSON numbers (PostgREST renders `bigint` that
 *     way) while `Id`/`Timestamp` are bigints, so each one is widened.
 *   - time is a `timestamptz` string in the database and a nanosecond bigint in
 *     the domain, exactly as the canister had it (`BigInt(ms) * 1_000_000n`).
 *     Milliseconds is the precision that survives the round trip, which is all
 *     the app ever displays.
 *   - a nullable column is `null` here and `undefined` there, because the
 *     generated canister bindings type an option as an absent key.
 *
 * Variants are stored verbatim: `question.answer` is the same tagged object the
 * mock keeps in its JSON, so it is passed through rather than rebuilt from
 * columns — rebuilding it is where a subtle field would get dropped.
 */
import type {
  AbuseError,
  ActivityItem,
  AnalyticsBreakdown,
  AnswerData,
  AnswerFeedback,
  AttemptSummary,
  BreadcrumbItem,
  ChapterSummary,
  ClassSummary,
  CreateLinkError,
  CreatedLink,
  DashboardStats,
  Id,
  LinkDetail,
  ManageLinkError,
  NoteError,
  NoteShareLink,
  NoteView,
  Question,
  QuestionResult,
  ScanStats,
  SessionError,
  SessionQuestion,
  SessionResult,
  SessionScope,
  SessionView,
  ShareLink,
  ShareTarget,
  SubjectSummary,
  SubmittedAnswer,
  Timestamp,
  TopicPath,
  TopicSummary,
  UserSettingsView,
} from "@/backend";
import { LinkStatus, QuestionType, SessionMode, UserRole } from "@/backend";
import type { Row } from "./transport";

const MS_TO_NS = 1_000_000n;

/* -------------------------------------------------------------------------- */
/* Scalars                                                                    */
/* -------------------------------------------------------------------------- */

export function toId(value: unknown): Id {
  return BigInt(asNumber(value));
}

export function toCount(value: unknown): bigint {
  return BigInt(asNumber(value));
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return Number.parseInt(value, 10);
  }
  throw new TypeError(`Expected a numeric value, received ${describe(value)}`);
}

function describe(value: unknown): string {
  return value === null ? "null" : typeof value;
}

/** A `timestamptz` string, or an ISO string already parsed to milliseconds. */
export function toStamp(value: unknown): Timestamp {
  return BigInt(toMilliseconds(value)) * MS_TO_NS;
}

export function toOptionalStamp(value: unknown): Timestamp | undefined {
  return value === null || value === undefined ? undefined : toStamp(value);
}

export function toMilliseconds(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return Math.round(value);
  }
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) {
    throw new TypeError(`Unparseable timestamp: ${String(value)}`);
  }
  return parsed;
}

/** Domain nanoseconds → the ISO string a `timestamptz` column accepts. */
export function stampToIso(value: Timestamp | undefined): string | undefined {
  return value === undefined
    ? undefined
    : new Date(Number(value / MS_TO_NS)).toISOString();
}

export function toText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export function toOptionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

export function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "true";
}

export function toOptionalBoolean(value: unknown): boolean | undefined {
  return value === null || value === undefined ? undefined : toBoolean(value);
}

export function toNumber(value: unknown): number {
  return asNumber(value);
}

export function toOptionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : asNumber(value);
}

/**
 * A tagged union as it is stored. The database checks that the `__kind__` key is
 * present, so a row that reached this point is a variant; only the field names
 * could still be wrong, and no mapper can guess those.
 */
export function toVariant<T>(value: unknown): T {
  return structuredClone(value) as T;
}

/* -------------------------------------------------------------------------- */
/* RPC result envelopes                                                       */
/* -------------------------------------------------------------------------- */

export interface RpcEnvelope {
  ok?: unknown;
  err?: unknown;
}

/**
 * Postgres functions answer `{"ok": …}` or `{"err": …}`, and `err` is either a
 * bare string (`"notFound"`, for a case with no data) or an object keyed by the
 * case (`{"invalidInput": "…"}`). Both spellings exist because the JSON version
 * of a Motoko variant has no other shape; `errorCase` collapses them so no
 * caller has to know which one a given function returns.
 */
export function errorCase(err: unknown): { kind: string; value: unknown } {
  if (typeof err === "string") {
    return { kind: err, value: null };
  }
  if (err && typeof err === "object") {
    const [key, value] =
      Object.entries(err as Record<string, unknown>)[0] ?? [];
    if (key !== undefined) {
      return { kind: key, value };
    }
  }
  return { kind: "notFound", value: null };
}

function envelope(payload: unknown): RpcEnvelope {
  if (!payload || typeof payload !== "object") {
    throw new TypeError(`Malformed RPC reply: ${describe(payload)}`);
  }
  return payload as RpcEnvelope;
}

export function rpcFailed(payload: unknown): boolean {
  return "err" in envelope(payload) && envelope(payload).err !== undefined;
}

export function rpcOk<T>(payload: unknown): T {
  const value = envelope(payload).ok;
  if (value === undefined) {
    throw new TypeError("RPC reply has no ok branch");
  }
  return value as T;
}

export function optionalOk<T>(payload: unknown): T | undefined {
  return envelope(payload).ok as T | undefined;
}

export function sessionError(err: unknown): SessionError {
  const { kind, value } = errorCase(err);
  switch (kind) {
    case "invalidInput":
      return { __kind__: "invalidInput", invalidInput: toText(value) };
    case "noQuestions":
      return { __kind__: "noQuestions", noQuestions: null };
    case "notAuthorized":
      return { __kind__: "notAuthorized", notAuthorized: null };
    default:
      return { __kind__: "notFound", notFound: null };
  }
}

export function manageLinkError(err: unknown): ManageLinkError {
  const { kind, value } = errorCase(err);
  if (kind === "invalidUrl") {
    return { __kind__: "invalidUrl", invalidUrl: toText(value) };
  }
  return { __kind__: "notFound", notFound: null };
}

export function createLinkError(err: unknown): CreateLinkError {
  const { kind, value } = errorCase(err);
  if (kind === "invalidUrl") {
    return { __kind__: "invalidUrl", invalidUrl: toText(value) };
  }
  return { __kind__: "rateLimited", rateLimited: null };
}

export function abuseError(err: unknown): AbuseError {
  const { kind, value } = errorCase(err);
  if (kind === "invalidInput") {
    return { __kind__: "invalidInput", invalidInput: toText(value) };
  }
  return { __kind__: "notFound", notFound: null };
}

export function noteError(err: unknown): NoteError {
  const { kind, value } = errorCase(err);
  switch (kind) {
    case "invalidInput":
      return { __kind__: "invalidInput", invalidInput: toText(value) };
    case "notAuthorized":
      return { __kind__: "notAuthorized", notAuthorized: null };
    case "staleRevision": {
      const pair = (value ?? {}) as Record<string, unknown>;
      return {
        __kind__: "staleRevision",
        staleRevision: {
          expected: toId(pair.expected),
          actual: toId(pair.actual),
        },
      };
    }
    default:
      return { __kind__: "notFound", notFound: null };
  }
}

/* -------------------------------------------------------------------------- */
/* Rows → views                                                              */
/* -------------------------------------------------------------------------- */

/** `class_rows()` etc. return the row plus the aggregate the summary needs. */
export function classSummary(row: Row): ClassSummary {
  return {
    id: toId(row.id),
    name: toText(row.name),
    description: toOptionalText(row.description),
    createdAt: toStamp(row.created_at),
    updatedAt: toStamp(row.updated_at),
    subjectCount: toCount(row.subject_count ?? 0),
  };
}

export function subjectSummary(row: Row): SubjectSummary {
  return {
    id: toId(row.id),
    name: toText(row.name),
    description: toOptionalText(row.description),
    classId: toId(row.class_id),
    updatedAt: toStamp(row.updated_at),
    createdAt: toStamp(row.created_at),
    chapterCount: toCount(row.chapter_count ?? 0),
  };
}

export function chapterSummary(row: Row): ChapterSummary {
  return {
    id: toId(row.id),
    name: toText(row.name),
    description: toOptionalText(row.description),
    subjectId: toId(row.subject_id),
    updatedAt: toStamp(row.updated_at),
    createdAt: toStamp(row.created_at),
    topicCount: toCount(row.topic_count ?? 0),
  };
}

export function topicSummary(row: Row): TopicSummary {
  return {
    id: toId(row.id),
    name: toText(row.name),
    description: toOptionalText(row.description),
    chapterId: toId(row.chapter_id),
    updatedAt: toStamp(row.updated_at),
    createdAt: toStamp(row.created_at),
    questionCount: toCount(row.question_count ?? 0),
  };
}

export function questionTypeOf(value: unknown): QuestionType {
  const text = toText(value);
  if (text === QuestionType.multipleChoice) {
    return QuestionType.multipleChoice;
  }
  if (text === QuestionType.trueFalse) {
    return QuestionType.trueFalse;
  }
  if (text === QuestionType.shortAnswer) {
    return QuestionType.shortAnswer;
  }
  throw new TypeError(`Unknown question type: ${text}`);
}

export function sessionModeOf(value: unknown): SessionMode {
  return toText(value) === SessionMode.timedTest
    ? SessionMode.timedTest
    : SessionMode.practice;
}

export function linkStatusOf(value: unknown): LinkStatus {
  const text = toText(value);
  if (text === "paused") {
    return LinkStatus.paused;
  }
  if (text === "deleted") {
    return LinkStatus.deleted;
  }
  return LinkStatus.active;
}

export function questionOf(row: Row): Question {
  return {
    id: toId(row.id),
    explanation: toOptionalText(row.explanation),
    createdAt: toStamp(row.created_at),
    answer: toVariant<AnswerData>(row.answer),
    questionType: questionTypeOf(row.question_type),
    updatedAt: toStamp(row.updated_at),
    prompt: toText(row.prompt),
    topicId: toId(row.topic_id),
  };
}

export function noteOf(row: Row): NoteView {
  return {
    id: toId(row.id),
    status: toText(row.status),
    // `document_json` is a text column: the editor's own serialisation, stored
    // and returned without being re-parsed.
    documentJson: toText(row.document_json),
    title: toText(row.title),
    topicLabel: toOptionalText(row.topic_label),
    subjectLabel: toOptionalText(row.subject_label),
    chapterLabel: toOptionalText(row.chapter_label),
    createdAt: toStamp(row.created_at),
    updatedAt: toStamp(row.updated_at),
    revision: toCount(row.revision),
    deletedAt: toOptionalStamp(row.deleted_at),
  };
}

export function noteShareOf(row: Row): NoteShareLink {
  return {
    status: "active",
    token: toText(row.token),
    noteId: toId(row.note_id),
    createdAt: toStamp(row.created_at),
  };
}

export function shareLinkOf(row: Row): ShareLink {
  return {
    token: toText(row.token),
    createdAt: toStamp(row.created_at),
    target: shareTargetOf(toText(row.scope_kind), row.scope_id),
  };
}

export function shareTargetOf(kind: string, id: unknown): ShareTarget {
  return kind === "topic"
    ? { __kind__: "topic", topic: toId(id) }
    : { __kind__: "chapter", chapter: toId(id) };
}

export function scopeOf(kind: string, id: unknown): SessionScope {
  return kind === "topic"
    ? { __kind__: "topic", topic: toId(id) }
    : { __kind__: "chapter", chapter: toId(id) };
}

/**
 * Both spellings, because a link arrives from two places.
 *
 * A `link` row read through PostgREST is snake_case; `link_detail_for_token` and
 * everything that returns it build their JSON by hand in camelCase, since a
 * `jsonb_build_object` has no column names to inherit. Same for the share and
 * result functions.
 */
export function linkDetailOf(row: Row): LinkDetail {
  return {
    id: toId(row.id),
    status: linkStatusOf(row.status),
    code: toText(row.code),
    createdAt: toStamp(row.createdAt ?? row.created_at),
    targetUrl: toText(row.targetUrl ?? row.target_url),
    updatedAt: toStamp(row.updatedAt ?? row.updated_at),
    shortUrl: toText(row.shortUrl) || `/r/${toText(row.code)}`,
  };
}

export function createdLinkOf(row: Row): CreatedLink {
  const detail = linkDetailOf(row);
  return {
    ...detail,
    editToken: toText(row.editToken),
    manageUrl: toText(row.manageUrl) || `/manage/${toText(row.editToken)}`,
  };
}

/**
 * `session_item` rows in insertion order. The player is shown the snapshot the
 * session was created with, and `options` is the display-only copy, so
 * `correctOptionId` never leaves the server.
 */
export function sessionViewOf(row: Row, items: Row[]): SessionView {
  const questions: SessionQuestion[] = items.map((item) => ({
    id: toId(item.question_id),
    questionType: questionTypeOf(item.question_type),
    prompt: toText(item.prompt),
    options: toVariant<SessionQuestion["options"]>(item.options ?? []),
  }));
  return {
    id: toId(row.id),
    startedAt: toStamp(row.started_at),
    expiresAt: toOptionalStamp(row.expires_at),
    mode: sessionModeOf(row.mode),
    scopeLabel: toText(row.scope_label),
    scope: scopeOf(toText(row.scope_kind), row.scope_id),
    durationSeconds:
      row.duration_seconds === null || row.duration_seconds === undefined
        ? undefined
        : toCount(row.duration_seconds),
    questions,
  };
}

export function questionResultOf(row: Row): QuestionResult {
  return {
    submitted:
      row.submitted === null || row.submitted === undefined
        ? undefined
        : toVariant<SubmittedAnswer>(row.submitted),
    explanation: toOptionalText(row.explanation),
    correctAnswer: toVariant<AnswerData>(row.correct_answer),
    correct: toBoolean(row.correct),
    questionType: questionTypeOf(row.question_type),
    questionId: toId(row.question_id),
    prompt: toText(row.prompt),
  };
}

export function sessionResultOf(row: Row, items: Row[]): SessionResult {
  return {
    // The domain names a result by the session that produced it: that is what
    // `getSessionResult` takes back, and what the canister's row id always was.
    // Postgres keeps its own `result.id` for the `result_item` foreign key.
    id: toId(row.session_id),
    completedAt: toStamp(row.completed_at),
    startedAt: toStamp(row.started_at),
    total: toCount(row.total),
    mode: sessionModeOf(row.mode),
    results: items
      .slice()
      .sort((a, b) => toNumber(a.position) - toNumber(b.position))
      .map(questionResultOf),
    scope: scopeOf(toText(row.scope_kind), row.scope_id),
    score: toCount(row.score),
  };
}

export function attemptSummaryOf(row: Row): AttemptSummary {
  return {
    id: toId(row.id),
    completedAt: toStamp(row.completedAt ?? row.completed_at),
    total: toCount(row.total),
    mode: sessionModeOf(row.mode),
    scopeLabel: toText(row.scopeLabel ?? row.scope_label),
    score: toCount(row.score),
  };
}

export function answerFeedbackOf(payload: Row): AnswerFeedback {
  return {
    correct: toBoolean(payload.correct),
    correctAnswer: toVariant<AnswerData>(payload.correctAnswer),
    explanation: toOptionalText(payload.explanation),
  };
}

export function scanStatsOf(payload: Row): ScanStats {
  const perDay = (payload.perDay ?? []) as Row[];
  return {
    totalScans: toCount(payload.totalScans ?? 0),
    perDay: perDay.map((entry) => ({
      day: toText(entry.day),
      count: toCount(entry.count),
    })),
  };
}

export function dashboardStatsOf(payload: Row): DashboardStats {
  return {
    classCount: toCount(payload.classCount),
    subjectCount: toCount(payload.subjectCount),
    chapterCount: toCount(payload.chapterCount),
    topicCount: toCount(payload.topicCount),
    questionCount: toCount(payload.questionCount),
  };
}

export function activityItemOf(row: Row): ActivityItem {
  return {
    at: toStamp(row.at),
    title: toText(row.title),
    kind: toText(row.kind),
  };
}

export function accuracyBuckets(rows: unknown): AnalyticsBreakdown["byClass"] {
  return (Array.isArray(rows) ? (rows as Row[]) : []).map((row) => ({
    bucketLabel: toText(row.bucketLabel),
    total: toCount(row.total),
    correct: toCount(row.correct),
    accuracyPercent: Number(toOptionalNumber(row.accuracyPercent) ?? 0),
  }));
}

export function analyticsBreakdownOf(payload: Row): AnalyticsBreakdown {
  return {
    byClass: accuracyBuckets(payload.byClass),
    bySubject: accuracyBuckets(payload.bySubject),
    byQuestionType: accuracyBuckets(payload.byQuestionType),
  };
}

export function settingsOf(row: Row): UserSettingsView {
  return {
    displayName: toText(row.display_name),
    studyGoal: toText(row.study_goal ?? ""),
    dailyTarget: toCount(row.daily_target),
    appearance: toText(row.appearance),
    updatedAt: toStamp(row.updated_at),
  };
}

export function breadcrumbOf(id: unknown, name: unknown): BreadcrumbItem {
  return { id: toId(id), name: toText(name) };
}

/**
 * The embedded `topic(chapter(subject(class)))` shape `getTopicPath` asks
 * PostgREST for. Embeds come back as objects, not arrays, because every one of
 * these relations is to-one through a not-null foreign key.
 */
export function topicPathOf(row: Row): TopicPath | null {
  const chapter = row.chapter as Row | null | undefined;
  const subject = chapter?.subject as Row | null | undefined;
  const owner = subject?.class as Row | null | undefined;
  if (!chapter || !subject || !owner) {
    return null;
  }
  return {
    class: breadcrumbOf(owner.id, owner.name),
    subject: breadcrumbOf(subject.id, subject.name),
    chapter: breadcrumbOf(chapter.id, chapter.name),
    topic: breadcrumbOf(row.id, row.name),
  };
}

export function userRoleOf(signedIn: boolean): UserRole {
  return signedIn ? UserRole.user : UserRole.guest;
}
