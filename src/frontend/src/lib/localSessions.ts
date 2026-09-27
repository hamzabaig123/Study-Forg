/**
 * Persistence for client-assembled tests (the test-builder flow).
 *
 * These sessions never touch the backend — the canister session API is scoped
 * to one topic or chapter — so they live in this device-local store, guarded
 * by the same safe-storage helpers as everything else. Completed tests keep
 * per-question rows (with class/subject labels captured at build time) so
 * analytics can merge them with backend-recorded history.
 */
import { parseWithBigints, stringifyWithBigints } from "@/lib/bigintJson";
import {
  reportStorageProblem,
  safeGetItem,
  safeSetItem,
} from "@/lib/localStore";
import type { AssembledQuestion, TopicLabels } from "@/lib/sessionEngine";
import type {
  AnswerData,
  QuestionType,
  SessionMode,
  SubmittedAnswer,
} from "@/types";

const STORAGE_KEY = "studyforge.custom-sessions.v1";
const COMPLETED_KEEP_LIMIT = 100;

export interface LocalQuestionResult {
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  submitted: SubmittedAnswer | null;
  correct: boolean;
  correctAnswer: AnswerData;
  explanation: string | null;
  labels: TopicLabels;
}

export interface LocalSession {
  /** String id (`t…`) so it can never collide with numeric backend ids. */
  id: string;
  mode: SessionMode;
  scopeLabel: string;
  questions: AssembledQuestion[];
  /** Answers by question id (string form). */
  answers: Record<string, SubmittedAnswer>;
  startedAtMs: number;
  durationSeconds: number | null;
  status: "active" | "completed";
  completedAtMs: number | null;
  results: LocalQuestionResult[];
  score: number;
  total: number;
}

interface StoreShape {
  version: 1;
  sessions: LocalSession[];
}

const listeners = new Set<() => void>();
let cache: StoreShape | null = null;

function load(): StoreShape {
  if (cache) return cache;
  const raw = safeGetItem(STORAGE_KEY);
  if (raw === null) {
    cache = { version: 1, sessions: [] };
    return cache;
  }
  try {
    const parsed = parseWithBigints(raw) as StoreShape;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.sessions)
    ) {
      throw new Error("unexpected shape");
    }
    cache = { version: 1, sessions: parsed.sessions };
  } catch {
    reportStorageProblem(
      "corrupt",
      "The saved practice history could not be read, so custom tests were reset. Everything else is untouched.",
    );
    cache = { version: 1, sessions: [] };
  }
  return cache;
}

function persist(next: StoreShape): void {
  cache = next;
  if (safeSetItem(STORAGE_KEY, stringifyWithBigints(next))) {
    for (const listener of listeners) listener();
  }
}

function newSessionId(): string {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1_000).toString(36)}`;
}

export function createLocalSession(input: {
  mode: SessionMode;
  scopeLabel: string;
  questions: AssembledQuestion[];
  durationSeconds: number | null;
}): LocalSession {
  const session: LocalSession = {
    id: newSessionId(),
    mode: input.mode,
    scopeLabel: input.scopeLabel,
    questions: input.questions,
    answers: {},
    startedAtMs: Date.now(),
    durationSeconds: input.durationSeconds,
    status: "active",
    completedAtMs: null,
    results: [],
    score: 0,
    total: input.questions.length,
  };
  persist({ ...load(), sessions: [session, ...load().sessions] });
  return session;
}

export function getLocalSession(id: string | null): LocalSession | null {
  if (!id) return null;
  return load().sessions.find((session) => session.id === id) ?? null;
}

export function saveLocalAnswers(
  id: string,
  answers: Record<string, SubmittedAnswer>,
): void {
  const sessions = load().sessions.map((session) =>
    session.id === id ? { ...session, answers } : session,
  );
  persist({ version: 1, sessions });
}

export function completeLocalSession(
  id: string,
  results: LocalQuestionResult[],
): LocalSession | null {
  const score = results.filter((result) => result.correct).length;
  let completed: LocalSession | null = null;
  const sessions = load().sessions.map((session) => {
    if (session.id !== id) return session;
    completed = {
      ...session,
      status: "completed",
      completedAtMs: Date.now(),
      results,
      score,
      total: results.length,
    };
    return completed;
  });
  if (!completed) return null;
  // Keep every active session, but cap the completed history.
  const active = sessions.filter((session) => session.status === "active");
  const finished = sessions
    .filter((session) => session.status === "completed")
    .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0))
    .slice(0, COMPLETED_KEEP_LIMIT);
  persist({
    version: 1,
    sessions: [...active, ...finished],
  });
  return completed;
}

export function deleteLocalSession(id: string): void {
  persist({
    version: 1,
    sessions: load().sessions.filter((session) => session.id !== id),
  });
}

// useSyncExternalStore compares snapshots with Object.is, so the list getters
// must hand back the same array reference until the store actually changes.
let allCache: { source: StoreShape; value: LocalSession[] } | null = null;
let completedCache: { source: StoreShape; value: LocalSession[] } | null = null;

export function listLocalSessions(): LocalSession[] {
  const source = load();
  if (!allCache || allCache.source !== source) {
    allCache = { source, value: source.sessions };
  }
  return allCache.value;
}

export function listCompletedLocalSessions(): LocalSession[] {
  const source = load();
  if (!completedCache || completedCache.source !== source) {
    completedCache = {
      source,
      value: source.sessions
        .filter((session) => session.status === "completed")
        .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0)),
    };
  }
  return completedCache.value;
}

export function subscribeLocalSessions(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      cache = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Testing helper: drop the in-memory cache and the stored copy. */
export function resetLocalSessionsForTests(): void {
  cache = null;
  safeSetItem(STORAGE_KEY, stringifyWithBigints({ version: 1, sessions: [] }));
  for (const listener of listeners) listener();
}
