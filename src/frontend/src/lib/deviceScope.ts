/**
 * Which account a device-local cache belongs to.
 *
 * Three stores are deliberately outside the database: the AI review queue, an
 * unsaved note draft, and the test-builder runs. They are per-device by design,
 * but "per device" stood in for "per account" only for as long as one account
 * ever used the browser. On a shared laptop the second sign-in could read the
 * first one's drafts, and the custom-session history feeds the dashboard's
 * accuracy and streak — so it was not clutter being shown to a stranger, it was
 * that learner's record.
 *
 * The bucket is resolved from whichever session this mode holds, and resolved
 * *per call* rather than at module load: `main.tsx` restores the Supabase
 * session before it mounts the app, and a module that answered at import time
 * would run before that and pin every cache to the signed-out bucket.
 */
import { USE_SUPABASE } from "@/lib/authMode";
import { CHANGE_EVENT, getSessionSnapshot } from "@/lib/localAuth";
import { sessionStore } from "@/lib/supabase/session";

/** The bucket a signed-out browser — and the Internet Identity mode — uses. */
export const SHARED_SCOPE = "device";

/**
 * The signed-in account's id, or null.
 *
 * The canister mode is not scoped: its session is an Internet Identity principal
 * that is still being restored while these stores are first read, so there is no
 * synchronous answer to give. Its account content lives in the canister anyway,
 * and the caches named here are all in "Clear local data".
 */
function sessionId(): string | null {
  if (USE_SUPABASE) {
    try {
      return sessionStore().account()?.id ?? null;
    } catch {
      // The store is attached by `supabaseBackend()`. A read that arrives
      // before it has is the same as a signed-out browser.
      return null;
    }
  }
  try {
    const parsed = JSON.parse(getSessionSnapshot()) as { accountId?: unknown };
    return typeof parsed?.accountId === "string" ? parsed.accountId : null;
  } catch {
    return null;
  }
}

/** The current bucket, as the segment that goes into a storage key. */
export function deviceScope(): string {
  return sessionId() ?? SHARED_SCOPE;
}

/**
 * The key for this account's copy of a cache.
 *
 * A signed-out browser gets the name the cache has always had, so nothing moves
 * until an account actually claims it.
 */
export function scopedKey(base: string): string {
  const id = sessionId();
  return id === null ? base : `${base}.${id}`;
}

/**
 * Claim a cache written before this scoping existed.
 *
 * The unscoped key is the only copy, so the first account to read it takes it
 * over — moving rather than copying, which is what keeps the next account from
 * being handed the same rows. Returns the bytes to parse, or null when there is
 * nothing for this bucket.
 */
export function adoptUnscoped(base: string): string | null {
  const scoped = scopedKey(base);
  try {
    const own = window.localStorage.getItem(scoped);
    if (own !== null) return own;
    if (scoped === base) return null;
    const legacy = window.localStorage.getItem(base);
    if (legacy === null) return null;
    window.localStorage.setItem(scoped, legacy);
    window.localStorage.removeItem(base);
    return legacy;
  } catch {
    // A store that refuses the move still hands over what it holds: an account
    // reading the unclaimed cache beats a queue nobody can find again.
    return window.localStorage.getItem(base);
  }
}

/* -------------------------------------------------------------------------- */
/* Watching the bucket                                                         */
/* -------------------------------------------------------------------------- */

const watchers = new Set<(scope: string) => void>();
let tracked: string | null = null;
let sourcesAttached = false;

function rescan(): void {
  const next = deviceScope();
  if (next === tracked) return;
  tracked = next;
  for (const listener of watchers) listener(next);
}

/**
 * Tell a cache that the account behind it may have moved.
 *
 * The listener only fires when the bucket actually changed, so a store never
 * has to guess whether there is anything to re-read. The three sources are how
 * each session says so: a local account dispatches an event, the Supabase
 * client raises its own auth event, and another tab's write arrives here as a
 * `storage` event.
 */
export function watchDeviceScope(
  listener: (scope: string) => void,
): () => void {
  watchers.add(listener);
  tracked ??= deviceScope();
  if (!sourcesAttached) {
    sourcesAttached = true;
    window.addEventListener(CHANGE_EVENT, rescan);
    window.addEventListener("storage", rescan);
    attachSupabaseSession();
  }
  return () => watchers.delete(listener);
}

/**
 * Listen to the Supabase session, if there is one to listen to.
 *
 * `supabaseBackend()` attaches the store while the actor is being resolved, so
 * a cache imported after that gets the auth event. Imported before it there is
 * nothing to subscribe to — and that gap cannot be reached from a page, because
 * `main.tsx` mounts only once the actor has resolved.
 */
function attachSupabaseSession(): void {
  if (!USE_SUPABASE) return;
  try {
    sessionStore().subscribe(rescan);
  } catch {
    // The `storage` listener above still sees the session this browser writes.
  }
}
