/**
 * Installability: the service worker and the install prompt.
 *
 * The worker is registered only from a production build. On the dev server the
 * hashed asset names change on every save, so a cache-first worker serves a
 * bundle that no longer exists and the page appears to break on refresh — which
 * reads as an app bug and is not one.
 *
 * `beforeinstallprompt` is fired once by Chrome and then never again for that
 * visit, and Safari simply has no event at all, so the app keeps the deferred
 * event rather than asking for it later. That is why this is a small store with
 * a subscribe function instead of a hook-local `useState`: the event can arrive
 * before the component that shows the button has mounted.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Whether an "Install app" action would do anything right now. */
export function installState(): {
  available: boolean;
  installed: boolean;
} {
  return { available: deferredPrompt !== null, installed };
}

export function subscribeToInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resolves with the browser's own outcome, or null where there is no prompt. */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | null
> {
  if (!deferredPrompt) return null;
  const event = deferredPrompt;
  deferredPrompt = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  emit();
  return outcome;
}

export function registerPwa(): void {
  if (typeof window === "undefined") return;

  // Listening is free and harmless in every build; only the worker is gated
  // below, because a Chrome that has no worker never fires this event anyway.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installed = true;
    emit();
  });

  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => {
        // A blocked registration (private mode, an unsupported origin, a
        // network blip) costs the offline cache and nothing else; the app does
        // not depend on the worker to work.
      });
  });
}
