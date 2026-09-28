/**
 * Local-storage health.
 *
 * A failing `setItem` is normally invisible: the write throws, the caller
 * swallows it, and the app keeps promising to remember things it is not
 * remembering. Every guarded write in the app funnels through here so the
 * first failure becomes something the user can see and act on.
 */

export type StorageProblemKind = "quota" | "blocked" | "corrupt";

export interface StorageProblem {
  kind: StorageProblemKind;
  message: string;
}

const COPY: Record<StorageProblemKind, string> = {
  quota:
    "This browser's storage is full, so new changes are not being saved. Export a backup, then delete what you no longer need and try again.",
  blocked:
    "This browser is blocking local storage, so changes cannot be saved. Private windows and site-data blockers do this.",
  corrupt:
    "The saved study data could not be read, so the app opened with an empty library. The unreadable copy was kept on this device.",
};

let snapshot: readonly StorageProblem[] = [];
const listeners = new Set<() => void>();

function remember(kind: StorageProblemKind, message?: string): void {
  const next = snapshot.filter((problem) => problem.kind !== kind);
  next.push({ kind, message: message ?? COPY[kind] });
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
}

export function getStorageProblems(): readonly StorageProblem[] {
  return snapshot;
}

export function subscribeStorageHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function classify(cause: unknown): StorageProblemKind {
  const name = cause instanceof Error ? cause.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return "quota";
  }
  return "blocked";
}

/** Returns whether the value actually landed in storage. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (cause) {
    remember(classify(cause));
    return false;
  }
}

/** Returns whether the key really went away — a blocked store reports false. */
export function safeRemoveItem(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (cause) {
    remember(classify(cause));
    return false;
  }
}

/** Reading can throw too: a restricted frame or a private Safari tab. */
export function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function reportStorageProblem(
  kind: StorageProblemKind,
  message?: string,
): void {
  remember(kind, message);
}
