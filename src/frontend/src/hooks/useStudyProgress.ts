import { useAnalyticsBreakdown } from "@/hooks/useAnalytics";
/**
 * React bindings over the local custom-session store plus the merged view the
 * dashboard, analytics, and reminders consume: every attempt the account knows
 * about — backend-recorded, test-builder runs from this device, and
 * test-builder runs mirrored from other devices on Supabase.
 */
import { useAttemptHistory } from "@/hooks/useSessions";
import {
  fetchServerCustomSessions,
  isCustomSyncEnabled,
  mergeCustomSessions,
} from "@/lib/customSync";
import { timestampToDate } from "@/lib/format";
import {
  listCompletedLocalSessions,
  subscribeLocalSessions,
} from "@/lib/localSessions";
import type { LocalSession } from "@/lib/localSessions";
import {
  type AccuracySummary,
  type AttemptLike,
  type StreakSummary,
  computeAccuracy,
  computeStreak,
} from "@/lib/progress";
import type {
  AccuracyBucket,
  AnalyticsBreakdown,
  QuestionType as QuestionTypeKind,
  SessionMode,
} from "@/types";
import { QuestionType } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { useMemo } from "react";

export interface MergedAttempt {
  /** Stable key: backend numeric id or local string id. */
  key: string;
  completedAtMs: number;
  total: number;
  mode: SessionMode;
  scopeLabel: string;
  score: number;
  source: "backend" | "local";
}

function localToAttempt(session: LocalSession): MergedAttempt {
  return {
    key: `local:${session.id}`,
    completedAtMs: session.completedAtMs ?? session.startedAtMs,
    total: session.total,
    mode: session.mode,
    scopeLabel: session.scopeLabel,
    score: session.score,
    source: "local",
  };
}

/** Completed local tests, newest first. */
function useCompletedLocalSessions(): LocalSession[] {
  return useSyncExternalStore(
    subscribeLocalSessions,
    listCompletedLocalSessions,
    listCompletedLocalSessions,
  );
}

/**
 * Completed test-builder runs from everywhere the account has them: this
 * device's store plus the server mirror (Supabase only), deduplicated by id —
 * the device copy wins because it also carries the assembled questions.
 */
export function useAllCompletedCustomSessions(): LocalSession[] {
  const local = useCompletedLocalSessions();
  const serverQuery = useQuery({
    queryKey: ["custom-sessions", "server"],
    queryFn: fetchServerCustomSessions,
    enabled: isCustomSyncEnabled(),
    staleTime: 60_000,
  });
  return useMemo(
    () => mergeCustomSessions(local, serverQuery.data ?? []),
    [local, serverQuery.data],
  );
}

export interface StudyProgress {
  attempts: MergedAttempt[];
  /** Backend history failed to load (local attempts are still included). */
  backendError: boolean;
  accuracy: AccuracySummary;
  streak: StreakSummary;
  attemptsToday: number;
}

/**
 * Accuracy, day streak, and the merged attempt list across every recorder —
 * backend history, this device's test-builder runs, and the server mirror.
 * Backend failures degrade gracefully: local tests still count.
 */
export function useStudyProgress(): StudyProgress {
  const historyQuery = useAttemptHistory();
  const localSessions = useAllCompletedCustomSessions();

  return useMemo<StudyProgress>(() => {
    const attempts: MergedAttempt[] = [];
    for (const summary of historyQuery.data ?? []) {
      const date = timestampToDate(summary.completedAt);
      if (!date) continue;
      attempts.push({
        key: `backend:${summary.id.toString()}`,
        completedAtMs: date.getTime(),
        total: Number(summary.total),
        mode: summary.mode,
        scopeLabel: summary.scopeLabel,
        score: Number(summary.score),
        source: "backend",
      });
    }
    for (const session of localSessions) {
      attempts.push(localToAttempt(session));
    }
    attempts.sort((a, b) => b.completedAtMs - a.completedAtMs);

    const attemptLikes: AttemptLike[] = attempts.map((attempt) => ({
      completedAtMs: attempt.completedAtMs,
      score: attempt.score,
      total: attempt.total,
    }));

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    return {
      attempts,
      backendError: historyQuery.isError,
      accuracy: computeAccuracy(attemptLikes),
      streak: computeStreak(attemptLikes),
      attemptsToday: attempts.filter(
        (attempt) => attempt.completedAtMs >= todayStart.getTime(),
      ).length,
    };
  }, [historyQuery.data, historyQuery.isError, localSessions]);
}

/* -------------------------------------------------------------------------- */
/* Merged accuracy breakdown                                                  */
/* -------------------------------------------------------------------------- */

const TYPE_LABELS: Record<QuestionTypeKind, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

const EMPTY_BREAKDOWN: AnalyticsBreakdown = {
  byClass: [],
  bySubject: [],
  byQuestionType: [],
};

/** Sum backend and local per-question outcomes into shared buckets. */
function mergeBuckets(
  backend: readonly AccuracyBucket[],
  local: readonly AccuracyBucket[],
): AccuracyBucket[] {
  const totals = new Map<string, { correct: number; total: number }>();
  const put = (bucket: AccuracyBucket) => {
    const existing = totals.get(bucket.bucketLabel);
    if (existing) {
      existing.correct += Number(bucket.correct);
      existing.total += Number(bucket.total);
    } else {
      totals.set(bucket.bucketLabel, {
        correct: Number(bucket.correct),
        total: Number(bucket.total),
      });
    }
  };
  for (const bucket of backend) put(bucket);
  for (const bucket of local) put(bucket);
  return [...totals.entries()].map(([bucketLabel, sums]) => ({
    bucketLabel,
    correct: BigInt(sums.correct),
    total: BigInt(sums.total),
    accuracyPercent: sums.total > 0 ? (sums.correct / sums.total) * 100 : 0,
  }));
}

/**
 * Backend accuracy breakdown with locally-assembled tests folded in, so the
 * charts reflect every attempt on this device. Local tests know their class
 * and subject from the labels captured at build time.
 */
export function useMergedBreakdown() {
  const backendQuery = useAnalyticsBreakdown();
  const localSessions = useAllCompletedCustomSessions();

  const breakdown = useMemo<AnalyticsBreakdown>(() => {
    const backend = backendQuery.data ?? EMPTY_BREAKDOWN;
    if (localSessions.length === 0) return backend;

    const classTotals = new Map<string, { correct: number; total: number }>();
    const subjectTotals = new Map<string, { correct: number; total: number }>();
    const typeTotals = new Map<string, { correct: number; total: number }>();
    const bump = (
      map: Map<string, { correct: number; total: number }>,
      key: string,
      correct: boolean,
    ) => {
      const entry = map.get(key) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (correct) entry.correct += 1;
      map.set(key, entry);
    };
    for (const session of localSessions) {
      for (const result of session.results) {
        bump(classTotals, result.labels.className, result.correct);
        bump(subjectTotals, result.labels.subjectName, result.correct);
        bump(typeTotals, TYPE_LABELS[result.questionType], result.correct);
      }
    }
    const toBuckets = (
      map: Map<string, { correct: number; total: number }>,
    ): AccuracyBucket[] =>
      [...map.entries()].map(([bucketLabel, sums]) => ({
        bucketLabel,
        correct: BigInt(sums.correct),
        total: BigInt(sums.total),
        accuracyPercent: sums.total > 0 ? (sums.correct / sums.total) * 100 : 0,
      }));

    return {
      byClass: mergeBuckets(backend.byClass, toBuckets(classTotals)),
      bySubject: mergeBuckets(backend.bySubject, toBuckets(subjectTotals)),
      byQuestionType: mergeBuckets(
        backend.byQuestionType,
        toBuckets(typeTotals),
      ),
    };
  }, [backendQuery.data, localSessions]);

  return {
    breakdown,
    isLoading: backendQuery.isLoading,
    isError: backendQuery.isError,
    refetch: backendQuery.refetch,
  };
}
