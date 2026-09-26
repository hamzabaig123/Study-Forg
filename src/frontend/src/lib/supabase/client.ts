import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_CONFIGURED,
  SUPABASE_PROBLEM,
  SUPABASE_URL,
} from "./env";

/**
 * The one Supabase client.
 *
 * Created lazily and memoised: `useBackend` resolves the actor during the first
 * render, and building a client costs a fetch of nothing but is still work worth
 * doing once. With no project configured the app keeps running on the mock or
 * the canister, so merely importing this module must not throw — only asking for
 * a client that cannot exist does.
 */
let client: SupabaseClient | null = null;

export const supabaseAvailable = SUPABASE_CONFIGURED;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_CONFIGURED) {
    throw new Error(
      SUPABASE_PROBLEM ??
        "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then point VITE_DATA_BACKEND at supabase.",
    );
  }
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // supabase-js owns the session and rotates the refresh token; the app's
      // own localStorage session record is gone once this path is live.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "studyforge.auth",
    },
    // PostgREST responses are plain JSON; without this a long dashboard query
    // has no ceiling at all.
    global: { headers: { "x-client-info": "studyforge-web" } },
  });
  return client;
}

/** PostgREST errors carry a code worth keeping; callers surface the message. */
export class SupabaseError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SupabaseError";
    this.code = code;
  }
}

export function unwrap<T>(result: {
  data: T | null;
  error: { message: string; code?: string } | null;
}): T {
  if (result.error) {
    throw new SupabaseError(
      result.error.message,
      result.error.code ?? "unknown",
    );
  }
  return result.data as T;
}
