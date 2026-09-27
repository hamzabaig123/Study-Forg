/**
 * React bindings for the daily reminder system: settings state, the digest
 * payload assembled from live progress data, and the scheduler lifecycle.
 */
import { useDashboardStats } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { useBackend } from "@/hooks/useBackend";
import { useStudyProgress } from "@/hooks/useStudyProgress";
import { USE_SUPABASE } from "@/lib/authMode";
import {
  type DigestInput,
  type ReminderSettings,
  type SendOutcome,
  buildDigest,
  getReminderSettings,
  sendTestDigestNow,
  startReminderScheduler,
  testCooldownRemainingMs,
} from "@/lib/reminders";
import { subscribeReminderSettings } from "@/lib/reminders";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";

type ReminderLogEntryClient = {
  id: string;
  sentAt: string;
  kind: "daily" | "test";
  status: "sent" | "failed";
  detail: string | null;
};

const NO_LOG_ENTRIES: ReminderLogEntryClient[] = [];

/**
 * The account's recent delivery attempts (Supabase mode). Empty on the mock —
 * there, the digest arrives as a notification and nothing is logged — and empty
 * while the `reminder_log` table is missing or the query fails, since the
 * settings page has to render either way.
 */
export function useReminderLog(): ReminderLogEntryClient[] {
  const { actor } = useBackend();
  const query = useQuery({
    queryKey: ["reminders", "log"],
    queryFn: async () => {
      const server = await import("@/lib/supabase/reminders");
      return server.fetchReminderLog(5);
    },
    enabled: !!actor && USE_SUPABASE,
    staleTime: 30_000,
    retry: false,
  });
  return query.data ?? NO_LOG_ENTRIES;
}

export function useReminderSettings(): ReminderSettings {
  return useSyncExternalStore(
    subscribeReminderSettings,
    getReminderSettings,
    getReminderSettings,
  );
}

/** The digest StudyForge would send right now, from live progress data. */
export function useDigestInput(): DigestInput | null {
  const { displayName, account } = useAuth();
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
      recipientEmail: account?.email ?? null,
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
  }, [displayName, account, progress, statsQuery.data]);
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

/**
 * Send the digest immediately — the settings page's "send a test" action.
 *
 * `cooldownMs` mirrors `sendTestDigestNow`'s gate so the button says what the
 * press would answer. The remaining time is read at render rather than stored,
 * so a page that mounted an hour ago still counts the minute from the press
 * and not from its own mount; the interval exists only to make the countdown
 * re-render, and only while a minute is still owed.
 */
export function useSendTestDigest(): {
  send: () => Promise<SendOutcome | null>;
  sending: boolean;
  cooldownMs: number;
} {
  const digestInput = useDigestInput();
  const settings = useReminderSettings();
  const [sending, setSending] = useState(false);
  const [, recountCooldown] = useState(0);
  const cooldownMs = testCooldownRemainingMs(settings, Date.now());
  const coolingDown = cooldownMs > 0;

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(
      () => recountCooldown((count) => count + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  const send = async (): Promise<SendOutcome | null> => {
    if (!digestInput) return null;
    setSending(true);
    try {
      return await sendTestDigestNow(digestInput);
    } finally {
      setSending(false);
    }
  };

  return { send, sending, cooldownMs };
}
