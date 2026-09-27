/**
 * Persistence for client-assembled tests (the test-builder flow).
 *
 * These sessions never touch the backend — the canister session API is scoped
 * to one topic or chapter — so they live in this device-local store, guarded
 * by the same safe-storage helpers as everything else. Completed tests keep
 * per-question rows (with class/subject labels captured at build time) so
 * analytics can merge them with backend-recorded history.
 *
 * The store is keyed to the signed-in account (`lib/deviceScope`), because these
 * rows are the learner's record and the dashboard reads them: a second sign-in
 * on the same browser must not inherit another's accuracy and streak.
 */
import { parseWithBigints, stringifyWithBigints } from "@/lib/bigintJson";
import { adoptUnscoped, scopedKey, watchDeviceScope } from "@/lib/deviceScope";
import { reportStorageProblem, safeSetItem } from "@/lib/localStore";
import type { AssembledQuestion, TopicLabels } from "@/lib/sessionEngine";
import type {
  AnswerData,
  QuestionType,
  SessionMode,
  SubmittedAnswer,
} from "@/types";

const BASE_KEY = "studyforge.custom-sessions.v1";
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
/** The bucket `cache` was read from, so a sign-in cannot reuse another's rows. */
let cacheScope: string | null = null;

function load(): StoreShape {
  const scope = scopedKey(BASE_KEY);
  if (cache && cacheScope === scope) return cache;
  const raw = adoptUnscoped(BASE_KEY);
  if (raw === null) {
    cache = { version: 1, sessions: [] };
    cacheScope = scope;
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
  cacheScope = scope;
  return cache;
}

function persist(next: StoreShape): void {
  const scope = scopedKey(BASE_KEY);
  cache = next;
  cacheScope = scope;
  if (safeSetItem(scope, stringifyWithBigints(next))) {
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

// useSyncExternalStore compares snapshots with Object.is, so list getters must
// hand back the same array reference until the store actually changes.
let completedCache: { source: StoreShape; value: LocalSession[] } | null = null;

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
    // The unscoped name is in the list because a sibling tab's first read can
    // claim it: the row it moves out of is this tab's cache too.
    if (event.key === scopedKey(BASE_KEY) || event.key === BASE_KEY) {
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

// A sign-in in this very tab moves the bucket without touching storage, so no
// `storage` event reaches us; this is how a dashboard that is already open
// stops showing the previous account's runs.
watchDeviceScope(() => {
  cache = null;
  for (const listener of listeners) listener();
});
