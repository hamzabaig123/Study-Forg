/**
 * What "Clear local data" is allowed to erase.
 *
 * The label on that button is a promise about scope: it takes the device's
 * caches — provider keys, the review queue, reminder settings, note drafts — and
 * leaves account content alone. Two stores now hold cache values, because a
 * provider key kept "for this tab only" lives in `sessionStorage`, so the
 * promise needs proving against both.
 */
import { clearDeviceCache } from "@/lib/deviceCache";
import { beforeEach, describe, expect, it } from "vitest";

const CACHED = [
  ["localStorage", "studyforge-theme"],
  ["localStorage", "studyforge.ai.gemini_key"],
  ["sessionStorage", "studyforge.ai.gemini_key"],
  ["localStorage", "studyforge.reminders.v1"],
  ["localStorage", "studyforge.ai-studio.queue.v1"],
  ["sessionStorage", "studyforge.note-draft.7"],
] as const;

const ACCOUNT_CONTENT = [
  ["localStorage", "studyforge.mock-backend.v1"],
  ["localStorage", "studyforge.auth"],
  ["localStorage", "studyforge.custom-sessions.v1"],
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
