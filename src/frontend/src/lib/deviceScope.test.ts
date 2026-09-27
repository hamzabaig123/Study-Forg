/**
 * Which account a device-local cache belongs to.
 *
 * Three stores never leave the browser — the AI review queue, an unsaved note
 * draft, and the test-builder runs — and before this scoping any signed-in
 * account could read the previous one's. These tests pin the naming rule, the
 * claim that moves a pre-scoping cache into the first account's slot, and the
 * one store whose rows feed the dashboard: `localSessions` must hand a second
 * learner an empty history rather than the first one's accuracy and streak.
 */
import { SESSION_KEY } from "@/lib/localAuth";
import {
  createLocalSession,
  getLocalSession,
  listCompletedLocalSessions,
} from "@/lib/localSessions";
import { SessionMode } from "@/types";
import { beforeEach, describe, expect, it } from "vitest";

import {
  SHARED_SCOPE,
  adoptUnscoped,
  deviceScope,
  scopedKey,
} from "@/lib/deviceScope";

const BASE = "studyforge.custom-sessions.v1";

/**
 * Sign the browser in by writing the session record `lib/localAuth` owns.
 *
 * The real `loginAccount` runs PBKDF2 over 210 000 rounds, which is not what
 * this file is testing; the only thing a cache reads is the account id inside
 * this record.
 */
function signInAs(accountId: string): void {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ accountId, token: "test-token", createdAt: "now" }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("scopedKey", () => {
  it("leaves every cache name untouched while the browser holds no session", () => {
    expect(deviceScope()).toBe(SHARED_SCOPE);
    expect(scopedKey(BASE)).toBe(BASE);
  });

  it("puts the signed-in account's id at the end of the name", () => {
    signInAs("account-a");
    expect(scopedKey(BASE)).toBe(`${BASE}.account-a`);
  });

  it("gives two accounts different slots for the same cache", () => {
    signInAs("account-a");
    const first = scopedKey("studyforge.ai-studio.v2");
    signInAs("account-b");
    expect(scopedKey("studyforge.ai-studio.v2")).not.toBe(first);
  });
});

describe("adoptUnscoped", () => {
  it("moves an unclaimed cache into the account that reads it first", () => {
    window.localStorage.setItem(BASE, "the bytes");
    signInAs("account-a");

    expect(adoptUnscoped(BASE)).toBe("the bytes");
    expect(window.localStorage.getItem(`${BASE}.account-a`)).toBe("the bytes");
    expect(window.localStorage.getItem(BASE)).toBeNull();
  });

  it("does not hand the same bytes to the next account", () => {
    window.localStorage.setItem(BASE, "the bytes");
    signInAs("account-a");
    expect(adoptUnscoped(BASE)).toBe("the bytes");

    signInAs("account-b");
    expect(adoptUnscoped(BASE)).toBeNull();
  });

  it("answers with the bucket's own copy and leaves it in place", () => {
    signInAs("account-a");
    window.localStorage.setItem(`${BASE}.account-a`, "mine");
    window.localStorage.setItem(BASE, "the old shared copy");

    expect(adoptUnscoped(BASE)).toBe("mine");
    // The unscoped name only holds a claimable cache; once this account has its
    // own, a leftover copy is nobody's to move.
    expect(window.localStorage.getItem(BASE)).toBe("the old shared copy");
  });
});

describe("custom sessions per account", () => {
  function makeSession() {
    return createLocalSession({
      mode: SessionMode.practice,
      scopeLabel: "Biology",
      questions: [],
      durationSeconds: null,
    });
  }

  it("keeps one learner's runs out of the next one's history", () => {
    signInAs("account-a");
    const session = makeSession();
    expect(listCompletedLocalSessions()).toEqual([]);

    signInAs("account-b");
    expect(getLocalSession(session.id)).toBeNull();
    expect(listCompletedLocalSessions()).toEqual([]);

    signInAs("account-a");
    expect(getLocalSession(session.id)?.scopeLabel).toBe("Biology");
  });

  it("carries a history written before the scoping into the first account", () => {
    window.localStorage.setItem(
      BASE,
      JSON.stringify({ version: 1, sessions: [] }),
    );
    // A fresh id, not a reused one: `localSessions` keeps its parsed cache in
    // the module, and clearing storage between tests does not empty it. Reading
    // as an account it has already answered would test nothing about the claim.
    signInAs("account-legacy");
    expect(listCompletedLocalSessions()).toEqual([]);
    expect(
      window.localStorage.getItem(`${BASE}.account-legacy`),
    ).not.toBeNull();
    expect(window.localStorage.getItem(BASE)).toBeNull();
  });
});
