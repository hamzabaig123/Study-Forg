import type { Timestamp } from "@/types";

/**
 * Motoko `Time.now()` values are nanosecond bigints. Convert through this
 * helper before any JavaScript `Date` operation.
 */
export function timestampToDate(timestamp: Timestamp): Date | null {
  const date = new Date(Number(timestamp / 1_000_000n));
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_FALLBACK = "—";

export function formatDate(timestamp: Timestamp): string {
  const date = timestampToDate(timestamp);
  if (!date) return DATE_FALLBACK;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(timestamp: Timestamp): string {
  const date = timestampToDate(timestamp);
  if (!date) return DATE_FALLBACK;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRelativeTime(timestamp: Timestamp): string {
  const date = timestampToDate(timestamp);
  if (!date) return DATE_FALLBACK;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(timestamp);
}

/** `24:18` style clock for the practice timer. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Human duration such as `4m 12s` for session summaries. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds}s`;
  if (seconds === 0) return `${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(fractionDigits)}%`;
}

/** Score as a percentage of total, clamped to 0–100. */
export function scorePercent(score: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  const raw = (Number(score) / Number(total)) * 100;
  return Math.min(100, Math.max(0, raw));
}

export function formatCount(value: bigint): string {
  return value.toLocaleString();
}

/** Compact display for large counts, e.g. `1.2k`. */
export function formatCompactCount(value: bigint): string {
  const n = Number(value);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function truncate(text: string, max = 120): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Shorten a principal for display in the header. */
export function shortPrincipal(principal: string, head = 5, tail = 3): string {
  if (principal.length <= head + tail + 1) return principal;
  return `${principal.slice(0, head)}…${principal.slice(-tail)}`;
}
