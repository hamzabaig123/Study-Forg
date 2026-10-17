import { SessionMode } from "@/types";

export function modeLabel(mode: SessionMode): string {
  return mode === SessionMode.timedTest ? "Timed test" : "Practice";
}

/** Same thresholds as the analytics attempt list, so a score reads alike on both. */
export function scoreTone(percent: number): string {
  if (percent >= 80) return "text-success";
  if (percent >= 50) return "text-warning";
  return "text-destructive";
}

/** "Oct 18, 4:05 PM", with the year only when it is not this year's. */
export function formatAttemptDate(ms: number, now = Date.now()): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString(undefined, {
    year: sameYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "October 2026" — the heading a run is grouped under. */
export function monthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function formatTimeLimit(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return minutes >= 1 ? `${minutes} min limit` : `${seconds}s limit`;
}
