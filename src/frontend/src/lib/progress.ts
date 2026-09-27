/**
 * Study-progress math shared by the dashboard, analytics, and reminders.
 *
 * Everything here is pure so it can be unit-tested against fixed clocks and
 * reused from the daily digest builder. Timestamps are epoch milliseconds;
 * callers convert backend nanosecond bigints before calling.
 */

export interface AttemptLike {
  /** Epoch milliseconds when the attempt was completed. */
  completedAtMs: number;
  score: number;
  total: number;
}

export interface AccuracySummary {
  correct: number;
  total: number;
  /** 0–100, weighted by question, not by attempt. */
  percent: number;
}

/** Local-calendar day key, e.g. `2026-09-26`. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Sortable day number for arithmetic on consecutive days. */
function dayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function keyAfter(key: string, offsetDays: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + offsetDays));
  const m = String(next.getUTCMonth() + 1).padStart(2, "0");
  const d = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${m}-${d}`;
}

export interface StreakSummary {
  /** Consecutive practice days ending today, or yesterday if today has none yet. */
  current: number;
  /** Longest run of consecutive practice days ever recorded. */
  best: number;
  /** Whether at least one attempt happened today. */
  practicedToday: boolean;
}

/**
 * Day-streak over the days the learner completed at least one session.
 *
 * A streak stays "alive" until the day after a missed day: practicing every
 * day including yesterday but not yet today still counts, so a morning
 * reminder still shows yesterday's streak rather than resetting it to zero.
 */
export function computeStreak(
  attempts: AttemptLike[],
  nowMs = Date.now(),
): StreakSummary {
  const days = new Set(
    attempts.map((attempt) => dayKey(attempt.completedAtMs)),
  );
  const today = dayKey(nowMs);
  const practicedToday = days.has(today);

  let anchor: string | null = null;
  if (practicedToday) {
    anchor = today;
  } else if (days.has(keyAfter(today, -1))) {
    anchor = keyAfter(today, -1);
  }

  let current = 0;
  if (anchor !== null) {
    let cursor: string | null = anchor;
    while (cursor !== null && days.has(cursor)) {
      current += 1;
      cursor = keyAfter(cursor, -1);
    }
  }

  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of [...days].sort()) {
    const number = dayNumber(key);
    run = previous !== null && number - previous === 1 ? run + 1 : 1;
    previous = number;
    best = Math.max(best, run);
  }

  return { current, best: Math.max(best, current), practicedToday };
}

/** Question-weighted accuracy across every attempt. */
export function computeAccuracy(attempts: AttemptLike[]): AccuracySummary {
  let correct = 0;
  let total = 0;
  for (const attempt of attempts) {
    if (attempt.total <= 0) continue;
    correct += attempt.score;
    total += attempt.total;
  }
  const percent = total > 0 ? Math.min(100, (correct / total) * 100) : 0;
  return { correct, total, percent };
}
