/**
 * The Supabase side of the test history: one list of every finished test and a
 * way back into each, both answered by Postgres (migration 0016).
 *
 * Reached only through a dynamic import from `lib/testHistory.ts`, so the mock
 * and canister bundles never load supabase-js. All three functions run as the
 * caller, so RLS — not an argument — decides whose tests come back.
 */
import { getSupabase } from "@/lib/supabase/client";
import type { TestKind } from "@/lib/testHistory";

/** Every finished test the account has, newest first, as stored JSON. */
export async function fetchServerTestHistory(): Promise<unknown[]> {
  const { data, error } = await getSupabase().rpc("test_history");
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

/** One test with every question in order, or null when it is not the caller's. */
export async function fetchServerTestAttempt(
  kind: TestKind,
  id: string,
): Promise<unknown | null> {
  const { data, error } = await getSupabase().rpc("test_history_detail", {
    p_kind: kind,
    p_id: id,
  });
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** True when a row was removed; false when there was nothing of the caller's. */
export async function deleteServerTestAttempt(
  kind: TestKind,
  id: string,
): Promise<boolean> {
  const { data, error } = await getSupabase().rpc("delete_test_attempt", {
    p_kind: kind,
    p_id: id,
  });
  if (error) throw new Error(error.message);
  return data === true;
}
