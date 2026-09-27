/**
 * What "Clear local data" is allowed to erase.
 *
 * The label on that button is a promise about scope: it takes the device's
 * caches — provider keys, the review queue, reminder settings, note drafts — and
 * leaves account content alone. Two stores now hold cache values, because a
 * provider key kept "for this tab only" lives in `sessionStorage`, so the
 * promise needs proving against both.
 */
import { keyPersistence, saveKey } from "@/lib/ai/providers";
import { clearDeviceCache } from "@/lib/deviceCache";
import { beforeEach, describe, expect, it } from "vitest";

const CACHED = [
  ["localStorage", "studyforge-theme"],
  ["localStorage", "studyforge.ai.gemini_key"],
  ["sessionStorage", "studyforge.ai.gemini_key"],
  ["localStorage", "studyforge.reminders.v1"],
  ["localStorage", "studyforge.ai-studio.queue.v1"],
  ["sessionStorage", "studyforge.note-draft.7"],
  // The same two caches inside an account's own slot (`lib/deviceScope`).
  ["localStorage", "studyforge.ai-studio.v2.test-account"],
  ["localStorage", "studyforge.note-draft.7.test-account"],
] as const;

const ACCOUNT_CONTENT = [
  ["localStorage", "studyforge.mock-backend.v1"],
  ["localStorage", "studyforge.auth"],
  ["localStorage", "studyforge.custom-sessions.v1"],
  // A scoped history is still account content: the id only stops two learners
  // reading each other's runs, it does not make the runs a cache.
  ["localStorage", "studyforge.custom-sessions.v1.test-account"],
] as const;

function store(name: "localStorage" | "sessionStorage"): Storage {
  return name === "localStorage" ? window.localStorage : window.sessionStorage;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  for (const [name, key] of CACHED) store(name).setItem(key, "cached value");
  for (const [name, key] of ACCOUNT_CONTENT)
    store(name).setItem(key, "account value");
});

describe("clearDeviceCache", () => {
  it("erases every listed cache key from the store that holds it", () => {
    clearDeviceCache();
    for (const [name, key] of CACHED) {
      expect(store(name).getItem(key), `${name}:${key}`).toBeNull();
    }
  });

  it("erases an account-content key from neither store", () => {
    clearDeviceCache();
    for (const [name, key] of ACCOUNT_CONTENT) {
      expect(store(name).getItem(key), `${name}:${key}`).toBe("account value");
    }
  });

  it("keeps the unlisted keys of both stores, so clearing is not a format change", () => {
    window.localStorage.setItem("studyforge.something-else", "keep");
    window.sessionStorage.setItem("studyforge.session-something-else", "keep");
    clearDeviceCache();
    expect(window.localStorage.getItem("studyforge.something-else")).toBe(
      "keep",
    );
    expect(
      window.sessionStorage.getItem("studyforge.session-something-else"),
    ).toBe("keep");
  });
});

/**
 * Which store a provider key is allowed to sit in.
 *
 * "Clear local data" and the key dialog's "Keep on this device" tick are promises
 * about the same value, and the default is the tab: a key nobody opted in has to
 * be gone when the tab closes, and it still has to be gone when they press
 * clear. So the store is checked where the clearing is checked.
 */
describe("provider key stores", () => {
  it("keeps a key in sessionStorage while the device store was refused", () => {
    expect(saveKey("gemini", "session-only-key", false)).toBe("session");
    expect(window.sessionStorage.getItem("studyforge.ai.gemini_key")).toBe(
      "session-only-key",
    );
    expect(window.localStorage.getItem("studyforge.ai.gemini_key")).toBeNull();
    expect(keyPersistence("gemini")).toBe("session");
  });

  it("writes to localStorage only when the reviewer asked it to stay", () => {
    expect(saveKey("gemini", "kept-on-device", true)).toBe("device");
    expect(window.localStorage.getItem("studyforge.ai.gemini_key")).toBe(
      "kept-on-device",
    );
    // The tab copy goes with it, or a replaced key would still answer from the
    // other store — `readKey` prefers the session one.
    expect(
      window.sessionStorage.getItem("studyforge.ai.gemini_key"),
    ).toBeNull();
    expect(keyPersistence("gemini")).toBe("device");
  });

  it("erases either kind from the store that holds it", () => {
    saveKey("gemini", "session-only-key", false);
    saveKey("openRouter", "kept-on-device", true);

    clearDeviceCache();

    expect(
      window.sessionStorage.getItem("studyforge.ai.gemini_key"),
    ).toBeNull();
    expect(window.localStorage.getItem("studyforge.ai.gemini_key")).toBeNull();
    expect(
      window.sessionStorage.getItem("studyforge.ai.openrouter_key"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("studyforge.ai.openrouter_key"),
    ).toBeNull();
    expect(keyPersistence("gemini")).toBe("none");
    expect(keyPersistence("openRouter")).toBe("none");
  });
});
