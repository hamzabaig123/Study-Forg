import { stringifyWithBigints } from "@/lib/bigintJson";
import { archiveHeadline, readBrowserArchive } from "@/lib/browserArchive";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The reader behind "move data from this browser".
 *
 * Its whole job is to say, without loading the mock backend, whether this device
 * is holding study data that the account does not have yet — so a wrong answer
 * either hides the only path a user has into the database or offers to move
 * nothing. Both directions are tested here, against the exact key
 * `src/mocks/backend.ts` writes.
 */

const KEY = "studyforge.mock-backend.v1";

beforeEach(() => {
  window.localStorage.clear();
});

describe("readBrowserArchive", () => {
  it("returns nothing when this device never ran the app", () => {
    expect(readBrowserArchive()).toBeNull();
  });

  it("counts the rows the mock stored, tagged bigints and all", () => {
    window.localStorage.setItem(
      KEY,
      stringifyWithBigints({
        version: 1,
        nextId: 42n,
        classes: [{ id: 1n, name: "Class 11" }],
        subjects: [
          { id: 2n, name: "Physics" },
          { id: 3n, name: "Chemistry" },
        ],
        chapters: [],
        topics: [],
        questions: [{ id: 4n, prompt: "What is g?" }],
        notes: [],
        links: [],
        sessions: [],
        results: [],
        activity: [],
        exportedAt: "2026-09-01T10:00:00.000Z",
      }),
    );

    const archive = readBrowserArchive();
    expect(archive?.totals).toEqual({
      classes: 1,
      subjects: 2,
      chapters: 0,
      topics: 0,
      questions: 1,
      notes: 0,
      links: 0,
      sessions: 0,
      results: 0,
      activity: 0,
    });
    expect(archive?.exportedAt).toBe("2026-09-01T10:00:00.000Z");
    // The stored text goes to the importer untouched, ids included.
    expect(archive?.text).toContain("What is g?");
  });

  it("stays quiet about a store that holds only an id counter", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, nextId: 3 }));
    expect(readBrowserArchive()).toBeNull();
  });

  it("stays quiet about bytes it cannot read", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(readBrowserArchive()).toBeNull();
  });

  it("stays quiet about a store that is not an object", () => {
    window.localStorage.setItem(KEY, "[1,2,3]");
    expect(readBrowserArchive()).toBeNull();
  });
});

describe("archiveHeadline", () => {
  it("reads like a sentence, with the counts that matter first", () => {
    expect(
      archiveHeadline({
        classes: 1,
        subjects: 2,
        chapters: 3,
        topics: 4,
        questions: 10,
        notes: 1,
        links: 2,
        sessions: 3,
        results: 3,
        activity: 9,
      }),
    ).toBe("10 library entries, 10 questions, 1 note, 3 practice sessions");
  });
});
