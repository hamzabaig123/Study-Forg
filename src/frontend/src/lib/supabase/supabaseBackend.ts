/**
 * The Supabase implementation of the canister interface.
 *
 * Six domain slices, composed into one object, and the composition is the check:
 * `satisfies backendInterface` fails the build if a method is missing or answers
 * with the wrong variant, which is the same proof the mock gets from its own
 * trailing clause. That matters more here than it did there — the mock was
 * written against the same 2,300 lines it implements, whereas this adapter is
 * roughly a thousand lines of mapping laid over a schema that cannot be
 * exercised on the machine it is edited on. The type is the test that always
 * runs.
 *
 * Nothing about the database is reachable outside `transport.ts`, so a unit test
 * hands this function a recorder instead of a client and every slice below is
 * exercised without a Postgres in the loop.
 */
import type { backendInterface } from "@/backend";
import { getSupabase } from "./client";
import { attachSessionStore } from "./session";
import { createContentSlice } from "./slices/content";
import { createLibrarySlice } from "./slices/library";
import { createLinksSlice } from "./slices/links";
import { createPracticeSlice } from "./slices/practice";
import { createSharingSlice } from "./slices/sharing";
import { createSystemSlice } from "./slices/system";
import { type SupabaseTransport, defaultTransport } from "./transport";

/**
 * Build an adapter over a given transport.
 *
 * A parameter rather than a module singleton because the whole point of the seam
 * is to be replaced: `createSupabaseBackend(fakeTransport)` drives every method
 * from a unit test, while the exported `supabaseBackend` below is the app's one
 * instance over the real client.
 */
export function createSupabaseBackend(
  transport: SupabaseTransport = defaultTransport(),
): backendInterface {
  return {
    ...createContentSlice(transport),
    ...createPracticeSlice(transport),
    ...createLibrarySlice(transport),
    ...createSharingSlice(transport),
    ...createLinksSlice(transport),
    ...createSystemSlice(transport),
    // The canister's hot-path indexes are Motoko state a legacy upgrade might
    // have to rebuild; Postgres answers the same reads with real table
    // indexes, so there is nothing for this adapter to rebuild.
    async rebuildIndexes() {},
  } satisfies backendInterface;
}

let instance: backendInterface | null = null;

/**
 * The app's Supabase backend, and the entry point `useBackend` calls.
 *
 * The session is attached and restored before the adapter is handed over, and not
 * as a courtesy: every row is filtered by `auth.uid()`, so a query that leaves
 * while supabase-js is still reading the stored token goes out as `anon`, comes
 * back empty, and is then cached as though that were the account's data — a reload
 * of a perfectly good account looks like one that lost everything. Living behind
 * this module also keeps `@supabase/supabase-js` out of the bundle an app on the
 * mock or the canister loads.
 */
export async function supabaseBackend(): Promise<backendInterface> {
  const store = attachSessionStore(getSupabase());
  await store.restore();
  instance ??= createSupabaseBackend();
  return instance;
}
