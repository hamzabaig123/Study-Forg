/**
 * The install store.
 *
 * `beforeinstallprompt` fires once and is gone, so the only way the Settings row
 * can be right is by keeping the event outside the component. These tests drive
 * the events a browser would fire; they cannot make Chrome actually offer an
 * install, which needs a deployed HTTPS page with a worker.
 */
import {
  installState,
  promptInstall,
  registerPwa,
  subscribeToInstall,
} from "@/lib/pwa";
import { beforeEach, describe, expect, it, vi } from "vitest";

type PromptEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function fireInstallPrompt(outcome: "accepted" | "dismissed"): PromptEvent {
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as unknown as PromptEvent;
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  window.dispatchEvent(event);
  return event;
}

describe("the install store", () => {
  beforeEach(() => {
    registerPwa();
  });

  it("offers nothing before the browser has asked", () => {
    expect(installState()).toEqual({ available: false, installed: false });
  });

  it("keeps a prompt that arrives before any component mounts", async () => {
    const event = new Event("beforeinstallprompt", {
      cancelable: true,
    }) as unknown as PromptEvent;
    event.prompt = vi.fn(async () => {});
    event.userChoice = Promise.resolve({ outcome: "accepted" as const });
    window.dispatchEvent(event);

    expect(installState().available).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    const outcome = await promptInstall();
    expect(outcome).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    // A consumed prompt cannot be spent twice.
    expect(installState().available).toBe(false);
    expect(await promptInstall()).toBeNull();
  });

  it("tells a subscriber when the answer changes", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToInstall(listener);
    fireInstallPrompt("dismissed");
    await promptInstall();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("records an install the browser announced itself", () => {
    window.dispatchEvent(new Event("appinstalled"));
    expect(installState().installed).toBe(true);
  });

  it("does not register a worker where the bundle is not built for one", () => {
    const register = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });
    registerPwa();
    window.dispatchEvent(new Event("load"));
    // `import.meta.env.PROD` is false under vitest, which is the whole guard:
    // a caching worker on the dev server serves assets that no longer exist.
    expect(register).not.toHaveBeenCalled();
  });
});
