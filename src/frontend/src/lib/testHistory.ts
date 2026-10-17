/**
 * The test history: every finished test the account has taken, in one list,
 * and a way back into each of them question by question.
 *
 * Two kinds of test exist. A topic or chapter run is graded by the backend and
 * recorded there (`kind: "session"`, addressed by its session id); a Test
 * Builder run is graded in the browser, kept on the device and, on Supabase,
 * mirrored to the account (`kind: "custom"`, addressed by its `t…` id).
 *
 * On Supabase the server answers for both (migration 0016) and this device's
 * runs are merged in, so a run whose mirror never landed is still listed. On
 * the mock and the canister the backend's attempt history supplies the recorded
 * runs and the device supplies the rest.
 */
import type { backendInterface } from "@/backend";
import { isCustomSyncEnabled } from "@/lib/customSync";
import {
  type LocalSession,
  deleteLocalSession,
  getLocalSession,
} from "@/lib/localSessions";
import type { TopicLabels } from "@/lib/sessionEngine";
import {
  type AnswerData,
  type AttemptSummary,
  type QuestionResult,
  QuestionType,
  SessionMode,
  type SessionResult,
  type SubmittedAnswer,
} from "@/types";

export type TestKind = "session" | "custom";
export type TestScope = "topic" | "chapter" | "custom";

export interface TestAttempt {
  kind: TestKind;
  id: string;
  mode: SessionMode;
  /** Null when the backend's summary does not say (mock and canister lists). */
  scope: TestScope | null;
  title: string;
  startedAtMs: number | null;
  completedAtMs: number;
  timeLimitSeconds: number | null;
  score: number;
  total: number;
  /** Questions with an answer on record; null when the source does not count. */
  answered: number | null;
  /** The topic or chapter was deleted after the run; the record survives it. */
  contentRemoved: boolean;
  subjects: string[];
  classes: string[];
}

export interface TestAttemptItem {
  position: number;
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  submitted: SubmittedAnswer | null;
  correct: boolean;
  correctAnswer: AnswerData;
  explanation: string | null;
  labels: TopicLabels | null;
}

export interface TestAttemptDetail extends TestAttempt {
  items: TestAttemptItem[];
}

export type ItemStatus = "correct" | "wrong" | "skipped";

/* -------------------------------------------------------------------------- */
/* Parsing the server's JSON                                                  */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function countOf(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n)
    ? Math.max(0, Math.trunc(n))
    : 0;
}

function stampOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string => typeof entry === "string" && entry !== "",
      )
    : [];
}

function questionTypeOf(value: unknown): QuestionType | null {
  return value === QuestionType.multipleChoice ||
    value === QuestionType.trueFalse ||
    value === QuestionType.shortAnswer
    ? value
    : null;
}

function scopeOf(value: unknown): TestScope | null {
  return value === "topic" || value === "chapter" || value === "custom"
    ? value
    : null;
}

function labelsOf(value: unknown): TopicLabels | null {
  if (!isObject(value)) return null;
  return {
    className: textOf(value.className),
    subjectName: textOf(value.subjectName),
    chapterName: textOf(value.chapterName),
    topicName: textOf(value.topicName),
  };
}

/** One list entry from `test_history()`, or null when it is not one. */
export function parseTestAttempt(raw: unknown): TestAttempt | null {
  if (!isObject(raw)) return null;
  const kind =
    raw.kind === "session" || raw.kind === "custom" ? raw.kind : null;
  const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : null;
  const completedAtMs = stampOf(raw.completedAt);
  if (!kind || !id || completedAtMs === null) return null;
  const timeLimit = raw.timeLimitSeconds;
  return {
    kind,
    id,
    mode:
      raw.mode === SessionMode.timedTest
        ? SessionMode.timedTest
        : SessionMode.practice,
    scope: scopeOf(raw.scopeKind),
    title: textOf(raw.title, "Untitled test"),
    startedAtMs: stampOf(raw.startedAt),
    completedAtMs,
    timeLimitSeconds:
      timeLimit === null || timeLimit === undefined ? null : countOf(timeLimit),
    score: countOf(raw.score),
    total: countOf(raw.total),
    answered: raw.answered === undefined ? null : countOf(raw.answered),
    contentRemoved: raw.contentRemoved === true,
    subjects: stringsOf(raw.subjects),
    classes: stringsOf(raw.classes),
  };
}

function parseItem(raw: unknown, index: number): TestAttemptItem[] {
  if (!isObject(raw)) return [];
  const questionType = questionTypeOf(raw.questionType);
  const correctAnswer = raw.correctAnswer;
  if (!questionType || !isObject(correctAnswer)) return [];
  return [
    {
      position: raw.position === undefined ? index : countOf(raw.position),
      questionId: textOf(raw.questionId, String(index)),
      prompt: textOf(raw.prompt),
      questionType,
      submitted: isObject(raw.submitted)
        ? (raw.submitted as unknown as SubmittedAnswer)
        : null,
      correct: raw.correct === true,
      correctAnswer: correctAnswer as unknown as AnswerData,
      explanation:
        typeof raw.explanation === "string" && raw.explanation !== ""
          ? raw.explanation
          : null,
      labels: labelsOf(raw.labels),
    },
  ];
}

/** The body of `test_history_detail()`, or null for a test that is not there. */
export function parseTestAttemptDetail(raw: unknown): TestAttemptDetail | null {
  const attempt = parseTestAttempt(raw);
  if (!attempt || !isObject(raw)) return null;
  const items = Array.isArray(raw.items) ? raw.items.flatMap(parseItem) : [];
  return {
    ...attempt,
    items: items.sort((a, b) => a.position - b.position),
  };
}

/* -------------------------------------------------------------------------- */
/* Building attempts from what the device and the backend already hold        */
/* -------------------------------------------------------------------------- */

function distinctSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function attemptFromLocal(session: LocalSession): TestAttempt {
  return {
    kind: "custom",
    id: session.id,
    mode: session.mode,
    scope: "custom",
    title: session.scopeLabel,
    startedAtMs: session.startedAtMs,
    completedAtMs: session.completedAtMs ?? session.startedAtMs,
    timeLimitSeconds: session.durationSeconds,
    score: session.score,
    total: session.total,
    answered: session.results.filter((result) => !!result.submitted).length,
    contentRemoved: false,
    subjects: distinctSorted(
      session.results.map((result) => result.labels?.subjectName),
    ),
    classes: distinctSorted(
      session.results.map((result) => result.labels?.className),
    ),
  };
}

export function detailFromLocal(session: LocalSession): TestAttemptDetail {
  return {
    ...attemptFromLocal(session),
    items: session.results.map((result, position) => ({
      position,
      questionId: result.questionId,
      prompt: result.prompt,
      questionType: result.questionType,
      submitted: result.submitted ?? null,
      correct: result.correct,
      correctAnswer: result.correctAnswer,
      explanation: result.explanation ?? null,
      labels: result.labels ?? null,
    })),
  };
}

function nsToMs(value: bigint): number {
  return Number(value / 1_000_000n);
}

export function attemptFromSummary(summary: AttemptSummary): TestAttempt {
  return {
    kind: "session",
    id: summary.id.toString(),
    mode: summary.mode,
    scope: null,
    title: summary.scopeLabel,
    startedAtMs: null,
    completedAtMs: nsToMs(summary.completedAt),
    timeLimitSeconds: null,
    score: Number(summary.score),
    total: Number(summary.total),
    answered: null,
    contentRemoved: false,
    subjects: [],
    classes: [],
  };
}

export function detailFromSessionResult(
  result: SessionResult,
  title: string,
): TestAttemptDetail {
  const items: TestAttemptItem[] = result.results.map((item, position) => ({
    position,
    questionId: item.questionId.toString(),
    prompt: item.prompt,
    questionType: item.questionType,
    submitted: item.submitted ?? null,
    correct: item.correct,
    correctAnswer: item.correctAnswer,
    explanation: item.explanation ?? null,
    labels: null,
  }));
  return {
    kind: "session",
    id: result.id.toString(),
    mode: result.mode,
    scope: result.scope.__kind__,
    title,
    startedAtMs: nsToMs(result.startedAt),
    completedAtMs: nsToMs(result.completedAt),
    timeLimitSeconds: null,
    score: Number(result.score),
    total: Number(result.total),
    answered: items.filter((item) => item.submitted !== null).length,
    contentRemoved: false,
    subjects: [],
    classes: [],
    items,
  };
}

export function attemptKey(attempt: Pick<TestAttempt, "kind" | "id">): string {
  return `${attempt.kind}:${attempt.id}`;
}

/**
 * One entry per test, newest first. The device's copy of a Test Builder run
 * wins over the mirror: it is the original, and it is there without a network.
 */
export function mergeAttempts(
  remote: readonly TestAttempt[],
  local: readonly TestAttempt[],
): TestAttempt[] {
  const byKey = new Map<string, TestAttempt>();
  for (const attempt of remote) byKey.set(attemptKey(attempt), attempt);
  for (const attempt of local) byKey.set(attemptKey(attempt), attempt);
  return [...byKey.values()].sort(
    (a, b) =>
      b.completedAtMs - a.completedAtMs ||
      attemptKey(b).localeCompare(attemptKey(a)),
  );
}

/* -------------------------------------------------------------------------- */
/* Reading an attempt                                                         */
/* -------------------------------------------------------------------------- */

export function attemptPercent(attempt: Pick<TestAttempt, "score" | "total">) {
  return attempt.total > 0
    ? Math.min(100, (attempt.score / attempt.total) * 100)
    : 0;
}

/**
 * Questions that have an outcome on record. A correct answer always counts as
 * answered, whatever `answered` says: imported or seeded results can carry the
 * grade without the submission.
 */
function answeredCount(attempt: TestAttempt): number {
  if (attempt.answered === null) return attempt.total;
  return Math.min(attempt.total, Math.max(attempt.answered, attempt.score));
}

export function attemptCounts(attempt: TestAttempt): {
  correct: number;
  wrong: number;
  skipped: number;
} {
  const correct = Math.min(attempt.score, attempt.total);
  const skipped = attempt.total - answeredCount(attempt);
  return {
    correct,
    wrong: Math.max(0, attempt.total - correct - skipped),
    skipped,
  };
}

export function itemStatus(
  item: Pick<TestAttemptItem, "correct" | "submitted">,
): ItemStatus {
  if (item.correct) return "correct";
  return item.submitted ? "wrong" : "skipped";
}

/** Wall-clock time from start to finish; null when the start is not known. */
export function attemptDurationSeconds(attempt: TestAttempt): number | null {
  if (attempt.startedAtMs === null) return null;
  return Math.max(
    0,
    Math.floor((attempt.completedAtMs - attempt.startedAtMs) / 1000),
  );
}

/** The shape the shared review list renders. */
export function toQuestionResult(item: TestAttemptItem): QuestionResult {
  return {
    questionId: /^\d{1,18}$/.test(item.questionId)
      ? BigInt(item.questionId)
      : BigInt(item.position),
    prompt: item.prompt,
    questionType: item.questionType,
    submitted: item.submitted ?? undefined,
    correct: item.correct,
    correctAnswer: item.correctAnswer,
    explanation: item.explanation ?? undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* The list page: totals, filters, sorting                                    */
/* -------------------------------------------------------------------------- */

export interface HistoryStats {
  tests: number;
  averagePercent: number | null;
  bestPercent: number | null;
  questionsAnswered: number;
}

export function summarizeHistory(
  attempts: readonly TestAttempt[],
): HistoryStats {
  const graded = attempts.filter((attempt) => attempt.total > 0);
  const percents = graded.map(attemptPercent);
  return {
    tests: attempts.length,
    averagePercent:
      percents.length > 0
        ? percents.reduce((sum, value) => sum + value, 0) / percents.length
        : null,
    bestPercent: percents.length > 0 ? Math.max(...percents) : null,
    questionsAnswered: attempts.reduce(
      (sum, attempt) => sum + answeredCount(attempt),
      0,
    ),
  };
}

export type HistoryModeFilter = "all" | SessionMode;
export type HistorySort = "newest" | "oldest" | "best" | "worst";

export interface HistoryFilters {
  query: string;
  mode: HistoryModeFilter;
  /** A subject name, or null for every subject. */
  subject: string | null;
  sort: HistorySort;
}

export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  query: "",
  mode: "all",
  subject: null,
  sort: "newest",
};

/** Every subject any listed test touched, for the subject filter. */
export function historySubjects(attempts: readonly TestAttempt[]): string[] {
  return distinctSorted(attempts.flatMap((attempt) => attempt.subjects));
}

export function filterAttempts(
  attempts: readonly TestAttempt[],
  filters: HistoryFilters,
): TestAttempt[] {
  const needle = filters.query.trim().toLocaleLowerCase();
  const matches = attempts.filter((attempt) => {
    if (filters.mode !== "all" && attempt.mode !== filters.mode) return false;
    if (filters.subject !== null && !attempt.subjects.includes(filters.subject))
      return false;
    if (needle === "") return true;
    return [attempt.title, ...attempt.subjects, ...attempt.classes].some(
      (field) => field.toLocaleLowerCase().includes(needle),
    );
  });
  const byDate = (a: TestAttempt, b: TestAttempt) =>
    b.completedAtMs - a.completedAtMs;
  const sorters: Record<
    HistorySort,
    (a: TestAttempt, b: TestAttempt) => number
  > = {
    newest: byDate,
    oldest: (a, b) => -byDate(a, b),
    best: (a, b) => attemptPercent(b) - attemptPercent(a) || byDate(a, b),
    worst: (a, b) => attemptPercent(a) - attemptPercent(b) || byDate(a, b),
  };
  return matches.sort(sorters[filters.sort]);
}

/* -------------------------------------------------------------------------- */
/* Loading and deleting, per backend                                          */
/* -------------------------------------------------------------------------- */

export type HistoryActor = Pick<
  backendInterface,
  "getAttemptHistory" | "getSessionResult"
>;

/**
 * Every test the backend knows about. On Supabase that includes the mirrored
 * Test Builder runs; elsewhere it is the recorded runs only, and the device's
 * own runs are merged in by the caller.
 */
export async function loadRemoteAttempts(
  actor: HistoryActor | null,
): Promise<TestAttempt[]> {
  if (isCustomSyncEnabled()) {
    const { fetchServerTestHistory } = await import("@/lib/supabase/history");
    return (await fetchServerTestHistory()).flatMap((raw) => {
      const attempt = parseTestAttempt(raw);
      return attempt ? [attempt] : [];
    });
  }
  if (!actor) return [];
  return ((await actor.getAttemptHistory()) ?? []).map(attemptFromSummary);
}

export async function loadAttemptDetail(
  actor: HistoryActor | null,
  kind: TestKind,
  id: string,
): Promise<TestAttemptDetail | null> {
  if (kind === "custom") {
    const local = getLocalSession(id);
    if (local && local.status === "completed") return detailFromLocal(local);
  }
  if (isCustomSyncEnabled()) {
    const { fetchServerTestAttempt } = await import("@/lib/supabase/history");
    return parseTestAttemptDetail(await fetchServerTestAttempt(kind, id));
  }
  if (kind !== "session" || !actor || !/^\d{1,18}$/.test(id)) return null;
  const sessionId = BigInt(id);
  const [result, summaries] = await Promise.all([
    actor.getSessionResult(sessionId),
    actor.getAttemptHistory(),
  ]);
  if (!result) return null;
  const title =
    summaries?.find((summary) => summary.id === sessionId)?.scopeLabel ??
    "Practice session";
  return detailFromSessionResult(result, title);
}

/** The mock and the canister keep recorded runs with no way to remove one. */
export function canDeleteAttempt(kind: TestKind): boolean {
  return isCustomSyncEnabled() || kind === "custom";
}

/**
 * Remove a test everywhere the account keeps it. The server goes first: a
 * device copy deleted while the mirror survives would come back on the next
 * read, which looks like a delete that did not work.
 */
export async function deleteAttempt(
  kind: TestKind,
  id: string,
): Promise<boolean> {
  let removed = false;
  if (isCustomSyncEnabled()) {
    const { deleteServerTestAttempt } = await import("@/lib/supabase/history");
    removed = await deleteServerTestAttempt(kind, id);
  } else if (kind === "session") {
    throw new Error("Recorded tests cannot be deleted on this backend.");
  }
  if (kind === "custom") removed = deleteLocalSession(id) || removed;
  return removed;
}
