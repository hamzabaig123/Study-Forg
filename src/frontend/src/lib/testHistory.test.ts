import type { LocalQuestionResult, LocalSession } from "@/lib/localSessions";
import {
  DEFAULT_HISTORY_FILTERS,
  type TestAttempt,
  attemptCounts,
  attemptDurationSeconds,
  attemptFromLocal,
  attemptFromSummary,
  attemptPercent,
  canDeleteAttempt,
  detailFromLocal,
  filterAttempts,
  historySubjects,
  itemStatus,
  mergeAttempts,
  parseTestAttempt,
  parseTestAttemptDetail,
  summarizeHistory,
  toQuestionResult,
} from "@/lib/testHistory";
import { QuestionType, SessionMode } from "@/types";
import { describe, expect, it } from "vitest";

/** One list entry exactly as the live `test_history()` returned it. */
const SERVER_SESSION = {
  id: "9003",
  kind: "session",
  mode: "timedTest",
  score: 3,
  title: "Organelles",
  total: 3,
  classes: ["Class 11 — Biology"],
  answered: 0,
  subjects: ["Cell Biology"],
  scopeKind: "topic",
  startedAt: "2026-09-27T00:40:14.273+00:00",
  completedAt: "2026-09-27T00:42:14.273+00:00",
  contentRemoved: false,
  timeLimitSeconds: null,
};

const SERVER_CUSTOM_DETAIL = {
  id: "tmvcxeqvzdj",
  kind: "custom",
  mode: "timedTest",
  score: 1,
  title: "m.c.qs",
  total: 3,
  classes: ["Class 11"],
  answered: 2,
  subjects: ["اسلامیات"],
  scopeKind: "custom",
  startedAt: "2026-10-17T21:46:11.999+00:00",
  completedAt: "2026-10-17T21:53:14.789+00:00",
  contentRemoved: false,
  timeLimitSeconds: 480,
  items: [
    {
      position: 2,
      questionId: "740",
      prompt: "Third",
      questionType: "trueFalse",
      submitted: null,
      correct: false,
      correctAnswer: { __kind__: "trueFalse", trueFalse: { correct: true } },
      explanation: null,
      labels: null,
    },
    {
      position: 0,
      questionId: "738",
      prompt: "حضرت امام شافعی",
      questionType: "multipleChoice",
      submitted: {
        __kind__: "multipleChoice",
        multipleChoice: { optionId: "4" },
      },
      correct: true,
      correctAnswer: {
        __kind__: "multipleChoice",
        multipleChoice: {
          options: [
            { id: "1", text: "فلسطین میں" },
            { id: "4", text: "مکہ مکرمہ میں" },
          ],
          correctOptionId: "4",
        },
      },
      explanation: "مکہ مکرمہ",
      labels: {
        className: "Class 11",
        topicName: "Topic",
        chapterName: "m.c.qs",
        subjectName: "اسلامیات",
      },
    },
    {
      position: 1,
      questionId: "739",
      prompt: "Second",
      questionType: "shortAnswer",
      submitted: { __kind__: "shortAnswer", shortAnswer: { text: "x" } },
      correct: false,
      correctAnswer: {
        __kind__: "shortAnswer",
        shortAnswer: { expected: "y" },
      },
      explanation: "",
      labels: null,
    },
    { position: 3, questionType: "essay", correctAnswer: {} },
  ],
};

function attempt(overrides: Partial<TestAttempt>): TestAttempt {
  return {
    kind: "session",
    id: "1",
    mode: SessionMode.practice,
    scope: "topic",
    title: "Topic",
    startedAtMs: 0,
    completedAtMs: 60_000,
    timeLimitSeconds: null,
    score: 1,
    total: 2,
    answered: 2,
    contentRemoved: false,
    subjects: [],
    classes: [],
    ...overrides,
  };
}

function result(
  overrides: Partial<LocalQuestionResult> = {},
): LocalQuestionResult {
  return {
    questionId: "5",
    prompt: "Is water wet?",
    questionType: QuestionType.trueFalse,
    submitted: { __kind__: "trueFalse", trueFalse: { value: true } },
    correct: true,
    correctAnswer: { __kind__: "trueFalse", trueFalse: { correct: true } },
    explanation: null,
    labels: {
      className: "Class 11",
      subjectName: "Physics",
      chapterName: "Fluids",
      topicName: "Surface tension",
    },
    ...overrides,
  };
}

function localSession(results: LocalQuestionResult[]): LocalSession {
  return {
    id: "tlocal1",
    mode: SessionMode.timedTest,
    scopeLabel: "Mixed revision",
    questions: [],
    answers: {},
    startedAtMs: 1_000,
    durationSeconds: 600,
    status: "completed",
    completedAtMs: 91_000,
    results,
    score: results.filter((r) => r.correct).length,
    total: results.length,
  };
}

describe("parseTestAttempt", () => {
  it("reads the live server shape", () => {
    expect(parseTestAttempt(SERVER_SESSION)).toEqual({
      kind: "session",
      id: "9003",
      mode: SessionMode.timedTest,
      scope: "topic",
      title: "Organelles",
      startedAtMs: Date.parse("2026-09-27T00:40:14.273Z"),
      completedAtMs: Date.parse("2026-09-27T00:42:14.273Z"),
      timeLimitSeconds: null,
      score: 3,
      total: 3,
      answered: 0,
      contentRemoved: false,
      subjects: ["Cell Biology"],
      classes: ["Class 11 — Biology"],
    });
  });

  it("refuses an entry it cannot address or date", () => {
    expect(parseTestAttempt(null)).toBeNull();
    expect(parseTestAttempt([])).toBeNull();
    expect(parseTestAttempt({ ...SERVER_SESSION, kind: "other" })).toBeNull();
    expect(parseTestAttempt({ ...SERVER_SESSION, id: "" })).toBeNull();
    expect(
      parseTestAttempt({ ...SERVER_SESSION, completedAt: "not a date" }),
    ).toBeNull();
  });

  it("clamps junk counts to zero instead of producing NaN", () => {
    const parsed = parseTestAttempt({
      ...SERVER_SESSION,
      score: "x",
      total: -4,
      subjects: ["A", 3, ""],
    });
    expect(parsed?.score).toBe(0);
    expect(parsed?.total).toBe(0);
    expect(parsed?.subjects).toEqual(["A"]);
  });
});

describe("parseTestAttemptDetail", () => {
  const detail = parseTestAttemptDetail(SERVER_CUSTOM_DETAIL);

  it("orders items by position and drops ones it cannot render", () => {
    expect(detail?.items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it("keeps the submitted answer, labels and explanation", () => {
    const [first, second, third] = detail?.items ?? [];
    expect(first?.submitted).toEqual({
      __kind__: "multipleChoice",
      multipleChoice: { optionId: "4" },
    });
    expect(first?.labels?.subjectName).toBe("اسلامیات");
    expect(first?.explanation).toBe("مکہ مکرمہ");
    expect(second?.explanation).toBeNull();
    expect(third?.submitted).toBeNull();
  });

  it("answers null for a missing test", () => {
    expect(parseTestAttemptDetail(null)).toBeNull();
  });
});

describe("item and attempt outcomes", () => {
  it("tells a wrong answer from a skipped one", () => {
    const items = parseTestAttemptDetail(SERVER_CUSTOM_DETAIL)?.items ?? [];
    expect(items.map(itemStatus)).toEqual(["correct", "wrong", "skipped"]);
  });

  it("splits a score into correct, wrong and skipped", () => {
    expect(
      attemptCounts(attempt({ score: 3, total: 10, answered: 7 })),
    ).toEqual({ correct: 3, wrong: 4, skipped: 3 });
  });

  it("counts a graded answer with no submission as answered, not skipped", () => {
    // The live seed rows are graded correct with nothing submitted.
    expect(attemptCounts(attempt({ score: 3, total: 3, answered: 0 }))).toEqual(
      { correct: 3, wrong: 0, skipped: 0 },
    );
  });

  it("calls every miss wrong when the source does not count answers", () => {
    expect(
      attemptCounts(attempt({ score: 1, total: 4, answered: null })),
    ).toEqual({ correct: 1, wrong: 3, skipped: 0 });
  });

  it("scores an empty test as zero, not NaN", () => {
    expect(attemptPercent({ score: 0, total: 0 })).toBe(0);
    expect(attemptPercent({ score: 3, total: 4 })).toBe(75);
  });

  it("measures the run from start to finish when the start is known", () => {
    expect(attemptDurationSeconds(attempt({}))).toBe(60);
    expect(attemptDurationSeconds(attempt({ startedAtMs: null }))).toBeNull();
  });
});

describe("local runs", () => {
  const session = localSession([
    result(),
    result({
      questionId: "6",
      submitted: null,
      correct: false,
      labels: {
        className: "Class 11",
        subjectName: "Chemistry",
        chapterName: "Bonds",
        topicName: "Ionic",
      },
    }),
  ]);

  it("summarises a device run the way the server does", () => {
    expect(attemptFromLocal(session)).toMatchObject({
      kind: "custom",
      id: "tlocal1",
      scope: "custom",
      title: "Mixed revision",
      timeLimitSeconds: 600,
      score: 1,
      total: 2,
      answered: 1,
      subjects: ["Chemistry", "Physics"],
      classes: ["Class 11"],
    });
  });

  it("opens a device run question by question", () => {
    const detail = detailFromLocal(session);
    expect(detail.items.map((item) => item.position)).toEqual([0, 1]);
    expect(detail.items[1]?.submitted).toBeNull();
  });

  it("turns an item into the review list's shape", () => {
    const [item] = detailFromLocal(session).items;
    if (!item) throw new Error("missing item");
    expect(toQuestionResult(item)).toMatchObject({
      questionId: 5n,
      submitted: { __kind__: "trueFalse", trueFalse: { value: true } },
      explanation: undefined,
    });
    expect(toQuestionResult({ ...item, questionId: "x" }).questionId).toBe(0n);
  });
});

describe("attemptFromSummary", () => {
  it("reads a canister summary's nanosecond timestamp", () => {
    const parsed = attemptFromSummary({
      id: 7n,
      completedAt: 1_700_000_000_000n * 1_000_000n,
      total: 5n,
      mode: SessionMode.practice,
      scopeLabel: "Atoms",
      score: 4n,
    });
    expect(parsed).toMatchObject({
      kind: "session",
      id: "7",
      completedAtMs: 1_700_000_000_000,
      score: 4,
      total: 5,
      answered: null,
    });
  });
});

describe("mergeAttempts", () => {
  it("lists each test once, newest first, preferring the device copy", () => {
    const merged = mergeAttempts(
      [
        attempt({
          kind: "custom",
          id: "t1",
          completedAtMs: 1,
          title: "server",
        }),
        attempt({ kind: "session", id: "t1", completedAtMs: 5 }),
      ],
      [
        attempt({
          kind: "custom",
          id: "t1",
          completedAtMs: 1,
          title: "device",
        }),
        attempt({ kind: "custom", id: "t2", completedAtMs: 9 }),
      ],
    );
    expect(merged.map((a) => `${a.kind}:${a.id}`)).toEqual([
      "custom:t2",
      "session:t1",
      "custom:t1",
    ]);
    expect(merged[2]?.title).toBe("device");
  });
});

describe("summarizeHistory", () => {
  it("averages per-test scores and ignores empty tests", () => {
    const stats = summarizeHistory([
      attempt({ score: 1, total: 2 }),
      attempt({ score: 4, total: 4 }),
      attempt({ score: 0, total: 0, answered: 0 }),
    ]);
    expect(stats).toEqual({
      tests: 3,
      averagePercent: 75,
      bestPercent: 100,
      questionsAnswered: 6,
    });
  });

  it("has no average or best before the first test", () => {
    expect(summarizeHistory([])).toEqual({
      tests: 0,
      averagePercent: null,
      bestPercent: null,
      questionsAnswered: 0,
    });
  });
});

describe("filterAttempts", () => {
  const list = [
    attempt({
      id: "1",
      title: "Organelles",
      mode: SessionMode.practice,
      subjects: ["Biology"],
      classes: ["Class 11"],
      completedAtMs: 1,
      score: 1,
      total: 4,
    }),
    attempt({
      id: "2",
      title: "Kinematics",
      mode: SessionMode.timedTest,
      subjects: ["Physics"],
      completedAtMs: 2,
      score: 4,
      total: 4,
    }),
    attempt({
      id: "3",
      title: "Mixed",
      mode: SessionMode.timedTest,
      subjects: ["Biology", "Physics"],
      completedAtMs: 3,
      score: 2,
      total: 4,
    }),
  ];
  const ids = (filters: Partial<typeof DEFAULT_HISTORY_FILTERS>) =>
    filterAttempts(list, { ...DEFAULT_HISTORY_FILTERS, ...filters }).map(
      (a) => a.id,
    );

  it("sorts newest first by default and can sort by score", () => {
    expect(ids({})).toEqual(["3", "2", "1"]);
    expect(ids({ sort: "oldest" })).toEqual(["1", "2", "3"]);
    expect(ids({ sort: "best" })).toEqual(["2", "3", "1"]);
    expect(ids({ sort: "worst" })).toEqual(["1", "3", "2"]);
  });

  it("filters by mode, subject and a search over title, subject and class", () => {
    expect(ids({ mode: SessionMode.timedTest })).toEqual(["3", "2"]);
    expect(ids({ subject: "Biology" })).toEqual(["3", "1"]);
    expect(ids({ query: "  KINE " })).toEqual(["2"]);
    expect(ids({ query: "class 11" })).toEqual(["1"]);
    expect(ids({ query: "physics", mode: SessionMode.practice })).toEqual([]);
  });

  it("does not reorder the list it was given", () => {
    filterAttempts(list, { ...DEFAULT_HISTORY_FILTERS, sort: "best" });
    expect(list.map((a) => a.id)).toEqual(["1", "2", "3"]);
  });

  it("offers every subject once, sorted", () => {
    expect(historySubjects(list)).toEqual(["Biology", "Physics"]);
  });
});

describe("canDeleteAttempt", () => {
  it("allows deleting only device runs off Supabase", () => {
    // The test environment pins no data backend, so this is the canister path.
    expect(canDeleteAttempt("custom")).toBe(true);
    expect(canDeleteAttempt("session")).toBe(false);
  });
});
