/**
 * React bindings for the daily reminder system: settings state, the digest
 * payload assembled from live progress data, and the scheduler lifecycle.
 */
import { useDashboardStats } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useBackend } from "@/hooks/useBackend";
import { useStudyProgress } from "@/hooks/useStudyProgress";
import {
  type DigestInput,
  type ReminderSettings,
  type SendOutcome,
  buildDigest,
  getReminderSettings,
  saveReminderSettings,
  sendDigestNow,
  startReminderScheduler,
} from "@/lib/reminders";
import { subscribeReminderSettings } from "@/lib/reminders";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";

export function useReminderSettings(): ReminderSettings {
  return useSyncExternalStore(
    subscribeReminderSettings,
    getReminderSettings,
    getReminderSettings,
  );
}

export function useSaveReminderSettings() {
  return saveReminderSettings;
}

/** The digest StudyForge would send right now, from live progress data. */
export function useDigestInput(): DigestInput | null {
  const { displayName } = useAuth();
  const progress = useStudyProgress();
  const statsQuery = useDashboardStats();

  return useMemo<DigestInput | null>(() => {
    if (progress.backendError && progress.attempts.length === 0) return null;
    // progress.attempts is the full merged stream — backend sessions plus
    // every test-builder run the account has, local or mirrored — so "today"
    // needs no separate scan of the local store.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayAttempts = progress.attempts.filter(
      (attempt) => attempt.completedAtMs >= startOfDay.getTime(),
    );
    const questionsToday = todayAttempts.reduce(
      (sum, attempt) => sum + attempt.total,
      0,
    );
    return {
      displayName,
      accuracyPercent: progress.accuracy.percent,
      answeredTotal: progress.accuracy.total,
      correctTotal: progress.accuracy.correct,
      streakDays: progress.streak.current,
      bestStreakDays: progress.streak.best,
      attemptsToday: todayAttempts.length,
      questionsToday,
      questionBank: statsQuery.data
        ? Number(statsQuery.data.questionCount)
        : null,
      dateLabel: new Date().toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    };
  }, [displayName, progress, statsQuery.data]);
}

/**
 * Starts the once-a-minute scheduler while a signed-in shell is mounted.
 * The digest payload is read at fire time, not captured, so the numbers are
 * always the day's latest.
 */
export function useReminderScheduler(): void {
  const digestInput = useDigestInput();
  const inputRef = useRef(digestInput);
  inputRef.current = digestInput;

  useEffect(() => {
    return startReminderScheduler(() => inputRef.current);
  }, []);
}

/** Send the digest immediately — the settings page's "send a test" action. */
export function useSendTestDigest(): {
  send: () => Promise<SendOutcome | null>;
  sending: boolean;
} {
  const digestInput = useDigestInput();
  const [sending, setSending] = useState(false);

  const send = async (): Promise<SendOutcome | null> => {
    if (!digestInput) return null;
    setSending(true);
    try {
      return await sendDigestNow(digestInput);
    } finally {
      setSending(false);
    }
  };

  return { send, sending };
}

export function useReminderBackendReady(): boolean {
  const { actor } = useBackend();
  return !!actor;
}
