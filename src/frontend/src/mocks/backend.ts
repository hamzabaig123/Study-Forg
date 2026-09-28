/**
 * In-browser stand-in for the StudyForge canister, loaded by
 * `createActorWithConfig` when `VITE_USE_MOCK=true`. It implements the full
 * `backendInterface` against a localStorage database and mirrors the canister
 * semantics encoded in `test/pocketic/backend.test.ts`: wrapper-variant results
 * (`__kind__`), `undefined` optionals, nanosecond timestamps, note revision
 * conflicts, link URL validation and create-or-reuse share behaviour.
 */
import type {
  AccuracyBucket,
  ActivityItem,
  AiConfigStatus,
  AnalyticsBreakdown,
  AnswerData,
  AnswerFeedback,
  AttemptSummary,
  BreadcrumbItem,
  ChapterDetail,
  ChapterSummary,
  ClassDetail,
  ClassSummary,
  CreatedLink,
  DashboardStats,
  DraftQuestion,
  EditToken,
  GenerateRequest,
  GenerateResult,
  GeneratedDraft,
  Id,
  LinkDetail,
  NoteShareLink,
  NoteView,
  PublicQuestion,
  Question,
  QuestionResult,
  ResolveResult,
  Result,
  Result_1,
  Result_2,
  Result_3,
  Result_4,
  Result_5,
  Result_6,
  Result__1,
  ScanStats,
  SessionQuestion,
  SessionResult,
  SessionScope,
  SessionView,
  ShareLink,
  ShareTarget,
  SharedContent,
  SharedNote,
  ShortCode,
  StartSessionRequest,
  SubjectDetail,
  SubjectSummary,
  SubmitAnswerRequest,
  SubmittedAnswer,
  Timestamp,
  TopicDetail,
  TopicPath,
  TopicSummary,
  UserDataExport,
  UserSettingsView,
  backendInterface,
} from "@/backend";
import {
  AiSource,
  DeviceType,
  ExportError,
  ExportFormat,
  LinkStatus,
  NoteShareError,
  QuestionType,
  SessionMode,
  ShareError,
  UnavailableReason,
  UserRole,
} from "@/backend";
import type { Principal } from "@icp-sdk/core/principal";
import { tagBigints, untagBigints } from "@/lib/bigintJson";
import { exportFileFor } from "@/lib/questionExport";
import { reportStorageProblem, safeSetItem } from "@/lib/localStore";

/* -------------------------------------------------------------------------- */
/* Stored shape                                                               */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = "studyforge.mock-backend.v1";
const ACTIVITY_LIMIT = 200;

const MAX_DISPLAY_NAME = 80;
const MAX_STUDY_GOAL = 280;
const MAX_DAILY_TARGET = 1000;
const APPEARANCES: string[] = ["light", "dark", "frosted", "maroon"];

/**
 * `backend.ts` declares both a generic `Option<T>` (its `Some`/`None` wrapper)
 * and the MCQ `Option` record, and the generated file is `@ts-nocheck`ed, so
 * the bare name cannot be imported into checked code. This is the MCQ record.
 */
interface QuestionOption {
  id: Id;
  text: string;
}

interface ScopeRef {
  kind: "topic" | "chapter";
  id: number;
}

interface TimeRow {
  id: number;
  createdAt: number;
  updatedAt: number;
}

interface ClassRow extends TimeRow {
  name: string;
  description?: string;
}

interface SubjectRow extends ClassRow {
  classId: number;
}

interface ChapterRow extends ClassRow {
  subjectId: number;
}

interface TopicRow extends ClassRow {
  chapterId: number;
}

interface QuestionRow extends TimeRow {
  topicId: number;
  prompt: string;
  questionType: QuestionType;
  answer: AnswerData;
  explanation?: string;
}

interface SessionRecord {
  questionId: number;
  topicId: number;
  prompt: string;
  questionType: QuestionType;
  options: QuestionOption[];
  answer: AnswerData;
  explanation?: string;
  submitted?: SubmittedAnswer;
  correct?: boolean;
}

interface SessionRow {
  id: number;
  mode: SessionMode;
  scope: ScopeRef;
  scopeLabel: string;
  startedAt: number;
  expiresAt?: number;
  durationSeconds?: number;
  records: SessionRecord[];
}

interface ResultRecord {
  questionId: number;
  prompt: string;
  questionType: QuestionType;
  correctAnswer: AnswerData;
  explanation?: string;
  submitted?: SubmittedAnswer;
  correct: boolean;
}

interface ResultRow {
  id: number;
  mode: SessionMode;
  scope: ScopeRef;
  scopeLabel: string;
  startedAt: number;
  completedAt: number;
  score: number;
  total: number;
  results: ResultRecord[];
}

interface NoteRow extends TimeRow {
  title: string;
  subjectLabel?: string;
  chapterLabel?: string;
  topicLabel?: string;
  documentJson: string;
  searchText: string;
  status: "active" | "trashed";
  revision: number;
  deletedAt?: number;
}

interface NoteShareRow {
  token: string;
  noteId: number;
  createdAt: number;
  status: "active" | "revoked";
}

interface ContentShareRow {
  token: string;
  scope: ScopeRef;
  createdAt: number;
}

interface LinkRow extends TimeRow {
  code: string;
  editToken: string;
  targetUrl: string;
  status: "active" | "paused" | "deleted";
}

interface ScanRow {
  linkId: number;
  at: number;
  device: DeviceType;
  country?: string;
}

interface ActivityRow {
  at: number;
  title: string;
  kind: string;
}

interface SettingsRow {
  displayName: string;
  studyGoal: string;
  dailyTarget: number;
  appearance: string;
  updatedAt: number;
}

interface MockDb {
  version: number;
  nextId: number;
  classes: ClassRow[];
  subjects: SubjectRow[];
  chapters: ChapterRow[];
  topics: TopicRow[];
  questions: QuestionRow[];
  sessions: SessionRow[];
  results: ResultRow[];
  notes: NoteRow[];
  noteShares: NoteShareRow[];
  contentShares: ContentShareRow[];
  links: LinkRow[];
  scans: ScanRow[];
  activity: ActivityRow[];
  settings: SettingsRow | null;
  aiKey: string | null;
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

let cache: MockDb | null = null;

function emptyDb(): MockDb {
  return {
    version: 1,
    nextId: 1,
    classes: [],
    subjects: [],
    chapters: [],
    topics: [],
    questions: [],
    sessions: [],
    results: [],
    notes: [],
    noteShares: [],
    contentShares: [],
    links: [],
    scans: [],
    activity: [],
    settings: null,
    aiKey: null,
  };
}

function database(): MockDb {
  if (cache) {
    return cache;
  }
  let next = emptyDb();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    reportStorageProblem("blocked");
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw, untagBigints) as Partial<MockDb>;
      next = { ...next, ...parsed };
    } catch {
      archiveUnreadable(raw);
    }
  }
  cache = next;
  return cache;
}

/**
 * Starting empty is only survivable if the unreadable bytes are kept — the
 * first write after this replaces the store with an empty snapshot, so without
 * the copy one bad read becomes permanent total loss.
 */
function archiveUnreadable(raw: string): void {
  for (let slot = 0; slot < 3; slot += 1) {
    const key = `${STORAGE_KEY}.corrupt.${slot}`;
    try {
      if (window.localStorage.getItem(key) !== null) continue;
      window.localStorage.setItem(key, raw);
    } catch {
      break;
    }
    break;
  }
  reportStorageProblem("corrupt");
}

let lastWritten: string | null = null;

function persist(): void {
  let payload: string;
  try {
    payload = JSON.stringify(tagBigints(database()));
  } catch {
    // A row that cannot be serialised is a bug, not a storage problem, but it
    // still means nothing was saved.
    reportStorageProblem("blocked");
    return;
  }
  if (!safeSetItem(STORAGE_KEY, payload)) {
    return;
  }
  lastWritten = payload;
}

/**
 * Two tabs share one blob, so the content itself is last-write-wins. Ids are
 * the part that must not collide: both tabs would hand the same id out and the
 * library would end up with rows that shadow each other.
 */
function adoptForeignNextId(raw: string | null): void {
  if (!cache || !raw || raw === lastWritten) {
    return;
  }
  try {
    const parsed = JSON.parse(raw, untagBigints) as Partial<MockDb>;
    if (typeof parsed.nextId === "number" && parsed.nextId > cache.nextId) {
      cache.nextId = parsed.nextId;
    }
  } catch {
    /* an unreadable foreign blob has no id to take */
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      adoptForeignNextId(event.newValue);
    }
  });
}

function allocateId(): number {
  const db = database();
  const id = db.nextId;
  db.nextId += 1;
  return id;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const MS_TO_NS = 1_000_000n;

/**
 * Share and link tokens are credentials: whoever holds one can open (or, for a
 * link's edit token, change) what it points at. A backup is a file that gets
 * emailed and left in Downloads, so it carries the rows without them.
 */
function withoutFields<T extends object>(row: T, fields: string[]): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const field of fields) {
    delete copy[field];
  }
  return copy as T;
}

function stamp(ms: number): Timestamp {
  return BigInt(Math.round(ms)) * MS_TO_NS;
}

function count(value: bigint | number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function optionalLabel(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function randomAlphabet(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto?.getRandomValues?.(bytes);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet.charAt((bytes[index] ?? Math.floor(Math.random() * 256)) % alphabet.length);
  }
  return out;
}

function shortCode(): string {
  // Deliberately the same alphabet and length as `lib/supabase/tokens.ts`: a
  // link created against the mock and later moved to Postgres must satisfy the
  // `link.code` CHECK. The contract test reads both literals.
  return randomAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 10);
}

function editToken(): string {
  return randomAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789", 32);
}

function shareToken(prefix: string): string {
  return `${prefix}_${randomAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 24)}`;
}

function logActivity(kind: string, title: string): void {
  const db = database();
  db.activity.unshift({ at: Date.now(), kind, title });
  if (db.activity.length > ACTIVITY_LIMIT) {
    db.activity.length = ACTIVITY_LIMIT;
  }
}

/* -------------------------------------------------------------------------- */
/* Row -> view mapping                                                        */
/* -------------------------------------------------------------------------- */

function subjectCountOf(classId: number): bigint {
  return BigInt(database().subjects.filter((row) => row.classId === classId).length);
}

function chapterCountOf(subjectId: number): bigint {
  return BigInt(database().chapters.filter((row) => row.subjectId === subjectId).length);
}

function topicCountOf(chapterId: number): bigint {
  return BigInt(database().topics.filter((row) => row.chapterId === chapterId).length);
}

function questionCountOf(topicId: number): bigint {
  return BigInt(database().questions.filter((row) => row.topicId === topicId).length);
}

function classView(row: ClassRow): ClassSummary {
  return {
    id: BigInt(row.id),
    name: row.name,
    description: row.description,
    createdAt: stamp(row.createdAt),
    updatedAt: stamp(row.updatedAt),
    subjectCount: subjectCountOf(row.id),
  };
}

function subjectView(row: SubjectRow): SubjectSummary {
  return {
    id: BigInt(row.id),
    name: row.name,
    description: row.description,
    classId: BigInt(row.classId),
    updatedAt: stamp(row.updatedAt),
    createdAt: stamp(row.createdAt),
    chapterCount: chapterCountOf(row.id),
  };
}

function chapterView(row: ChapterRow): ChapterSummary {
  return {
    id: BigInt(row.id),
    name: row.name,
    description: row.description,
    subjectId: BigInt(row.subjectId),
    updatedAt: stamp(row.updatedAt),
    createdAt: stamp(row.createdAt),
    topicCount: topicCountOf(row.id),
  };
}

function topicView(row: TopicRow): TopicSummary {
  return {
    id: BigInt(row.id),
    name: row.name,
    description: row.description,
    chapterId: BigInt(row.chapterId),
    updatedAt: stamp(row.updatedAt),
    createdAt: stamp(row.createdAt),
    questionCount: questionCountOf(row.id),
  };
}

function questionView(row: QuestionRow): Question {
  return {
    id: BigInt(row.id),
    explanation: row.explanation,
    createdAt: stamp(row.createdAt),
    answer: clone(row.answer),
    questionType: row.questionType,
    updatedAt: stamp(row.updatedAt),
    prompt: row.prompt,
    topicId: BigInt(row.topicId),
  };
}

function noteView(row: NoteRow): NoteView {
  return {
    id: BigInt(row.id),
    status: row.status,
    documentJson: row.documentJson,
    title: row.title,
    topicLabel: row.topicLabel,
    subjectLabel: row.subjectLabel,
    chapterLabel: row.chapterLabel,
    createdAt: stamp(row.createdAt),
    updatedAt: stamp(row.updatedAt),
    deletedAt: row.deletedAt === undefined ? undefined : stamp(row.deletedAt),
    revision: BigInt(row.revision),
  };
}

function noteShareView(row: NoteShareRow): NoteShareLink {
  return {
    status: row.status,
    token: row.token,
    noteId: BigInt(row.noteId),
    createdAt: stamp(row.createdAt),
  };
}

function scopeVariant(scope: ScopeRef): SessionScope {
  return scope.kind === "topic"
    ? { __kind__: "topic", topic: BigInt(scope.id) }
    : { __kind__: "chapter", chapter: BigInt(scope.id) };
}

function shareView(row: ContentShareRow): ShareLink {
  const target: ShareTarget =
    row.scope.kind === "topic"
      ? { __kind__: "topic", topic: BigInt(row.scope.id) }
      : { __kind__: "chapter", chapter: BigInt(row.scope.id) };
  return { token: row.token, createdAt: stamp(row.createdAt), target };
}

function linkDetailView(row: LinkRow): LinkDetail {
  return {
    id: BigInt(row.id),
    status: LinkStatus[row.status],
    code: row.code,
    createdAt: stamp(row.createdAt),
    targetUrl: row.targetUrl,
    updatedAt: stamp(row.updatedAt),
    shortUrl: `/r/${row.code}`,
  };
}

function sessionView(row: SessionRow): SessionView {
  const questions: SessionQuestion[] = row.records.map((record) => ({
    id: BigInt(record.questionId),
    questionType: record.questionType,
    prompt: record.prompt,
    options: clone(record.options),
  }));
  return {
    id: BigInt(row.id),
    startedAt: stamp(row.startedAt),
    expiresAt: row.expiresAt === undefined ? undefined : stamp(row.expiresAt),
    mode: row.mode,
    scopeLabel: row.scopeLabel,
    scope: scopeVariant(row.scope),
    durationSeconds: row.durationSeconds === undefined ? undefined : BigInt(row.durationSeconds),
    questions,
  };
}

function resultView(row: ResultRow): SessionResult {
  const results: QuestionResult[] = row.results.map((record) => ({
    submitted: record.submitted === undefined ? undefined : clone(record.submitted),
    explanation: record.explanation,
    correctAnswer: clone(record.correctAnswer),
    correct: record.correct,
    questionType: record.questionType,
    questionId: BigInt(record.questionId),
    prompt: record.prompt,
  }));
  return {
    id: BigInt(row.id),
    completedAt: stamp(row.completedAt),
    startedAt: stamp(row.startedAt),
    total: BigInt(row.total),
    mode: row.mode,
    results,
    scope: scopeVariant(row.scope),
    score: BigInt(row.score),
  };
}

function settingsView(row: SettingsRow): UserSettingsView {
  return {
    displayName: row.displayName,
    studyGoal: row.studyGoal,
    dailyTarget: BigInt(row.dailyTarget),
    appearance: row.appearance,
    updatedAt: stamp(row.updatedAt),
  };
}

function activityView(row: ActivityRow): ActivityItem {
  return { at: stamp(row.at), title: row.title, kind: row.kind };
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                    */
/* -------------------------------------------------------------------------- */

function findClass(id: Id): ClassRow | undefined {
  const numeric = Number(id);
  return database().classes.find((row) => row.id === numeric);
}

function findSubject(id: Id): SubjectRow | undefined {
  const numeric = Number(id);
  return database().subjects.find((row) => row.id === numeric);
}

function findChapter(id: Id): ChapterRow | undefined {
  const numeric = Number(id);
  return database().chapters.find((row) => row.id === numeric);
}

function findTopic(id: Id): TopicRow | undefined {
  const numeric = Number(id);
  return database().topics.find((row) => row.id === numeric);
}

function findNote(id: Id): NoteRow | undefined {
  const numeric = Number(id);
  return database().notes.find((row) => row.id === numeric);
}

function ancestorsOf(topicId: number): { topic: TopicRow; chapter: ChapterRow; subject: SubjectRow; class: ClassRow } | null {
  const db = database();
  const topic = db.topics.find((row) => row.id === topicId);
  const chapter = topic === undefined ? undefined : db.chapters.find((row) => row.id === topic.chapterId);
  const subject = chapter === undefined ? undefined : db.subjects.find((row) => row.id === chapter.subjectId);
  const owner = subject === undefined ? undefined : db.classes.find((row) => row.id === subject.classId);
  if (!topic || !chapter || !subject || !owner) {
    return null;
  }
  return { topic, chapter, subject, class: owner };
}

/** Owning class and subject for a session scope, or null once they are gone. */
function chainOf(scope: ScopeRef): { classId: number; subjectId: number } | null {
  const db = database();
  const chapterId =
    scope.kind === "topic" ? db.topics.find((row) => row.id === scope.id)?.chapterId : scope.id;
  const chapter = chapterId === undefined ? undefined : db.chapters.find((row) => row.id === chapterId);
  const subject = chapter === undefined ? undefined : db.subjects.find((row) => row.id === chapter.subjectId);
  if (subject === undefined || !db.classes.some((row) => row.id === subject.classId)) {
    return null;
  }
  return { classId: subject.classId, subjectId: subject.id };
}

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multipleChoice: "Multiple choice",
  trueFalse: "True / false",
  shortAnswer: "Short answer",
};

function questionTypeLabel(kind: QuestionType): string {
  return QUESTION_TYPE_LABELS[kind];
}

function scopeTarget(scope: ScopeRef): { label: string; topicIds: number[] } | null {
  const db = database();
  if (scope.kind === "topic") {
    const topic = db.topics.find((row) => row.id === scope.id);
    return topic ? { label: topic.name, topicIds: [topic.id] } : null;
  }
  const chapter = db.chapters.find((row) => row.id === scope.id);
  if (!chapter) {
    return null;
  }
  return { label: chapter.name, topicIds: db.topics.filter((row) => row.chapterId === chapter.id).map((row) => row.id) };
}

function questionsInScope(scope: ScopeRef): QuestionRow[] {
  const db = database();
  const target = scopeTarget(scope);
  if (!target) {
    return [];
  }
  return db.questions.filter((row) => target.topicIds.includes(row.topicId));
}

function breadcrumbFor(scope: ScopeRef): BreadcrumbItem[] | null {
  const db = database();
  if (scope.kind === "topic") {
    const chain = ancestorsOf(scope.id);
    if (!chain) {
      return null;
    }
    return [chain.class, chain.subject, chain.chapter, chain.topic].map((row) => ({ id: BigInt(row.id), name: row.name }));
  }
  const chapter = db.chapters.find((row) => row.id === scope.id);
  const subject = chapter === undefined ? undefined : db.subjects.find((row) => row.id === chapter.subjectId);
  const owner = subject === undefined ? undefined : db.classes.find((row) => row.id === subject.classId);
  if (!chapter || !subject || !owner) {
    return null;
  }
  return [owner, subject, chapter].map((row) => ({ id: BigInt(row.id), name: row.name }));
}

function publicQuestion(row: QuestionRow): PublicQuestion {
  return {
    id: BigInt(row.id),
    questionType: row.questionType,
    prompt: row.prompt,
    options: row.answer.__kind__ === "multipleChoice" ? clone(row.answer.multipleChoice.options) : [],
  };
}

/* -------------------------------------------------------------------------- */
/* Validation, export and generation                                          */
/* -------------------------------------------------------------------------- */

const SHORT_PATH_PREFIX = "/r/";

/** Mirrors `hostOf` in `lib/qr-links.mo`: userinfo, port and path are dropped. */
function hostOf(remainder: string): string {
  let host = remainder.split("/")[0].split("?")[0].split("#")[0];
  const at = host.split("@");
  host = at[at.length - 1];
  if (host.startsWith("[")) {
    return `${host.split("]")[0]}]`;
  }
  return host.split(":")[0];
}

/** Mirrors `pathOf` in `lib/qr-links.mo`, stopping at a query or fragment. */
function pathOf(remainder: string): string {
  const parts = remainder.split("/");
  if (parts.length < 2) {
    return "";
  }
  let path = "/";
  for (let index = 1; index < parts.length; index += 1) {
    const segment = parts[index];
    if (segment.startsWith("?") || segment.startsWith("#")) {
      break;
    }
    path += segment;
    if (index + 1 < parts.length) {
      path += "/";
    }
  }
  return path;
}

/** Mirrors `isPrivateHost` in `lib/qr-links.mo`: loopback, ULA and RFC1918 literals. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "[::1]") {
    return true;
  }
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
    return true;
  }
  const octets = h.split(".");
  if (octets.length !== 4) {
    return false;
  }
  const first = Number(octets[0]);
  const second = Number(octets[1]);
  if (first === 10 || first === 127) {
    return true;
  }
  if (first === 169 && second === 254) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  return first === 172 && second >= 16 && second <= 31;
}

function urlProblem(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return "Enter a URL to shorten.";
  }
  const separator = trimmed.indexOf("://");
  if (separator < 0) {
    return "URL must start with http:// or https://";
  }
  const scheme = trimmed.slice(0, separator).toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return "Only http and https links are allowed.";
  }
  const remainder = trimmed.slice(separator + 3);
  if (remainder.length === 0) {
    return "URL is missing a host.";
  }
  const host = hostOf(remainder);
  if (host.length === 0) {
    return "URL is missing a host.";
  }
  if (isPrivateHost(host)) {
    return "Links to private or local addresses are not allowed.";
  }
  if (pathOf(remainder).startsWith(SHORT_PATH_PREFIX)) {
    return "Links cannot point back at this app's short links.";
  }
  return null;
}

/** The masked hint for a saved key: first three and last four characters. */
function maskKey(key: string): string {
  const chars = Array.from(key);
  if (chars.length <= 7) {
    return "••••";
  }
  return chars.slice(0, 3).join("") + chars.slice(-4).join("");
}

const STOPWORDS = new Set([
  "about", "above", "after", "again", "also", "because", "before", "being", "between", "can", "cannot", "could",
  "does", "doing", "each", "from", "had", "have", "having", "here", "itself", "just", "into", "more", "most",
  "other", "over", "own", "same", "should", "some", "such", "than", "that", "their", "them", "then", "there",
  "these", "they", "this", "those", "very", "what", "when", "where", "which", "while", "with", "would", "your",
]);

function sentencesFrom(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .replace(/([.!?;])\s+/gu, "$1\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.split(/\s+/u).length >= 5);
}

function termsFrom(sentences: string[]): string[] {
  const seen = new Map<string, number>();
  for (const sentence of sentences) {
    for (const word of sentence.split(/[^\p{L}\p{N}-]+/u)) {
      const lower = word.toLowerCase();
      if (lower.length >= 5 && !STOPWORDS.has(lower)) {
        seen.set(word, Math.max(seen.get(word) ?? 0, lower.length));
      }
    }
  }
  return [...seen.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function blankOut(sentence: string, term: string): string {
  const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu");
  return sentence.replace(pattern, "____");
}

function makeDraft(db: MockDb, sentences: string[], terms: string[], index: number): GeneratedDraft {
  const sentence = sentences[index % sentences.length];
  const localTerms = sentence
    .split(/[^\p{L}\p{N}-]+/u)
    .map((word) => ({ word, lower: word.toLowerCase() }))
    .filter((entry) => entry.lower.length >= 5 && !STOPWORDS.has(entry.lower));
  const term = localTerms[0]?.word ?? terms[index % terms.length] ?? "the concept";
  const distractors = terms.filter((candidate) => candidate.toLowerCase() !== term.toLowerCase()).slice(0, 3);
  const kind = index % 3;

  if (kind === 0 && distractors.length >= 3) {
    const correctPosition = index % 4;
    const texts: string[] = [];
    for (let position = 0; position < 4; position += 1) {
      if (position === correctPosition) {
        texts.push(term);
        continue;
      }
      texts.push(distractors[position > correctPosition ? position - 1 : position]);
    }
    const options: QuestionOption[] = texts.map((text, position) => ({ id: BigInt(allocateId()), text }));
    return {
      source: AiSource.platform,
      draft: {
        id: BigInt(allocateId()),
        topicId: 0n,
        prompt: `Fill in the blank: "${blankOut(sentence, term)}"`,
        questionType: QuestionType.multipleChoice,
        answer: {
          __kind__: "multipleChoice",
          multipleChoice: { options, correctOptionId: options[correctPosition].id },
        },
        explanation: `The source passage reads: ${sentence}`,
      },
    };
  }

  if (kind === 1) {
    const truthful = index % 2 === 0;
    const alternative = distractors[0] ?? term;
    const statement = truthful ? sentence : blankOut(sentence, term).replace("____", alternative);
    return {
      source: AiSource.platform,
      draft: {
        id: BigInt(allocateId()),
        topicId: 0n,
        prompt: `True or false: ${statement}`,
        questionType: QuestionType.trueFalse,
        answer: { __kind__: "trueFalse", trueFalse: { correct: truthful } },
        explanation: truthful
          ? `This matches the source passage: ${sentence}`
          : `The source passage says "${sentence}", so this statement is false.`,
      },
    };
  }

  return {
    source: AiSource.platform,
    draft: {
      id: BigInt(allocateId()),
      topicId: 0n,
      prompt: `In your own words, explain the role of "${term}" in this passage.`,
      questionType: QuestionType.shortAnswer,
      answer: { __kind__: "shortAnswer", shortAnswer: { expected: sentence } },
      explanation: `Expected to cover: ${sentence}`,
    },
  };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * `SubmittedAnswer` and `AnswerData` share variant names but not field names
 * (`optionId` vs `correctOptionId`, `value` vs `correct`, `text` vs `expected`),
 * so each kind is compared against its own pair of fields.
 */
function isCorrectAnswer(submitted: SubmittedAnswer, expected: AnswerData): boolean {
  if (submitted.__kind__ !== expected.__kind__) {
    return false;
  }
  if (submitted.__kind__ === "trueFalse" && expected.__kind__ === "trueFalse") {
    return submitted.trueFalse.value === expected.trueFalse.correct;
  }
  if (submitted.__kind__ === "shortAnswer" && expected.__kind__ === "shortAnswer") {
    return normalizeText(submitted.shortAnswer.text) === normalizeText(expected.shortAnswer.expected);
  }
  if (submitted.__kind__ === "multipleChoice" && expected.__kind__ === "multipleChoice") {
    return submitted.multipleChoice.optionId === expected.multipleChoice.correctOptionId;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* The mock actor                                                             */
/* -------------------------------------------------------------------------- */

export const mockBackend = {
  async _initialize_access_control(): Promise<void> {},

  async _internet_identity_sign_in_start(): Promise<Uint8Array> {
    return new Uint8Array(0);
  },

  async _internet_identity_sign_in_finish(): Promise<Result_6> {
    return { __kind__: "ok", ok: null };
  },

  async getApiDoc(): Promise<string> {
    return "# StudyForge local backend\n\nThis build stores everything in your browser, so no canister is contacted.\n";
  },

  async schema(): Promise<string> {
    return JSON.stringify({ storage: "localStorage", key: STORAGE_KEY, version: 1 });
  },

  async execute(): Promise<Result__1> {
    return { hasMore: false, rows: [] };
  },

  async getCallerUserRole(): Promise<UserRole> {
    return UserRole.user;
  },

  async isCallerAdmin(): Promise<boolean> {
    return false;
  },

  async assignCallerUserRole(_user: Principal, _role: UserRole): Promise<void> {},

  /* ---------------------------------- classes --------------------------------- */

  async createClass(name: string, description: string | null): Promise<ClassSummary> {
    const at = Date.now();
    const row: ClassRow = { id: allocateId(), name, description: optionalLabel(description), createdAt: at, updatedAt: at };
    database().classes.push(row);
    logActivity("class", `Created class "${name}"`);
    persist();
    return classView(row);
  },

  async listClasses(): Promise<ClassSummary[]> {
    return database().classes.map(classView);
  },

  async getClass(classId: Id): Promise<ClassDetail | null> {
    const row = findClass(classId);
    if (!row) {
      return null;
    }
    return {
      class: classView(row),
      subjects: database().subjects.filter((item) => item.classId === row.id).map(subjectView),
    };
  },

  async renameClass(classId: Id, name: string, description: string | null): Promise<ClassSummary | null> {
    const row = findClass(classId);
    if (!row) {
      return null;
    }
    row.name = name;
    row.description = optionalLabel(description);
    row.updatedAt = Date.now();
    persist();
    return classView(row);
  },

  async deleteClass(classId: Id): Promise<boolean> {
    const db = database();
    const row = findClass(classId);
    if (!row) {
      return false;
    }
    const subjectIds = db.subjects.filter((item) => item.classId === row.id).map((item) => item.id);
    const chapterIds = db.chapters.filter((item) => subjectIds.includes(item.subjectId)).map((item) => item.id);
    const topicIds = db.topics.filter((item) => chapterIds.includes(item.chapterId)).map((item) => item.id);
    db.questions = db.questions.filter((item) => !topicIds.includes(item.topicId));
    db.topics = db.topics.filter((item) => !chapterIds.includes(item.chapterId));
    db.chapters = db.chapters.filter((item) => !subjectIds.includes(item.subjectId));
    db.subjects = db.subjects.filter((item) => item.classId !== row.id);
    db.classes = db.classes.filter((item) => item.id !== row.id);
    db.contentShares = db.contentShares.filter(
      (item) => !(item.scope.kind === "topic" ? topicIds : chapterIds).includes(item.scope.id),
    );
    persist();
    return true;
  },

  /* --------------------------------- subjects --------------------------------- */

  async createSubject(classId: Id, name: string, description: string | null): Promise<SubjectSummary | null> {
    if (!findClass(classId)) {
      return null;
    }
    const at = Date.now();
    const row: SubjectRow = {
      id: allocateId(),
      classId: Number(classId),
      name,
      description: optionalLabel(description),
      createdAt: at,
      updatedAt: at,
    };
    database().subjects.push(row);
    logActivity("subject", `Created subject "${name}"`);
    persist();
    return subjectView(row);
  },

  async listSubjects(classId: Id): Promise<SubjectSummary[]> {
    const numeric = Number(classId);
    return database().subjects.filter((row) => row.classId === numeric).map(subjectView);
  },

  async getSubject(subjectId: Id): Promise<SubjectDetail | null> {
    const row = findSubject(subjectId);
    if (!row) {
      return null;
    }
    return {
      subject: subjectView(row),
      chapters: database().chapters.filter((item) => item.subjectId === row.id).map(chapterView),
    };
  },

  async renameSubject(subjectId: Id, name: string, description: string | null): Promise<SubjectSummary | null> {
    const row = findSubject(subjectId);
    if (!row) {
      return null;
    }
    row.name = name;
    row.description = optionalLabel(description);
    row.updatedAt = Date.now();
    persist();
    return subjectView(row);
  },

  async deleteSubject(subjectId: Id): Promise<boolean> {
    const db = database();
    const row = findSubject(subjectId);
    if (!row) {
      return false;
    }
    const chapterIds = db.chapters.filter((item) => item.subjectId === row.id).map((item) => item.id);
    const topicIds = db.topics.filter((item) => chapterIds.includes(item.chapterId)).map((item) => item.id);
    db.questions = db.questions.filter((item) => !topicIds.includes(item.topicId));
    db.topics = db.topics.filter((item) => !chapterIds.includes(item.chapterId));
    db.chapters = db.chapters.filter((item) => item.subjectId !== row.id);
    db.subjects = db.subjects.filter((item) => item.id !== row.id);
    db.contentShares = db.contentShares.filter(
      (item) => !(item.scope.kind === "topic" ? topicIds : chapterIds).includes(item.scope.id),
    );
    persist();
    return true;
  },

  /* --------------------------------- chapters --------------------------------- */

  async createChapter(subjectId: Id, name: string, description: string | null): Promise<ChapterSummary | null> {
    if (!findSubject(subjectId)) {
      return null;
    }
    const at = Date.now();
    const row: ChapterRow = {
      id: allocateId(),
      subjectId: Number(subjectId),
      name,
      description: optionalLabel(description),
      createdAt: at,
      updatedAt: at,
    };
    database().chapters.push(row);
    logActivity("chapter", `Created chapter "${name}"`);
    persist();
    return chapterView(row);
  },

  async listChapters(subjectId: Id): Promise<ChapterSummary[]> {
    const numeric = Number(subjectId);
    return database().chapters.filter((row) => row.subjectId === numeric).map(chapterView);
  },

  async getChapter(chapterId: Id): Promise<ChapterDetail | null> {
    const row = findChapter(chapterId);
    if (!row) {
      return null;
    }
    return {
      chapter: chapterView(row),
      topics: database().topics.filter((item) => item.chapterId === row.id).map(topicView),
    };
  },

  async renameChapter(chapterId: Id, name: string, description: string | null): Promise<ChapterSummary | null> {
    const row = findChapter(chapterId);
    if (!row) {
      return null;
    }
    row.name = name;
    row.description = optionalLabel(description);
    row.updatedAt = Date.now();
    persist();
    return chapterView(row);
  },

  async deleteChapter(chapterId: Id): Promise<boolean> {
    const db = database();
    const row = findChapter(chapterId);
    if (!row) {
      return false;
    }
    const topicIds = db.topics.filter((item) => item.chapterId === row.id).map((item) => item.id);
    db.questions = db.questions.filter((item) => !topicIds.includes(item.topicId));
    db.topics = db.topics.filter((item) => item.chapterId !== row.id);
    db.chapters = db.chapters.filter((item) => item.id !== row.id);
    db.contentShares = db.contentShares.filter(
      (item) => !(item.scope.kind === "topic" ? topicIds : [row.id]).includes(item.scope.id),
    );
    persist();
    return true;
  },

  /* ---------------------------------- topics ---------------------------------- */

  async createTopic(chapterId: Id, name: string, description: string | null): Promise<TopicSummary | null> {
    if (!findChapter(chapterId)) {
      return null;
    }
    const at = Date.now();
    const row: TopicRow = {
      id: allocateId(),
      chapterId: Number(chapterId),
      name,
      description: optionalLabel(description),
      createdAt: at,
      updatedAt: at,
    };
    database().topics.push(row);
    logActivity("topic", `Created topic "${name}"`);
    persist();
    return topicView(row);
  },

  async listTopics(chapterId: Id): Promise<TopicSummary[]> {
    const numeric = Number(chapterId);
    return database().topics.filter((row) => row.chapterId === numeric).map(topicView);
  },

  async getTopic(topicId: Id): Promise<TopicDetail | null> {
    const row = findTopic(topicId);
    if (!row) {
      return null;
    }
    return {
      topic: topicView(row),
      questions: database().questions.filter((item) => item.topicId === row.id).map(questionView),
    };
  },

  async getTopicPath(topicId: Id): Promise<TopicPath | null> {
    const chain = ancestorsOf(Number(topicId));
    if (!chain) {
      return null;
    }
    return {
      class: { id: BigInt(chain.class.id), name: chain.class.name },
      subject: { id: BigInt(chain.subject.id), name: chain.subject.name },
      chapter: { id: BigInt(chain.chapter.id), name: chain.chapter.name },
      topic: { id: BigInt(chain.topic.id), name: chain.topic.name },
    };
  },

  async renameTopic(topicId: Id, name: string, description: string | null): Promise<TopicSummary | null> {
    const row = findTopic(topicId);
    if (!row) {
      return null;
    }
    row.name = name;
    row.description = optionalLabel(description);
    row.updatedAt = Date.now();
    persist();
    return topicView(row);
  },

  async deleteTopic(topicId: Id): Promise<boolean> {
    const db = database();
    const row = findTopic(topicId);
    if (!row) {
      return false;
    }
    db.questions = db.questions.filter((item) => item.topicId !== row.id);
    db.topics = db.topics.filter((item) => item.id !== row.id);
    db.contentShares = db.contentShares.filter((item) => !(item.scope.kind === "topic" && item.scope.id === row.id));
    persist();
    return true;
  },

  /* --------------------------------- questions -------------------------------- */

  async createQuestion(
    topicId: Id,
    prompt: string,
    questionType: QuestionType,
    answer: AnswerData,
    explanation: string | null,
  ): Promise<Question | null> {
    const topic = findTopic(topicId);
    if (!topic) {
      return null;
    }
    const at = Date.now();
    const row: QuestionRow = {
      id: allocateId(),
      topicId: topic.id,
      prompt,
      questionType,
      answer: clone(answer),
      explanation: optionalLabel(explanation),
      createdAt: at,
      updatedAt: at,
    };
    database().questions.push(row);
    logActivity("question", `Added a question to "${topic.name}"`);
    persist();
    return questionView(row);
  },

  async listQuestions(topicId: Id): Promise<Question[]> {
    const numeric = Number(topicId);
    return database().questions.filter((row) => row.topicId === numeric).map(questionView);
  },

  async updateQuestion(
    questionId: Id,
    prompt: string,
    questionType: QuestionType,
    answer: AnswerData,
    explanation: string | null,
  ): Promise<Question | null> {
    const numeric = Number(questionId);
    const row = database().questions.find((item) => item.id === numeric);
    if (!row) {
      return null;
    }
    row.prompt = prompt;
    row.questionType = questionType;
    row.answer = clone(answer);
    row.explanation = optionalLabel(explanation);
    row.updatedAt = Date.now();
    persist();
    return questionView(row);
  },

  async deleteQuestion(questionId: Id): Promise<boolean> {
    const numeric = Number(questionId);
    const db = database();
    const before = db.questions.length;
    db.questions = db.questions.filter((row) => row.id !== numeric);
    persist();
    return db.questions.length < before;
  },

  /* --------------------------------- sessions --------------------------------- */

  async startSession(request: StartSessionRequest): Promise<Result_1> {
    const scope: ScopeRef =
      request.scope.__kind__ === "topic" ? { kind: "topic", id: Number(request.scope.topic) } : { kind: "chapter", id: Number(request.scope.chapter) };
    const target = scopeTarget(scope);
    if (!target) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    const pool = questionsInScope(scope);
    if (pool.length === 0) {
      return { __kind__: "err", err: { __kind__: "noQuestions", noQuestions: null } };
    }
    const timed = request.mode === SessionMode.timedTest;
    let limit = pool.length;
    let durationSeconds: number | undefined;
    if (timed) {
      const requested = request.questionCount === undefined ? pool.length : Number(request.questionCount);
      if (requested === 0) {
        return {
          __kind__: "err",
          err: { __kind__: "invalidInput", invalidInput: "questionCount must be greater than zero" },
        };
      }
      limit = Math.min(requested, pool.length);
      const seconds = request.durationSeconds === undefined ? undefined : Number(request.durationSeconds);
      if (seconds === undefined) {
        return {
          __kind__: "err",
          err: { __kind__: "invalidInput", invalidInput: "durationSeconds is required for a timed test" },
        };
      }
      if (seconds === 0) {
        return {
          __kind__: "err",
          err: { __kind__: "invalidInput", invalidInput: "durationSeconds must be greater than zero" },
        };
      }
      durationSeconds = seconds;
    }
    const startedAt = Date.now();
    const row: SessionRow = {
      id: allocateId(),
      mode: request.mode,
      scope,
      scopeLabel: target.label,
      startedAt,
      expiresAt: durationSeconds === undefined ? undefined : startedAt + durationSeconds * 1000,
      durationSeconds,
      records: pool.slice(0, limit).map((question) => ({
        questionId: question.id,
        topicId: question.topicId,
        prompt: question.prompt,
        questionType: question.questionType,
        options: question.answer.__kind__ === "multipleChoice" ? clone(question.answer.multipleChoice.options) : [],
        answer: clone(question.answer),
        explanation: question.explanation,
      })),
    };
    database().sessions.push(row);
    persist();
    return { __kind__: "ok", ok: sessionView(row) };
  },

  async getSession(sessionId: Id): Promise<SessionView | null> {
    const numeric = Number(sessionId);
    const row = database().sessions.find((item) => item.id === numeric);
    return row ? sessionView(row) : null;
  },

  async submitAnswer(request: SubmitAnswerRequest): Promise<Result> {
    const numeric = Number(request.sessionId);
    const session = database().sessions.find((item) => item.id === numeric);
    if (!session) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    if (session.expiresAt !== undefined && Date.now() > session.expiresAt) {
      return { __kind__: "err", err: { __kind__: "invalidInput", invalidInput: "time has expired" } };
    }
    const record = session.records.find((item) => item.questionId === Number(request.questionId));
    if (!record) {
      return { __kind__: "err", err: { __kind__: "invalidInput", invalidInput: "question is not part of this session" } };
    }
    if (!database().questions.some((item) => item.id === record.questionId)) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    record.submitted = clone(request.answer);
    record.correct = isCorrectAnswer(request.answer, record.answer);
    persist();
    return {
      __kind__: "ok",
      ok: {
        correct: record.correct === true,
        correctAnswer: clone(record.answer),
        explanation: record.explanation,
      } satisfies AnswerFeedback,
    };
  },

  async completeSession(sessionId: Id): Promise<Result_5> {
    const db = database();
    const numeric = Number(sessionId);
    const index = db.sessions.findIndex((item) => item.id === numeric);
    if (index < 0) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    const session = db.sessions[index];
    const completedAt = Date.now();
    const live = new Set(db.questions.map((question) => question.id));
    const results: ResultRecord[] = session.records
      .filter((record) => live.has(record.questionId))
      .map((record) => ({
        questionId: record.questionId,
        prompt: record.prompt,
        questionType: record.questionType,
        correctAnswer: clone(record.answer),
        explanation: record.explanation,
        submitted: record.submitted === undefined ? undefined : clone(record.submitted),
        correct: record.correct === true,
      }));
    const row: ResultRow = {
      id: session.id,
      mode: session.mode,
      scope: session.scope,
      scopeLabel: session.scopeLabel,
      startedAt: session.startedAt,
      completedAt,
      score: results.filter((record) => record.correct).length,
      total: results.length,
      results,
    };
    db.sessions.splice(index, 1);
    db.results.unshift(row);
    logActivity("session", `${session.mode === SessionMode.timedTest ? "Timed test" : "Practice"} completed — ${String(row.score)}/${String(row.total)}`);
    persist();
    return { __kind__: "ok", ok: resultView(row) };
  },

  async getSessionResult(sessionId: Id): Promise<SessionResult | null> {
    const numeric = Number(sessionId);
    const row = database().results.find((item) => item.id === numeric);
    if (!row) {
      return null;
    }
    // The live session is gone by then, so the real canister re-checks
    // ownership through the recorded scope and hides a result whose target
    // has since been deleted.
    return scopeTarget(row.scope) ? resultView(row) : null;
  },

  async getAttemptHistory(): Promise<AttemptSummary[]> {
    return database()
      .results.filter((row) => scopeTarget(row.scope) !== null)
      .slice()
      .sort((a, b) => b.completedAt - a.completedAt)
      .map((row) => ({
        id: BigInt(row.id),
        completedAt: stamp(row.completedAt),
        total: BigInt(row.total),
        mode: row.mode,
        scopeLabel: scopeTarget(row.scope)!.label,
        score: BigInt(row.score),
      }));
  },

  /* -------------------------------- analytics --------------------------------- */

  async getAnalyticsBreakdown(): Promise<AnalyticsBreakdown> {
    const classTotals = new Map<number, { total: number; correct: number }>();
    const subjectTotals = new Map<number, { total: number; correct: number }>();
    const typeTotals = new Map<string, { total: number; correct: number }>();
    const accumulate = (
      buckets: Map<number | string, { total: number; correct: number }>,
      key: number | string,
      correct: boolean,
    ) => {
      const current = buckets.get(key) ?? { total: 0, correct: 0 };
      current.total += 1;
      if (correct) {
        current.correct += 1;
      }
      buckets.set(key, current);
    };
    for (const row of database().results) {
      const chain = chainOf(row.scope);
      if (!chain) {
        continue;
      }
      for (const record of row.results) {
        accumulate(classTotals, chain.classId, record.correct);
        accumulate(subjectTotals, chain.subjectId, record.correct);
        accumulate(typeTotals, questionTypeLabel(record.questionType), record.correct);
      }
    }
    const bucket = (
      buckets: Map<number | string, { total: number; correct: number }>,
      label: (key: number | string) => string,
    ): AccuracyBucket[] =>
      [...buckets.entries()]
        .sort((a, b) => (typeof a[0] === "number" && typeof b[0] === "number" ? a[0] - b[0] : String(a[0]).localeCompare(String(b[0]))))
        .map(([key, entry]) => ({
          bucketLabel: label(key),
          total: BigInt(entry.total),
          correct: BigInt(entry.correct),
          accuracyPercent: entry.total === 0 ? 0 : (entry.correct / entry.total) * 100,
        }));
    const db = database();
    return {
      byClass: bucket(classTotals, (id) => db.classes.find((row) => row.id === id)?.name ?? `Class ${String(id)}`),
      bySubject: bucket(subjectTotals, (id) => db.subjects.find((row) => row.id === id)?.name ?? `Subject ${String(id)}`),
      byQuestionType: bucket(typeTotals, (label) => String(label)),
    };
  },

  async getDashboardStats(): Promise<DashboardStats> {
    const db = database();
    return {
      classCount: BigInt(db.classes.length),
      subjectCount: BigInt(db.subjects.length),
      chapterCount: BigInt(db.chapters.length),
      topicCount: BigInt(db.topics.length),
      questionCount: BigInt(db.questions.length),
    };
  },

  async getRecentActivity(limit: bigint): Promise<ActivityItem[]> {
    const wanted = Number(limit);
    if (wanted <= 0) {
      return [];
    }
    return database()
      .activity.slice(0, wanted)
      .map(activityView);
  },

  /* --------------------------------- sharing ---------------------------------- */

  async createShare(target: ShareTarget): Promise<Result_4> {
    const db = database();
    const scope: ScopeRef =
      target.__kind__ === "topic" ? { kind: "topic", id: Number(target.topic) } : { kind: "chapter", id: Number(target.chapter) };
    const resolved = scopeTarget(scope);
    if (!resolved) {
      return { __kind__: "err", err: ShareError.notFound };
    }
    const existing = db.contentShares.find((item) => item.scope.kind === scope.kind && item.scope.id === scope.id);
    if (existing) {
      return { __kind__: "ok", ok: shareView(existing) };
    }
    const row: ContentShareRow = { token: shareToken("share"), scope, createdAt: Date.now() };
    db.contentShares.push(row);
    logActivity("share", `Created a share link for "${resolved.label}"`);
    persist();
    return { __kind__: "ok", ok: shareView(row) };
  },

  async listShares(): Promise<ShareLink[]> {
    return database().contentShares.slice().sort((a, b) => b.createdAt - a.createdAt).map(shareView);
  },

  async revokeShare(token: string): Promise<boolean> {
    const db = database();
    const before = db.contentShares.length;
    db.contentShares = db.contentShares.filter((row) => row.token !== token);
    persist();
    return db.contentShares.length < before;
  },

  async getSharedContent(token: string): Promise<SharedContent | null> {
    const db = database();
    const share = db.contentShares.find((item) => item.token === token);
    if (!share) {
      return null;
    }
    const target = scopeTarget(share.scope);
    const breadcrumb = breadcrumbFor(share.scope);
    if (!target || !breadcrumb) {
      return null;
    }
    return {
      title: target.label,
      breadcrumb,
      questions: questionsInScope(share.scope).map(publicQuestion),
    };
  },

  /* --------------------------------- exports ---------------------------------- */

  async exportContent(target: ShareTarget, format: ExportFormat): Promise<Result_3> {
    const scope: ScopeRef =
      target.__kind__ === "topic" ? { kind: "topic", id: Number(target.topic) } : { kind: "chapter", id: Number(target.chapter) };
    const resolved = scopeTarget(scope);
    if (!resolved) {
      return { __kind__: "err", err: ExportError.notFound };
    }
    const rows = questionsInScope(scope);
    if (rows.length === 0) {
      return { __kind__: "err", err: ExportError.empty };
    }
    return { __kind__: "ok", ok: exportFileFor(resolved.label, rows, format) };
  },

  async exportMyData(): Promise<UserDataExport> {
    const db = database();
    return {
      content: JSON.stringify(
        tagBigints({
          exportedAt: new Date().toISOString(),
          classes: db.classes,
          subjects: db.subjects,
          chapters: db.chapters,
          topics: db.topics,
          questions: db.questions,
          notes: db.notes,
          noteShares: db.noteShares.map((row) => withoutFields(row, ["token"])),
          shares: db.contentShares.map((row) =>
            withoutFields(row, ["token"]),
          ),
          links: db.links.map((row) => withoutFields(row, ["editToken"])),
          sessions: db.sessions,
          results: db.results,
          settings: db.settings,
          activity: db.activity,
        }),
        null,
        2,
      ),
      mimeType: "application/json",
      filename: "studydesk-export.json",
    };
  },

  /* ----------------------------------- AI ------------------------------------- */

  async getAiConfig(): Promise<AiConfigStatus> {
    const key = database().aiKey;
    if (!key) {
      return { hasPersonalKey: false };
    }
    return { hasPersonalKey: true, keyHint: maskKey(key) };
  },

  async saveAiKey(key: string): Promise<AiConfigStatus> {
    const db = database();
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      throw new Error("API key must not be empty");
    }
    db.aiKey = trimmed;
    persist();
    return { hasPersonalKey: true, keyHint: maskKey(trimmed) };
  },

  async removeAiKey(): Promise<AiConfigStatus> {
    const db = database();
    db.aiKey = null;
    persist();
    return { hasPersonalKey: false };
  },

  async generateDrafts(request: GenerateRequest): Promise<Result_2> {
    const invalid = (message: string): Result_2 => ({
      __kind__: "err",
      err: { __kind__: "invalidRequest", invalidRequest: message },
    });
    if (Number(request.count) === 0) {
      return invalid("Ask for at least one question");
    }
    const hasSource = (request.sourceText ?? "").length > 0;
    if (request.prompt.length === 0 && !hasSource) {
      return invalid("Provide a prompt or some source text");
    }
    const db = database();
    const topicName = findTopic(request.topicId)?.name ?? "this topic";
    const sentences = sentencesFrom([request.sourceText, request.prompt, topicName].filter(Boolean).join(" "));
    if (sentences.length === 0) {
      sentences.push(`Explain the key ideas behind ${topicName}`);
    }
    const terms = termsFrom(sentences);
    const source = db.aiKey ? AiSource.personalKey : AiSource.platform;
    const drafts: GeneratedDraft[] = [];
    for (let index = 0; index < Number(request.count); index += 1) {
      const draft = makeDraft(db, sentences, terms, index);
      draft.draft.topicId = BigInt(request.topicId);
      drafts.push({ ...draft, source });
    }
    persist();
    return { __kind__: "ok", ok: { source, drafts } };
  },

  async acceptDraft(topicId: Id, draft: DraftQuestion): Promise<Question | null> {
    const topic = findTopic(topicId);
    if (!topic) {
      return null;
    }
    const at = Date.now();
    const row: QuestionRow = {
      id: allocateId(),
      topicId: topic.id,
      prompt: draft.prompt,
      questionType: draft.questionType,
      answer: clone(draft.answer),
      explanation: draft.explanation,
      createdAt: at,
      updatedAt: at,
    };
    database().questions.push(row);
    logActivity("question", `Accepted an AI draft into "${topic.name}"`);
    persist();
    return questionView(row);
  },

  /* --------------------------------- QR links --------------------------------- */

  async createLink(targetUrl: string): Promise<Awaited<ReturnType<backendInterface["createLink"]>>> {
    const problem = urlProblem(targetUrl);
    if (problem) {
      return { __kind__: "err", err: { __kind__: "invalidUrl", invalidUrl: problem } };
    }
    const at = Date.now();
    const row: LinkRow = {
      id: allocateId(),
      code: shortCode(),
      editToken: editToken(),
      targetUrl: targetUrl.trim(),
      status: "active",
      createdAt: at,
      updatedAt: at,
    };
    database().links.push(row);
    logActivity("link", `Created the short link /r/${row.code}`);
    persist();
    const ok: CreatedLink = {
      id: BigInt(row.id),
      status: LinkStatus.active,
      code: row.code,
      createdAt: stamp(row.createdAt),
      targetUrl: row.targetUrl,
      editToken: row.editToken,
      manageUrl: `/manage/${row.editToken}`,
      shortUrl: `/r/${row.code}`,
    };
    return { __kind__: "ok", ok };
  },

  async resolveCode(code: ShortCode, device: DeviceType, country: string | null): Promise<ResolveResult> {
    const db = database();
    const row = db.links.find((item) => item.code === code);
    if (!row) {
      return { __kind__: "unavailable", unavailable: UnavailableReason.notFound };
    }
    if (row.status === "deleted") {
      return { __kind__: "unavailable", unavailable: UnavailableReason.deleted };
    }
    if (row.status === "paused") {
      return { __kind__: "unavailable", unavailable: UnavailableReason.paused };
    }
    db.scans.push({ linkId: row.id, at: Date.now(), device, country: optionalLabel(country) });
    persist();
    return { __kind__: "redirect", redirect: { targetUrl: row.targetUrl } };
  },

  async getLinkByToken(token: EditToken): Promise<LinkDetail | null> {
    const row = database().links.find((item) => item.editToken === token);
    return row ? linkDetailView(row) : null;
  },

  async getScanStats(token: EditToken): Promise<ScanStats | null> {
    const db = database();
    const link = db.links.find((item) => item.editToken === token);
    if (!link) {
      return null;
    }
    const perDay = new Map<string, number>();
    for (const scan of db.scans.filter((item) => item.linkId === link.id)) {
      const day = new Date(scan.at).toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    return {
      totalScans: BigInt(perDay.size === 0 ? 0 : [...perDay.values()].reduce((sum, value) => sum + value, 0)),
      perDay: [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, value]) => ({ day, count: BigInt(value) })),
    };
  },

  async setPaused(token: EditToken, paused: boolean): Promise<Awaited<ReturnType<backendInterface["setPaused"]>>> {
    const row = database().links.find((item) => item.editToken === token);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    row.status = paused ? "paused" : "active";
    row.updatedAt = Date.now();
    persist();
    return { __kind__: "ok", ok: linkDetailView(row) };
  },

  async updateTarget(token: EditToken, targetUrl: string): Promise<Awaited<ReturnType<backendInterface["updateTarget"]>>> {
    const row = database().links.find((item) => item.editToken === token);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    const problem = urlProblem(targetUrl);
    if (problem) {
      return { __kind__: "err", err: { __kind__: "invalidUrl", invalidUrl: problem } };
    }
    row.targetUrl = targetUrl.trim();
    row.updatedAt = Date.now();
    persist();
    return { __kind__: "ok", ok: linkDetailView(row) };
  },

  async deleteLink(token: EditToken): Promise<Awaited<ReturnType<backendInterface["deleteLink"]>>> {
    const row = database().links.find((item) => item.editToken === token);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    row.status = "deleted";
    row.updatedAt = Date.now();
    persist();
    return { __kind__: "ok", ok: null };
  },

  async reportAbuse(code: ShortCode, reason: string): Promise<Awaited<ReturnType<backendInterface["reportAbuse"]>>> {
    if (code.length === 0) {
      return { __kind__: "err", err: { __kind__: "invalidInput", invalidInput: "A short code is required." } };
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length === 0) {
      return { __kind__: "err", err: { __kind__: "invalidInput", invalidInput: "Describe the problem with this link." } };
    }
    if (!database().links.some((item) => item.code === code)) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    return { __kind__: "ok", ok: null };
  },

  /* ---------------------------------- notes ----------------------------------- */

  async createNote(
    title: string,
    subjectLabel: string | null,
    chapterLabel: string | null,
    topicLabel: string | null,
    documentJson: string,
    searchText: string,
  ): Promise<NoteView> {
    const at = Date.now();
    const row: NoteRow = {
      id: allocateId(),
      title,
      subjectLabel: optionalLabel(subjectLabel),
      chapterLabel: optionalLabel(chapterLabel),
      topicLabel: optionalLabel(topicLabel),
      documentJson,
      searchText,
      status: "active",
      revision: 1,
      createdAt: at,
      updatedAt: at,
    };
    database().notes.push(row);
    logActivity("note", `Created the note "${title}"`);
    persist();
    return noteView(row);
  },

  async listNotes(searchQuery: string | null): Promise<NoteView[]> {
    const needle = (searchQuery ?? "").trim().toLowerCase();
    return database()
      .notes.filter((row) => row.deletedAt === undefined)
      .filter((row) => {
        if (needle.length === 0) {
          return true;
        }
        return `${row.title} ${row.searchText}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(noteView);
  },

  async listTrashedNotes(): Promise<NoteView[]> {
    return database()
      .notes.filter((row) => row.deletedAt !== undefined)
      .sort((a, b) => (b.deletedAt ?? b.updatedAt) - (a.deletedAt ?? a.updatedAt))
      .map(noteView);
  },

  async getNote(noteId: Id): Promise<NoteView | null> {
    const row = findNote(noteId);
    return row ? noteView(row) : null;
  },

  async updateNote(
    noteId: Id,
    title: string,
    subjectLabel: string | null,
    chapterLabel: string | null,
    topicLabel: string | null,
    documentJson: string,
    searchText: string,
    expectedRevision: Id,
  ): Promise<Awaited<ReturnType<backendInterface["updateNote"]>>> {
    const row = findNote(noteId);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    if (BigInt(expectedRevision) !== BigInt(row.revision)) {
      return {
        __kind__: "err",
        err: { __kind__: "staleRevision", staleRevision: { expected: BigInt(expectedRevision), actual: BigInt(row.revision) } },
      };
    }
    row.title = title;
    row.subjectLabel = optionalLabel(subjectLabel);
    row.chapterLabel = optionalLabel(chapterLabel);
    row.topicLabel = optionalLabel(topicLabel);
    row.documentJson = documentJson;
    row.searchText = searchText;
    row.revision += 1;
    row.updatedAt = Date.now();
    logActivity("note", `Updated the note "${title}"`);
    persist();
    return { __kind__: "ok", ok: noteView(row) };
  },

  async renameNote(noteId: Id, title: string): Promise<Awaited<ReturnType<backendInterface["renameNote"]>>> {
    const row = findNote(noteId);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    row.title = title;
    row.revision += 1;
    row.updatedAt = Date.now();
    logActivity("note", `Renamed a note to "${title}"`);
    persist();
    return { __kind__: "ok", ok: noteView(row) };
  },

  async softDeleteNote(noteId: Id): Promise<Awaited<ReturnType<backendInterface["softDeleteNote"]>>> {
    const row = findNote(noteId);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    const at = Date.now();
    row.status = "trashed";
    row.deletedAt = at;
    row.updatedAt = at;
    row.revision += 1;
    logActivity("note", `Moved the note "${row.title}" to trash`);
    persist();
    return { __kind__: "ok", ok: noteView(row) };
  },

  async restoreNote(noteId: Id): Promise<Awaited<ReturnType<backendInterface["restoreNote"]>>> {
    const row = findNote(noteId);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    row.status = "active";
    row.deletedAt = undefined;
    row.updatedAt = Date.now();
    row.revision += 1;
    persist();
    return { __kind__: "ok", ok: noteView(row) };
  },

  async permanentlyDeleteNote(noteId: Id): Promise<Awaited<ReturnType<backendInterface["permanentlyDeleteNote"]>>> {
    const db = database();
    const row = findNote(noteId);
    if (!row) {
      return { __kind__: "err", err: { __kind__: "notFound", notFound: null } };
    }
    db.notes = db.notes.filter((item) => item.id !== row.id);
    db.noteShares = db.noteShares.filter((item) => item.noteId !== row.id);
    persist();
    return { __kind__: "ok", ok: null };
  },

  async createNoteShare(noteId: Id): Promise<Awaited<ReturnType<backendInterface["createNoteShare"]>>> {
    const row = findNote(noteId);
    if (!row) {
      return { __kind__: "err", err: NoteShareError.notAuthorized };
    }
    if (row.deletedAt !== undefined) {
      return { __kind__: "err", err: NoteShareError.notFound };
    }
    const share: NoteShareRow = { token: shareToken("note"), noteId: row.id, createdAt: Date.now(), status: "active" };
    database().noteShares.push(share);
    persist();
    return { __kind__: "ok", ok: noteShareView(share) };
  },

  async listNoteShares(): Promise<NoteShareLink[]> {
    return database().noteShares.slice().sort((a, b) => b.createdAt - a.createdAt).map(noteShareView);
  },

  async revokeNoteShare(token: string): Promise<Awaited<ReturnType<backendInterface["revokeNoteShare"]>>> {
    const db = database();
    const share = db.noteShares.find((item) => item.token === token);
    if (!share) {
      return { __kind__: "err", err: NoteShareError.notFound };
    }
    db.noteShares = db.noteShares.filter((item) => item.token !== token);
    persist();
    return { __kind__: "ok", ok: null };
  },

  async getSharedNote(token: string): Promise<SharedNote | null> {
    const db = database();
    const share = db.noteShares.find((item) => item.token === token && item.status === "active");
    if (!share) {
      return null;
    }
    const note = db.notes.find((item) => item.id === share.noteId);
    if (!note || note.deletedAt !== undefined) {
      return null;
    }
    return {
      documentJson: note.documentJson,
      title: note.title,
      updatedAt: stamp(note.updatedAt),
      revision: BigInt(note.revision),
    };
  },

  /* --------------------------------- settings --------------------------------- */

  async getMySettings(): Promise<UserSettingsView | null> {
    const row = database().settings;
    return row ? settingsView(row) : null;
  },

  async saveMySettings(
    displayName: string,
    studyGoal: string,
    dailyTarget: Id,
    appearance: string,
  ): Promise<Awaited<ReturnType<backendInterface["saveMySettings"]>>> {
    const name = displayName.trim();
    if (name.length === 0) {
      return { __kind__: "err", err: { __kind__: "invalidInput", invalidInput: "Display name is required" } };
    }
    if (name.length > MAX_DISPLAY_NAME) {
      return {
        __kind__: "err",
        err: { __kind__: "invalidInput", invalidInput: `Display name must be at most ${String(MAX_DISPLAY_NAME)} characters` },
      };
    }
    const goal = studyGoal.trim();
    if (goal.length > MAX_STUDY_GOAL) {
      return {
        __kind__: "err",
        err: { __kind__: "invalidInput", invalidInput: `Study goal must be at most ${String(MAX_STUDY_GOAL)} characters` },
      };
    }
    const target = Number(BigInt(dailyTarget));
    if (target === 0) {
      return { __kind__: "err", err: { __kind__: "invalidInput", invalidInput: "Daily target must be at least 1" } };
    }
    if (target > MAX_DAILY_TARGET) {
      return {
        __kind__: "err",
        err: { __kind__: "invalidInput", invalidInput: `Daily target must be at most ${String(MAX_DAILY_TARGET)}` },
      };
    }
    const theme = appearance.trim().toLowerCase();
    if (!APPEARANCES.includes(theme)) {
      return {
        __kind__: "err",
        err: { __kind__: "invalidInput", invalidInput: "Appearance must be one of: light, dark, frosted, maroon" },
      };
    }
    const db = database();
    const row: SettingsRow = {
      displayName: name,
      studyGoal: goal,
      dailyTarget: target,
      appearance: theme,
      updatedAt: Date.now(),
    };
    db.settings = row;
    persist();
    return { __kind__: "ok", ok: settingsView(row) };
  },
} satisfies backendInterface;
