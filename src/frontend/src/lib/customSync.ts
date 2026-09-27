import { DATA_BACKEND } from "@/lib/authMode";
import type { LocalSession } from "@/lib/localSessions";
/**
 * Server mirror for finished test-builder runs.
 *
 * Test-builder sessions are assembled and graded in the browser, so a finished
 * run lives in the device's `custom-sessions` store — which also means it lives
 * and dies with one browser. On the Supabase backend every finished run is
 * additionally upserted into the `custom_session` table (same id, so a retry is
 * idempotent), and progress reads merge the account's server rows with the
 * device's, deduplicated by id. On the mock and the canister the module is a
 * no-op and progress is exactly what it was before.
 */
import { SUPABASE_CONFIGURED } from "@/lib/supabase/env";

export function isCustomSyncEnabled(): boolean {
  return DATA_BACKEND === "supabase" && SUPABASE_CONFIGURED;
}

interface CustomSessionRow {
  id: string;
  mode: LocalSession["mode"];
  scope_label: string;
  duration_seconds: number | null;
  started_at: string;
  completed_at: string;
  score: number;
  total: number;
  results: LocalSession["results"];
}

/** Fire-and-forget mirror of one finished run. Never throws. */
export async function syncCustomSession(session: LocalSession): Promise<void> {
  if (!isCustomSyncEnabled() || session.status !== "completed") return;
  try {
    // Dynamic import on purpose: `client.ts` pulls in supabase-js, and this
    // module is reachable from the dashboard and analytics on every backend —
    // a static import would drag the client library into the mock and canister
    // bundles, undoing the lazy seam `useBackend` builds.
    const { getSupabase } = await import("@/lib/supabase/client");
    const { error } = await getSupabase()
      .from("custom_session")
      .upsert(
        {
          id: session.id,
          mode: session.mode,
          scope_label: session.scopeLabel,
          duration_seconds: session.durationSeconds,
          started_at: new Date(session.startedAtMs).toISOString(),
          completed_at: new Date(
            session.completedAtMs ?? session.startedAtMs,
          ).toISOString(),
          score: session.score,
          total: session.total,
          results: session.results,
        },
        { onConflict: "id" },
      );
    if (error) throw error;
  } catch (cause) {
    // The device copy is already durable; the mirror is an enhancement, and a
    // failed mirror must never disrupt the results screen the learner is on.
    console.warn("custom session sync failed:", cause);
  }
}

/** The account's server-mirrored runs, newest first. [] when not on Supabase. */
export async function fetchServerCustomSessions(): Promise<LocalSession[]> {
  if (!isCustomSyncEnabled()) return [];
  const { getSupabase } = await import("@/lib/supabase/client");
  const { data, error } = await getSupabase()
    .from("custom_session")
    .select(
      "id, mode, scope_label, duration_seconds, started_at, completed_at, score, total, results",
    )
    .order("completed_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data as CustomSessionRow[]).map((row) => ({
    id: row.id,
    mode: row.mode,
    scopeLabel: row.scope_label,
    // The mirrored copy keeps the full per-question results but not the
    // assembled question papers; re-running a mirrored test is a fresh build.
    questions: [],
    answers: {},
    startedAtMs: Date.parse(row.started_at),
    durationSeconds: row.duration_seconds,
    status: "completed" as const,
    completedAtMs: Date.parse(row.completed_at),
    results: row.results,
    score: row.score,
    total: row.total,
  }));
}

/**
 * One list per id: the device's own copy wins where both exist (it carries the
 * assembled questions), the server supplies everything this browser has never
 * seen. Pure so the merge can be tested without a client.
 */
export function mergeCustomSessions(
  local: readonly LocalSession[],
  server: readonly LocalSession[],
): LocalSession[] {
  const byId = new Map<string, LocalSession>();
  for (const session of server) byId.set(session.id, session);
  for (const session of local) byId.set(session.id, session);
  return [...byId.values()].sort(
    (a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0),
  );
}
