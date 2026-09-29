import type { backendInterface } from "@/backend";
import { QuestionType } from "@/backend";
import {
  ArchiveFormatError,
  importArchive,
  parseArchive,
} from "@/lib/archiveImport";
import { stringifyWithBigints } from "@/lib/bigintJson";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The archive importer, run against the localStorage mock.
 *
 * The mock is the test double that costs nothing to keep honest: it implements
 * the same 77 methods the Supabase adapter does, so an import that lands rows in
 * it and reports the right counts is evidence about the importer rather than
 * about a stub's idea of what a backend returns. Every row is read back through
 * the ordinary list methods afterwards.
 */

type MockBackend = typeof import("@/mocks/backend").mockBackend;

let target: MockBackend;

beforeEach(async () => {
  window.localStorage.clear();
  vi.resetModules();
  target = (await import("@/mocks/backend")).mockBackend;
});

const MCQ = {
  __kind__: "multipleChoice" as const,
  multipleChoice: {
    correctOptionId: 2n,
    options: [
      { id: 1n, text: "9.8 m/s" },
      { id: 2n, text: "9.8 m/s^2" },
    ],
  },
};

/** A two-level archive: one class down to two questions, plus history. */
function archive(overrides: Record<string, unknown> = {}) {
  return {
    exportedAt: "2026-09-01T10:00:00.000Z",
    classes: [{ id: 1n, name: "Class 11", description: "Physics" }],
    subjects: [{ id: 2n, name: "Physics", classId: 1n, description: null }],
    chapters: [{ id: 3n, name: "Kinematics", subjectId: 2n }],
    topics: [{ id: 4n, name: "Uniform Acceleration", chapterId: 3n }],
    questions: [
      {
        id: 5n,
        topicId: 4n,
        prompt: "What is g?",
        questionType: QuestionType.multipleChoice,
        answer: MCQ,
        explanation: "Near the surface.",
      },
      {
        id: 6n,
        topicId: 4n,
        prompt: "v = u + at?",
        questionType: QuestionType.trueFalse,
        answer: { __kind__: "trueFalse", trueFalse: { correct: true } },
      },
    ],
    notes: [
      {
        id: 7n,
        title: "Session 3 recap",
        subjectLabel: "Physics",
        documentJson: JSON.stringify({ blocks: [] }),
        searchText: "recap",
        status: "trashed",
      },
    ],
    links: [{ id: 8n, code: "abc123", targetUrl: "https://example.com/ch" }],
    settings: {
      displayName: "Grace",
      studyGoal: "Pass the board exam",
      dailyTarget: 25n,
      appearance: "dark",
    },
    shares: [{ token: "secret", scope: { kind: "topic", id: 4n } }],
    noteShares: [{ token: "secret", noteId: 7n }],
    sessions: [{ id: 9n }, { id: 10n }],
    results: [{ id: 11n }],
    activity: [{ at: 1n, title: "x", kind: "question" }],
    ...overrides,
  };
}

function textOf(doc: unknown): string {
  return stringifyWithBigints(doc);
}

function asBackend(): backendInterface {
  return target as unknown as backendInterface;
}

describe("parseArchive", () => {
  it("reads back the document an export writes", () => {
    const doc = parseArchive(textOf(archive()));
    expect(doc.exportedAt).toBe("2026-09-01T10:00:00.000Z");
    expect(doc.classes).toHaveLength(1);
    expect(doc.questions).toHaveLength(2);
    expect(doc.settings?.dailyTarget).toBe(25n);
  });

  it("accepts a document whose ids are numbers, as the mock stores them", () => {
    const doc = parseArchive(
      JSON.stringify({ classes: [{ id: 1, name: "Class 11" }], questions: [] }),
    );
    expect(doc.classes[0]?.id).toBe(1);
  });

  it("refuses text that is not JSON at all", () => {
    expect(() => parseArchive("not a file")).toThrow(ArchiveFormatError);
  });

  it("refuses JSON that is not an export", () => {
    expect(() => parseArchive('{"todos":[1,2]}')).toThrow(
      /No study data found/u,
    );
    expect(() => parseArchive("[1,2,3]")).toThrow(ArchiveFormatError);
  });

  it("accepts an empty archive, which is the one import with nothing to undo", () => {
    expect(() => parseArchive('{"classes":[]}')).not.toThrow();
  });
});

describe("importArchive", () => {
  it("rebuilds the hierarchy under ids the target minted", async () => {
    const report = await importArchive(
      asBackend(),
      parseArchive(textOf(archive())),
    );

    const classes = await target.listClasses();
    expect(classes.map((item) => item.name)).toEqual(["Class 11"]);
    const subject = await target.listSubjects(classes[0]?.id ?? 0n);
    expect(subject.map((item) => item.name)).toEqual(["Physics"]);
    const chapter = await target.listChapters(subject[0]?.id ?? 0n);
    expect(chapter.map((item) => item.name)).toEqual(["Kinematics"]);
    const topic = await target.listTopics(chapter[0]?.id ?? 0n);
    expect(topic.map((item) => item.name)).toEqual(["Uniform Acceleration"]);
    const questions = await target.listQuestions(topic[0]?.id ?? 0n);
    expect(questions.map((item) => item.prompt)).toEqual([
      "What is g?",
      "v = u + at?",
    ]);
    expect(report.created).toMatchObject({
      classes: 1,
      subjects: 1,
      chapters: 1,
      topics: 1,
      questions: 2,
      notes: 1,
      links: 1,
      settings: 1,
    });
    expect(report.failures).toEqual([]);
  });

  it("keeps a multiple-choice answer pointed at the same option", async () => {
    await importArchive(asBackend(), parseArchive(textOf(archive())));
    const [klass] = await target.listClasses();
    const [subject] = await target.listSubjects(klass?.id ?? 0n);
    const [chapter] = await target.listChapters(subject?.id ?? 0n);
    const [topic] = await target.listTopics(chapter?.id ?? 0n);
    const [question] = await target.listQuestions(topic?.id ?? 0n);
    const answer = question?.answer;
    expect(answer?.__kind__).toBe("multipleChoice");
    if (answer?.__kind__ !== "multipleChoice") return;
    expect(answer.multipleChoice.options.map((option) => option.text)).toEqual([
      "9.8 m/s",
      "9.8 m/s^2",
    ]);
    const correct = answer.multipleChoice.options.find(
      (option) => option.id === answer.multipleChoice.correctOptionId,
    );
    expect(correct?.text).toBe("9.8 m/s^2");
  });

  it("adds nothing twice, except a link — which the contract cannot list", async () => {
    const doc = parseArchive(textOf(archive()));
    await importArchive(asBackend(), doc);
    const again = await importArchive(asBackend(), doc);

    expect(again.created).toEqual({
      classes: 0,
      subjects: 0,
      chapters: 0,
      topics: 0,
      questions: 0,
      notes: 0,
      // Links are addressed by their secret edit token and an export never
      // carries that, so nothing can say "this URL is already published".
      links: 1,
      settings: 0,
    });
    expect(again.skipped).toMatchObject({
      classes: 1,
      subjects: 1,
      chapters: 1,
      topics: 1,
      questions: 2,
      notes: 1,
      settings: 1,
    });
    expect(await target.listClasses()).toHaveLength(1);
  });

  it("finishes the import after a row whose parent is missing", async () => {
    const doc = parseArchive(
      textOf(
        archive({
          subjects: [
            { id: 2n, name: "Physics", classId: 1n },
            { id: 21n, name: "Chemistry", classId: 99n },
          ],
        }),
      ),
    );
    const report = await importArchive(asBackend(), doc);

    expect(report.failures).toEqual([
      {
        entity: "subjects",
        label: "Chemistry",
        reason: "Its class is not in this archive.",
      },
    ]);
    expect(report.created.subjects).toBe(1);
    expect(report.created.chapters).toBe(1);
  });

  it("names the history it left out instead of dating it today", async () => {
    const report = await importArchive(
      asBackend(),
      parseArchive(textOf(archive())),
    );
    expect(report.notRestored).toEqual({
      sessions: 2,
      results: 1,
      activity: 1,
      shares: 1,
      noteShares: 1,
    });
    expect(await target.getAttemptHistory()).toEqual([]);
  });

  it("carries the profile over, and leaves it alone once it matches", async () => {
    const doc = parseArchive(textOf(archive()));
    await importArchive(asBackend(), doc);
    const settings = await target.getMySettings();
    expect(settings).toMatchObject({
      displayName: "Grace",
      dailyTarget: 25n,
      appearance: "dark",
    });

    const again = await importArchive(asBackend(), doc);
    expect(again.skipped.settings).toBe(1);
    expect(again.created.settings).toBe(0);
  });

  it("reports a row the backend refused and keeps going", async () => {
    const broken = {
      ...asBackend(),
      createQuestion: async () => {
        throw new Error("quota exhausted");
      },
    };
    const report = await importArchive(broken, parseArchive(textOf(archive())));

    expect(report.created.questions).toBe(0);
    expect(
      report.failures.filter((item) => item.entity === "questions"),
    ).toHaveLength(2);
    expect(report.failures[0]?.reason).toBe("quota exhausted");
    expect(report.created.notes).toBe(1);
    expect(report.created.links).toBe(1);
  });

  it("gives every imported link a fresh code rather than the archived one", async () => {
    const report = await importArchive(
      asBackend(),
      parseArchive(textOf(archive())),
    );
    expect(report.created.links).toBe(1);
    const created = await target.createLink("https://example.com/ch");
    expect(created.__kind__).toBe("ok");
    expect(report.failures).toEqual([]);
  });

  it("counts progress for every row it was given", async () => {
    const seen: Array<[number, number]> = [];
    await importArchive(
      asBackend(),
      parseArchive(textOf(archive())),
      (done, total) => seen.push([done, total]),
    );
    const total = seen.at(-1)?.[1] ?? 0;
    expect(seen.at(-1)?.[0]).toBe(total);
    expect(total).toBe(1 + 1 + 1 + 1 + 2 + 1 + 1 + 1 /* settings */);
  });
});

/**
 * The bounds `archiveImport.ts` keeps to itself, restated here as literals on
 * purpose: raising one without touching the tests should be a red suite, not a
 * quiet agreement between two copies of the same number.
 */
const MAX_ROWS = 5000;
const MAX_CHARS = 50_000;

/** `levels` wrappers of `{ x: … }` around a string leaf. */
function nested(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: "deep" };
  for (let index = 0; index < levels; index += 1) {
    node = { x: node };
  }
  return node;
}

describe("size bounds", () => {
  it("fails an over-long row instead of writing half of it", async () => {
    const doc = parseArchive(
      textOf(
        archive({
          notes: [
            {
              id: 7n,
              title: "Session 3 recap",
              documentJson: "x".repeat(MAX_CHARS + 1),
            },
          ],
        }),
      ),
    );
    const report = await importArchive(asBackend(), doc);

    expect(report.created.notes).toBe(0);
    expect(
      report.failures.filter((item) => item.entity === "notes"),
    ).toMatchObject([{ label: "Session 3 recap" }]);
    expect(report.failures[0]?.reason).toMatch(
      new RegExp(`${MAX_CHARS + 1} characters long.*at most ${MAX_CHARS}`, "u"),
    );
    // The rejected row is the only note in the archive, so nothing landed.
    expect(await target.listNotes(null)).toHaveLength(0);
  });

  it("leaves a row one character under the bar alone", async () => {
    const doc = parseArchive(
      textOf(
        archive({
          notes: [
            {
              id: 7n,
              title: "Fits",
              documentJson: "x".repeat(MAX_CHARS),
            },
          ],
        }),
      ),
    );
    const report = await importArchive(asBackend(), doc);

    expect(report.failures).toEqual([]);
    expect(report.created.notes).toBe(1);
  });

  it("refuses a tree the note editor would overflow the tab on", async () => {
    // Depth is counted to the node, so the seventh wrapper is the one that
    // sits at the limit — and a guard that recursed would die before it got
    // as far as saying no.
    const tooDeep = parseArchive(
      textOf(
        archive({
          notes: [
            {
              id: 7n,
              title: "Deep",
              documentJson: JSON.stringify({ blocks: [] }),
              meta: nested(7),
            },
          ],
        }),
      ),
    );
    const refused = await importArchive(asBackend(), tooDeep);
    expect(refused.created.notes).toBe(0);
    expect(refused.failures[0]?.reason).toMatch(/nested deeper than 8 levels/u);

    const oneLevelShallower = parseArchive(
      textOf(
        archive({
          notes: [
            {
              id: 7n,
              title: "Shallow",
              documentJson: JSON.stringify({ blocks: [] }),
              meta: nested(6),
            },
          ],
        }),
      ),
    );
    const admitted = await importArchive(asBackend(), oneLevelShallower);
    expect(admitted.failures).toEqual([]);
    expect(admitted.created.notes).toBe(1);
  });

  it("refuses a collection it cannot finish replaying", () => {
    const many = Array.from(
      { length: MAX_ROWS + 1 },
      (_, index): Record<string, unknown> => ({
        id: BigInt(100 + index),
        topicId: 4n,
        prompt: `Question ${index}`,
        questionType: QuestionType.trueFalse,
        answer: { __kind__: "trueFalse", trueFalse: { correct: true } },
      }),
    );

    expect(() => parseArchive(textOf(archive({ questions: many })))).toThrow(
      /"questions" lists 5001 rows.*at most 5000/u,
    );
    // The boundary itself is importable: a file at the cap is not a format error.
    expect(() =>
      parseArchive(textOf(archive({ questions: many.slice(0, MAX_ROWS) }))),
    ).not.toThrow();
  });

  it("refuses an over-long profile field rather than storing it", async () => {
    const doc = parseArchive(
      textOf(
        archive({
          settings: {
            displayName: "Grace",
            studyGoal: "y".repeat(MAX_CHARS + 1),
            dailyTarget: 25n,
            appearance: "dark",
          },
        }),
      ),
    );
    const report = await importArchive(asBackend(), doc);

    expect(report.created.settings).toBe(0);
    expect(report.failures).toMatchObject([
      { entity: "settings", label: "Profile and appearance" },
    ]);
    expect(await target.getMySettings()).toBeNull();
  });
});
