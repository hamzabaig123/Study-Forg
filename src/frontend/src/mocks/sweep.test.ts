import {
  type AccuracyBucket,
  DeviceType,
  ExportFormat,
  QuestionType,
  SessionMode,
  UserRole,
} from "@/backend";
import type { Principal } from "@icp-sdk/core/principal";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sweep over the localStorage mock backend: every entity, every question type,
 * sessions, sharing, links, notes, export and AI. Expectations are taken from
 * the Motoko implementation in `src/backend/lib`, which is the source of truth.
 */

type Backend = typeof import("@/mocks/backend").mockBackend;

let B: Backend;

async function load() {
  vi.resetModules();
  const mod = await import("@/mocks/backend");
  B = mod.mockBackend;
}

/** `JSON.stringify` chokes on the bigint ids the backend returns. */
function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString() : entry,
  );
}

async function buildHierarchy() {
  const klass = await B.createClass("Class 11", "Physics & Chemistry");
  const subject = await B.createSubject(klass.id, "Physics", null);
  const chapter = await B.createChapter(
    subject?.id ?? 0n,
    "Kinematics",
    "Motion in a straight line",
  );
  const topic = await B.createTopic(
    chapter?.id ?? 0n,
    "Uniform Acceleration",
    null,
  );
  if (!subject || !chapter || !topic)
    throw new Error("hierarchy should be created");
  return { klass, subject, chapter, topic };
}

const MCQ_OPTIONS = [
  { id: 1n, text: "9.8 m/s" },
  { id: 2n, text: "9.8 m/s^2" },
  { id: 3n, text: "0 m/s^2" },
];

const MCQ = {
  __kind__: "multipleChoice" as const,
  multipleChoice: { correctOptionId: 2n, options: MCQ_OPTIONS },
};
const TF = { __kind__: "trueFalse" as const, trueFalse: { correct: true } };
const SA = {
  __kind__: "shortAnswer" as const,
  shortAnswer: { expected: "v = u + at" },
};

const bucketOf = (buckets: AccuracyBucket[], label: string) =>
  buckets.find((bucket) => bucket.bucketLabel === label);

beforeEach(async () => {
  window.localStorage.clear();
  await load();
});

describe("sweep", () => {
  it("hierarchy: create, list, detail, rename", async () => {
    const { klass, subject, chapter, topic } = await buildHierarchy();

    expect((await B.getClass(klass.id))!.class.name).toBe("Class 11");
    expect((await B.getClass(klass.id))!.subjects).toHaveLength(1);
    expect((await B.listChapters(subject.id))[0].name).toBe("Kinematics");
    expect((await B.getSubject(subject.id))!.chapters).toHaveLength(1);
    expect(await B.listTopics(chapter.id)).toHaveLength(1);
    expect((await B.getTopic(topic.id))!.topic.name).toBe(
      "Uniform Acceleration",
    );

    const renamed = await B.renameTopic(
      topic.id,
      "Non-uniform Acceleration",
      "desc",
    );
    expect(renamed!.name).toBe("Non-uniform Acceleration");
    expect((await B.getTopic(topic.id))!.topic.description).toBe("desc");
    expect(await B.renameTopic(99_999n, "Nope", null)).toBeNull();

    // counts follow the live children
    expect((await B.listClasses())[0].subjectCount).toBe(1n);
    expect((await B.listSubjects(klass.id))[0].chapterCount).toBe(1n);
    expect((await B.listChapters(subject.id))[0].topicCount).toBe(1n);
  });

  it("breadcrumb path resolves class > subject > chapter > topic", async () => {
    const { klass, subject, chapter, topic } = await buildHierarchy();
    const path = await B.getTopicPath(topic.id);
    expect(path).not.toBeNull();
    expect(path!.class.id).toBe(klass.id);
    expect(path!.subject.id).toBe(subject.id);
    expect(path!.chapter.id).toBe(chapter.id);
    expect(path!.topic.id).toBe(topic.id);
    expect(await B.getTopicPath(123456n)).toBeNull();
  });

  it("questions: all three types round-trip and counts stay accurate", async () => {
    const { chapter, topic } = await buildHierarchy();
    const q1 = await B.createQuestion(
      topic.id,
      "g equals?",
      QuestionType.multipleChoice,
      MCQ,
      "near Earth surface",
    );
    const q2 = await B.createQuestion(
      topic.id,
      "Acceleration is a vector.",
      QuestionType.trueFalse,
      TF,
      null,
    );
    const q3 = await B.createQuestion(
      topic.id,
      "First equation of motion?",
      QuestionType.shortAnswer,
      SA,
      null,
    );
    expect([q1, q2, q3].every(Boolean)).toBe(true);

    const listed = await B.listQuestions(topic.id);
    expect(listed).toHaveLength(3);
    expect((await B.getTopic(topic.id))!.topic.questionCount).toBe(3n);
    expect((await B.listTopics(chapter.id))[0].questionCount).toBe(3n);

    const edited = await B.updateQuestion(
      q1!.id,
      "g equals (changed)?",
      QuestionType.trueFalse,
      TF,
      "now boolean",
    );
    expect(edited!.questionType).toBe(QuestionType.trueFalse);
    expect(edited!.prompt).toBe("g equals (changed)?");
    expect(
      await B.updateQuestion(424242n, "x", QuestionType.trueFalse, TF, null),
    ).toBeNull();

    expect(await B.deleteQuestion(q3!.id)).toBe(true);
    expect(await B.deleteQuestion(q3!.id)).toBe(false);
    expect(await B.listQuestions(topic.id)).toHaveLength(2);
    expect((await B.getTopic(topic.id))!.topic.questionCount).toBe(2n);
  });

  it("createQuestion only rejects an unknown topic", async () => {
    const { topic } = await buildHierarchy();
    expect(
      await B.createQuestion(
        topic.id,
        "prompt",
        QuestionType.multipleChoice,
        {
          __kind__: "multipleChoice",
          multipleChoice: {
            correctOptionId: 99n,
            options: [{ id: 1n, text: "a" }],
          },
        },
        null,
      ),
    ).not.toBeNull();
    expect(
      await B.createQuestion(
        424242n,
        "prompt",
        QuestionType.trueFalse,
        TF,
        null,
      ),
    ).toBeNull();
  });

  it("practice session grades every question type the way the canister does", async () => {
    const { topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      "standard gravity",
    );
    await B.createQuestion(
      topic.id,
      "vector?",
      QuestionType.trueFalse,
      TF,
      null,
    );
    await B.createQuestion(
      topic.id,
      "eq1?",
      QuestionType.shortAnswer,
      SA,
      "definition",
    );

    const started = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.practice,
    });
    expect(started.__kind__).toBe("ok");
    if (started.__kind__ !== "ok") return;
    const session = started.ok;
    expect(session.questions).toHaveLength(3);
    expect(session.expiresAt).toBeUndefined();
    expect(session.durationSeconds).toBeUndefined();
    // answers and explanations must never leak into the session view
    expect(snapshot(session)).not.toContain("correctOptionId");
    expect(snapshot(session)).not.toContain("standard gravity");

    const pick = (kind: string) =>
      session.questions.find((q) => q.questionType === kind)!;
    const grade = (kind: string, answer: unknown) =>
      B.submitAnswer({
        sessionId: session.id,
        questionId: pick(kind).id,
        answer: answer as never,
      });

    expect(
      (
        (await grade("multipleChoice", {
          __kind__: "multipleChoice",
          multipleChoice: { optionId: 2n },
        })) as { ok: { correct: boolean; explanation?: string } }
      ).ok.correct,
    ).toBe(true);
    expect(
      (
        (await grade("multipleChoice", {
          __kind__: "multipleChoice",
          multipleChoice: { optionId: 3n },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(false);
    // a variant mismatch is always wrong
    expect(
      (
        (await grade("trueFalse", {
          __kind__: "multipleChoice",
          multipleChoice: { optionId: 2n },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(false);
    expect(
      (
        (await grade("trueFalse", {
          __kind__: "trueFalse",
          trueFalse: { value: true },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(true);
    expect(
      (
        (await grade("trueFalse", {
          __kind__: "trueFalse",
          trueFalse: { value: false },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(false);
    // short answers trim spaces and fold case, but keep inner spacing
    expect(
      (
        (await grade("shortAnswer", {
          __kind__: "shortAnswer",
          shortAnswer: { text: "  V = U + AT  " },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(true);
    expect(
      (
        (await grade("shortAnswer", {
          __kind__: "shortAnswer",
          shortAnswer: { text: "V=U+AT" },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(false);
    expect(
      (
        (await grade("shortAnswer", {
          __kind__: "shortAnswer",
          shortAnswer: { text: "nonsense" },
        })) as { ok: { correct: boolean } }
      ).ok.correct,
    ).toBe(false);

    expect(
      await B.submitAnswer({
        sessionId: session.id,
        questionId: 987654n,
        answer: { __kind__: "trueFalse", trueFalse: { value: true } },
      }),
    ).toMatchObject({
      __kind__: "err",
      err: { __kind__: "invalidInput" },
    });
    expect(
      await B.submitAnswer({
        sessionId: 987654n,
        questionId: 1n,
        answer: { __kind__: "trueFalse", trueFalse: { value: true } },
      }),
    ).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });

    const done = await B.completeSession(session.id);
    expect(done.__kind__).toBe("ok");
    if (done.__kind__ !== "ok") return;
    expect(done.ok.total).toBe(3n);
    // the last answer submitted for a question wins, and each one here was wrong
    expect(done.ok.score).toBe(0n);
    expect(done.ok.results.every((r) => !r.correct)).toBe(true);
    expect(done.ok.results[0].submitted).toEqual({
      __kind__: "multipleChoice",
      multipleChoice: { optionId: 3n },
    });
    expect((await B.getSessionResult(session.id))!.score).toBe(0n);
    // the live session is gone, so completing twice is not found
    expect(await B.completeSession(session.id)).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });
    expect(await B.getSession(session.id)).toBeNull();
  });

  it("unanswered questions count as wrong and stay in the total", async () => {
    const { topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      null,
    );
    await B.createQuestion(
      topic.id,
      "vector?",
      QuestionType.trueFalse,
      TF,
      null,
    );
    const started = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.practice,
    });
    if (started.__kind__ !== "ok") throw new Error("session should start");
    await B.submitAnswer({
      sessionId: started.ok.id,
      questionId: started.ok.questions[0].id,
      answer: { __kind__: "multipleChoice", multipleChoice: { optionId: 2n } },
    });
    const done = await B.completeSession(started.ok.id);
    if (done.__kind__ !== "ok") throw new Error("session should complete");
    expect(done.ok).toMatchObject({ score: 1n, total: 2n });
    expect(done.ok.results[1].submitted).toBeUndefined();
    expect(done.ok.results[1].correct).toBe(false);
  });

  it("timed tests clamp to the pool, require a duration and expire", async () => {
    const { chapter, topic } = await buildHierarchy();
    for (let i = 0; i < 6; i += 1) {
      await B.createQuestion(
        topic.id,
        `Q${i}`,
        QuestionType.trueFalse,
        TF,
        null,
      );
    }
    const topic2 = await B.createTopic(chapter.id, "Projectile Motion", null);
    for (let i = 0; i < 4; i += 1) {
      await B.createQuestion(
        topic2!.id,
        `P${i}`,
        QuestionType.trueFalse,
        TF,
        null,
      );
    }

    const timed = await B.startSession({
      scope: { __kind__: "chapter", chapter: chapter.id },
      mode: SessionMode.timedTest,
      durationSeconds: 60n,
      questionCount: 5n,
    });
    expect(timed.__kind__).toBe("ok");
    if (timed.__kind__ !== "ok") return;
    expect(timed.ok.questions).toHaveLength(5);
    expect(timed.ok.durationSeconds).toBe(60n);
    expect(timed.ok.expiresAt).toBeTypeOf("bigint");
    expect(timed.ok.scopeLabel.length).toBeGreaterThan(0);

    const over = await B.startSession({
      scope: { __kind__: "chapter", chapter: chapter.id },
      mode: SessionMode.timedTest,
      durationSeconds: 30n,
      questionCount: 999n,
    });
    expect(
      (over as { ok: { questions: unknown[] } }).ok.questions,
    ).toHaveLength(10);

    const noCount = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.timedTest,
      durationSeconds: 30n,
      questionCount: 0n,
    });
    expect(noCount).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "questionCount must be greater than zero",
      },
    });

    const noDuration = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.timedTest,
      questionCount: 2n,
    });
    expect(noDuration).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "durationSeconds is required for a timed test",
      },
    });

    const zeroDuration = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.timedTest,
      durationSeconds: 0n,
    });
    expect(zeroDuration).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "durationSeconds must be greater than zero",
      },
    });

    // practice serves the whole pool even when a stale count is supplied
    const practice = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.practice,
      questionCount: 2n,
    });
    expect(
      (practice as { ok: { questions: unknown[] } }).ok.questions,
    ).toHaveLength(6);

    const barren = await B.createTopic(chapter.id, "Barren", null);
    expect(
      await B.startSession({
        scope: { __kind__: "topic", topic: barren!.id },
        mode: SessionMode.practice,
      }),
    ).toMatchObject({ __kind__: "err", err: { __kind__: "noQuestions" } });
    expect(
      await B.startSession({
        scope: { __kind__: "topic", topic: 424242n },
        mode: SessionMode.practice,
      }),
    ).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });
  });

  it("an expired timed test rejects answers", async () => {
    const { topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      null,
    );
    const started = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.timedTest,
      durationSeconds: 1n,
    });
    if (started.__kind__ !== "ok") throw new Error("session should start");
    const answer = {
      sessionId: started.ok.id,
      questionId: started.ok.questions[0].id,
      answer: {
        __kind__: "multipleChoice" as const,
        multipleChoice: { optionId: 2n },
      },
    };
    expect((await B.submitAnswer(answer)).__kind__).toBe("ok");
    vi.spyOn(Date, "now").mockReturnValue(
      Number(started.ok.expiresAt!) / 1_000_000 + 5_000,
    );
    expect(await B.submitAnswer(answer)).toMatchObject({
      __kind__: "err",
      err: { __kind__: "invalidInput", invalidInput: "time has expired" },
    });
    vi.restoreAllMocks();
  });

  it("attempt history, dashboard stats and analytics reflect completed sessions", async () => {
    const { klass, subject, topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      null,
    );
    await B.createQuestion(
      topic.id,
      "vector?",
      QuestionType.trueFalse,
      TF,
      null,
    );
    await B.createQuestion(
      topic.id,
      "eq1?",
      QuestionType.shortAnswer,
      SA,
      null,
    );

    const started = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.practice,
    });
    if (started.__kind__ !== "ok") throw new Error("session should start");
    await B.submitAnswer({
      sessionId: started.ok.id,
      questionId: started.ok.questions[0].id,
      answer: { __kind__: "multipleChoice", multipleChoice: { optionId: 2n } },
    });
    await B.completeSession(started.ok.id);

    const history = await B.getAttemptHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      score: 1n,
      total: 3n,
      mode: SessionMode.practice,
      scopeLabel: "Uniform Acceleration",
    });

    expect(await B.getDashboardStats()).toMatchObject({
      classCount: 1n,
      subjectCount: 1n,
      chapterCount: 1n,
      topicCount: 1n,
      questionCount: 3n,
    });

    const breakdown = await B.getAnalyticsBreakdown();
    const byClass = bucketOf(breakdown.byClass, klass.name)!;
    const bySubject = bucketOf(breakdown.bySubject, subject.name)!;
    const byType = bucketOf(breakdown.byQuestionType, "Multiple choice")!;
    expect(byClass).toMatchObject({ correct: 1n, total: 3n });
    // accuracyPercent is the raw float, never rounded to a whole number
    expect(byClass.accuracyPercent).toBeCloseTo(100 / 3, 10);
    expect(bySubject.accuracyPercent).toBeCloseTo(100 / 3, 10);
    expect(byType).toMatchObject({
      total: 1n,
      correct: 1n,
      accuracyPercent: 100,
    });
    expect(bucketOf(breakdown.byQuestionType, "True / false")!.correct).toBe(
      0n,
    );
    expect(bucketOf(breakdown.byQuestionType, "Short answer")!.total).toBe(1n);

    const activity = await B.getRecentActivity(50n);
    expect(activity.length).toBeGreaterThan(3);
    expect(activity[0].at >= activity[activity.length - 1].at).toBe(true);
    expect(
      activity.some((item) => item.title.startsWith("Practice completed — ")),
    ).toBe(true);
    expect(await B.getRecentActivity(0n)).toEqual([]);
    expect(await B.getRecentActivity(2n)).toHaveLength(2);
  });

  it("cascade deletes remove descendants and hide their results", async () => {
    const { klass, subject, chapter, topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      null,
    );
    const started = await B.startSession({
      scope: { __kind__: "topic", topic: topic.id },
      mode: SessionMode.practice,
    });
    if (started.__kind__ !== "ok") throw new Error("session should start");
    await B.completeSession(started.ok.id);
    expect(await B.getAttemptHistory()).toHaveLength(1);

    const [firstQuestion] = await B.listQuestions(topic.id);
    expect(await B.deleteQuestion(firstQuestion!.id)).toBe(true);
    expect((await B.getTopic(topic.id))!.topic.questionCount).toBe(0n);

    expect(await B.deleteTopic(topic.id)).toBe(true);
    expect(await B.listTopics(chapter.id)).toEqual([]);
    expect((await B.getChapter(chapter.id))!.chapter.topicCount).toBe(0n);

    expect(await B.deleteChapter(chapter.id)).toBe(true);
    expect(await B.listChapters(subject.id)).toEqual([]);
    expect((await B.getClass(klass.id))!.subjects[0].chapterCount).toBe(0n);

    expect(await B.deleteSubject(subject.id)).toBe(true);
    expect((await B.listClasses())[0].subjectCount).toBe(0n);

    expect(await B.deleteClass(klass.id)).toBe(true);
    expect(await B.listClasses()).toEqual([]);
    expect(await B.getDashboardStats()).toMatchObject({
      classCount: 0n,
      subjectCount: 0n,
      chapterCount: 0n,
      topicCount: 0n,
      questionCount: 0n,
    });
    expect(await B.deleteClass(klass.id)).toBe(false);
    // the recorded session can no longer resolve its scope
    expect(await B.getAttemptHistory()).toEqual([]);
    expect(await B.getSessionResult(started.ok.id)).toBeNull();
  });

  it("content share links: create-or-reuse, public view withholds answers, revoke", async () => {
    const { topic, chapter } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      "hidden explanation",
    );

    const one = await B.createShare({ __kind__: "topic", topic: topic.id });
    const two = await B.createShare({ __kind__: "topic", topic: topic.id });
    if (one.__kind__ !== "ok" || two.__kind__ !== "ok")
      throw new Error("share should be created");
    expect(two.ok.token).toBe(one.ok.token);

    const shared = await B.getSharedContent(one.ok.token);
    expect(shared).not.toBeNull();
    expect(shared!.questions[0].options).toHaveLength(3);
    // non-MCQ questions expose no options
    await B.createQuestion(
      topic.id,
      "vector?",
      QuestionType.trueFalse,
      TF,
      null,
    );
    const refreshed = (await B.getSharedContent(one.ok.token))!;
    expect(refreshed.questions[1].options).toEqual([]);
    expect(snapshot(refreshed)).not.toContain("correctOptionId");
    expect(snapshot(refreshed)).not.toContain("hidden explanation");
    expect(refreshed.breadcrumb.map((item) => item.name)).toEqual([
      "Class 11",
      "Physics",
      "Kinematics",
      "Uniform Acceleration",
    ]);

    await B.createShare({ __kind__: "chapter", chapter: chapter.id });
    expect(await B.listShares()).toHaveLength(2);

    expect(await B.revokeShare(one.ok.token)).toBe(true);
    expect(await B.revokeShare(one.ok.token)).toBe(false);
    expect(await B.getSharedContent(one.ok.token)).toBeNull();
    expect(await B.getSharedContent("bogus")).toBeNull();
    expect(await B.createShare({ __kind__: "topic", topic: 424242n })).toEqual({
      __kind__: "err",
      err: "notFound",
    });
  });

  it("export: csv, pdf and json payloads", async () => {
    const { chapter, topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      "why",
    );
    await B.createQuestion(
      topic.id,
      'quote " and comma, here?',
      QuestionType.trueFalse,
      TF,
      null,
    );

    const csv = await B.exportContent(
      { __kind__: "topic", topic: topic.id },
      ExportFormat.csv,
    );
    if (csv.__kind__ !== "ok") throw new Error("csv should export");
    expect(csv.ok.mimeType).toContain("csv");
    expect(csv.ok.filename.endsWith(".csv")).toBe(true);
    const lines = csv.ok.content.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(csv.ok.content).toContain("9.8 m/s^2");
    expect(csv.ok.content).toContain('""');

    const pdf = await B.exportContent(
      { __kind__: "topic", topic: topic.id },
      ExportFormat.pdf,
    );
    if (pdf.__kind__ !== "ok") throw new Error("pdf should export");
    expect(pdf.ok.mimeType).toBe("application/pdf");
    expect(pdf.ok.content.startsWith("%PDF")).toBe(true);

    const chapterExport = await B.exportContent(
      { __kind__: "chapter", chapter: chapter.id },
      ExportFormat.csv,
    );
    if (chapterExport.__kind__ !== "ok")
      throw new Error("chapter should export");
    expect(chapterExport.ok.content.split("\r\n")).toHaveLength(3);

    const barren = await B.createTopic(chapter.id, "Barren", null);
    expect(
      await B.exportContent(
        { __kind__: "topic", topic: barren!.id },
        ExportFormat.csv,
      ),
    ).toEqual({
      __kind__: "err",
      err: "empty",
    });
    expect(
      await B.exportContent(
        { __kind__: "topic", topic: 424242n },
        ExportFormat.csv,
      ),
    ).toEqual({
      __kind__: "err",
      err: "notFound",
    });

    const contentShare = await B.createShare({
      __kind__: "topic",
      topic: topic.id,
    });
    if (contentShare.__kind__ !== "ok") throw new Error("should share");
    const sharedNote = await B.createNote(
      "Newton's laws",
      null,
      null,
      null,
      '{"type":"doc"}',
      "first second third law",
    );
    const noteShare = await B.createNoteShare(sharedNote.id);
    if (noteShare.__kind__ !== "ok") throw new Error("should share the note");
    const link = await B.createLink("https://example.com/paper");
    if (link.__kind__ !== "ok") throw new Error("should link");

    const mine = await B.exportMyData();
    expect(mine.filename).toBe("studydesk-export.json");
    expect(mine.mimeType).toBe("application/json");
    const parsed = JSON.parse(mine.content) as Record<string, unknown>;
    expect(parsed).toHaveProperty("classes");
    expect(snapshot(parsed)).not.toContain("sk-abcdef");
    /* A share token and a link's edit token both open a write door, and a
     * backup is a file that gets emailed and left in Downloads. */
    for (const token of [
      contentShare.ok.token,
      noteShare.ok.token,
      link.ok.editToken,
    ]) {
      expect(mine.content).not.toContain(token);
    }
    expect(parsed).toHaveProperty("shares");
    expect(parsed).toHaveProperty("noteShares");
    expect(parsed).toHaveProperty("links");
  });

  it("notes: create, revision conflicts, trash, restore, share, purge", async () => {
    const note = await B.createNote(
      "Newton's laws",
      "Physics",
      "Kinematics",
      null,
      '{"type":"doc"}',
      "first second third law",
    );
    expect(note.revision).toBe(1n);
    expect(await B.listNotes(null)).toHaveLength(1);
    expect(await B.listNotes("second")).toHaveLength(1);
    expect(await B.listNotes("NEWTON")).toHaveLength(1);
    expect(await B.listNotes("zzz")).toEqual([]);
    expect(await B.listTrashedNotes()).toEqual([]);

    const updated = await B.updateNote(
      note.id,
      "Newton's laws (v2)",
      "Physics",
      "Kinematics",
      "Acceleration",
      "{}",
      "revision two",
      1n,
    );
    if (updated.__kind__ !== "ok") throw new Error("note should update");
    expect(updated.ok.revision).toBe(2n);
    expect(updated.ok.topicLabel).toBe("Acceleration");

    const stale = await B.updateNote(
      note.id,
      "x",
      null,
      null,
      null,
      "{}",
      "y",
      1n,
    );
    if (stale.__kind__ !== "err" || stale.err.__kind__ !== "staleRevision")
      throw new Error("should be stale");
    expect(stale.err.staleRevision).toEqual({ expected: 1n, actual: 2n });
    expect(
      await B.updateNote(424242n, "x", null, null, null, "{}", "y", 1n),
    ).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });

    const renamed = await B.renameNote(note.id, "Laws of Motion");
    if (renamed.__kind__ !== "ok") throw new Error("should rename");
    expect(renamed.ok.revision).toBe(3n);
    expect(await B.renameNote(424242n, "x")).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });

    const share = await B.createNoteShare(note.id);
    if (share.__kind__ !== "ok") throw new Error("should share");
    const second = await B.createNoteShare(note.id);
    expect((second as { ok: { token: string } }).ok.token).not.toBe(
      share.ok.token,
    );
    expect(await B.listNoteShares()).toHaveLength(2);
    expect((await B.getSharedNote(share.ok.token))!.title).toBe(
      "Laws of Motion",
    );
    expect(await B.getSharedNote("bogus")).toBeNull();
    expect(await B.createNoteShare(424242n)).toEqual({
      __kind__: "err",
      err: "notAuthorized",
    });

    const trashed = await B.softDeleteNote(note.id);
    if (trashed.__kind__ !== "ok") throw new Error("should trash");
    expect(trashed.ok.revision).toBe(4n);
    expect(trashed.ok.deletedAt).toBeTypeOf("bigint");
    expect(await B.listNotes(null)).toEqual([]);
    expect(await B.listTrashedNotes()).toHaveLength(1);
    // the share stops resolving while the note is in the bin
    expect(await B.getSharedNote(share.ok.token)).toBeNull();
    expect(await B.createNoteShare(note.id)).toEqual({
      __kind__: "err",
      err: "notFound",
    });

    const restored = await B.restoreNote(note.id);
    if (restored.__kind__ !== "ok") throw new Error("should restore");
    expect(restored.ok.revision).toBe(5n);
    expect(await B.listNotes(null)).toHaveLength(1);
    expect(await B.listTrashedNotes()).toEqual([]);
    expect((await B.getSharedNote(share.ok.token))!.title).toBe(
      "Laws of Motion",
    );

    expect(await B.revokeNoteShare(share.ok.token)).toMatchObject({
      __kind__: "ok",
    });
    expect(await B.getSharedNote(share.ok.token)).toBeNull();
    expect(await B.revokeNoteShare(share.ok.token)).toEqual({
      __kind__: "err",
      err: "notFound",
    });

    expect(await B.permanentlyDeleteNote(note.id)).toMatchObject({
      __kind__: "ok",
    });
    expect(await B.getNote(note.id)).toBeNull();
    expect(await B.permanentlyDeleteNote(note.id)).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });
    // the other note's share goes with it
    expect(await B.listNoteShares()).toHaveLength(0);
  });

  it("QR links: validation, resolve, scan stats, pause, retarget, delete, abuse", async () => {
    const rejected = [
      ["not-a-url", "URL must start with http:// or https://"],
      ["javascript:alert(1)", "URL must start with http:// or https://"],
      ["ftp://example.com", "Only http and https links are allowed."],
      ["https://", "URL is missing a host."],
      [
        "https://127.0.0.1/x",
        "Links to private or local addresses are not allowed.",
      ],
      [
        "https://10.1.2.3",
        "Links to private or local addresses are not allowed.",
      ],
      [
        "https://192.168.0.7",
        "Links to private or local addresses are not allowed.",
      ],
      [
        "https://172.16.0.7",
        "Links to private or local addresses are not allowed.",
      ],
      ["https://172.32.0.7", null],
      [
        "https://example.com/r/abc",
        "Links cannot point back at this app's short links.",
      ],
      ["https://localhost:5173/x", null],
    ] as const;
    for (const [url, problem] of rejected) {
      const result = await B.createLink(url);
      if (problem === null) {
        expect(result.__kind__).toBe("ok");
      } else {
        expect(result).toEqual({
          __kind__: "err",
          err: { __kind__: "invalidUrl", invalidUrl: problem },
        });
      }
    }
    expect(await B.createLink("   ")).toEqual({
      __kind__: "err",
      err: { __kind__: "invalidUrl", invalidUrl: "Enter a URL to shorten." },
    });

    const created = await B.createLink("https://example.com/physics");
    if (created.__kind__ !== "ok") throw new Error("link should be created");
    const link = created.ok;
    expect(link.shortUrl).toBe(`/r/${link.code}`);
    expect(link.manageUrl).toBe(`/manage/${link.editToken}`);
    expect(link.status).toBe("active");

    expect(await B.resolveCode(link.code, DeviceType.mobile, "PK")).toEqual({
      __kind__: "redirect",
      redirect: { targetUrl: "https://example.com/physics" },
    });
    await B.resolveCode(link.code, DeviceType.desktop, null);
    await B.resolveCode(link.code, DeviceType.other, "US");

    const stats = await B.getScanStats(link.editToken);
    expect(stats!.totalScans).toBe(3n);
    expect(stats!.perDay.reduce((sum, day) => sum + Number(day.count), 0)).toBe(
      3,
    );
    expect(stats!.perDay[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/u);

    expect((await B.getLinkByToken(link.editToken))!.targetUrl).toBe(
      "https://example.com/physics",
    );
    expect(await B.getLinkByToken("wrong-token")).toBeNull();
    expect(await B.getScanStats("wrong-token")).toBeNull();

    const paused = await B.setPaused(link.editToken, true);
    if (paused.__kind__ !== "ok") throw new Error("should pause");
    expect(paused.ok.status).toBe("paused");
    expect(
      await B.resolveCode(link.code, DeviceType.mobile, null),
    ).toMatchObject({ __kind__: "unavailable", unavailable: "paused" });
    // a paused link records no scan
    expect((await B.getScanStats(link.editToken))!.totalScans).toBe(3n);

    await B.setPaused(link.editToken, false);
    expect(
      (await B.resolveCode(link.code, DeviceType.mobile, null)).__kind__,
    ).toBe("redirect");

    const retarget = await B.updateTarget(
      link.editToken,
      "https://example.com/chem",
    );
    if (retarget.__kind__ !== "ok") throw new Error("should retarget");
    expect(retarget.ok.targetUrl).toBe("https://example.com/chem");
    expect(retarget.ok.status).toBe("active");
    expect(await B.updateTarget(link.editToken, "nope")).toMatchObject({
      __kind__: "err",
      err: { __kind__: "invalidUrl" },
    });
    expect(
      await B.updateTarget("bad-token", "https://example.com"),
    ).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });
    expect(await B.setPaused("bad-token", true)).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });

    // an abuse report is recorded but never touches the owner's link
    expect(await B.reportAbuse(link.code, "spam")).toMatchObject({
      __kind__: "ok",
    });
    expect((await B.getLinkByToken(link.editToken))!.status).toBe("active");
    expect(await B.reportAbuse(link.code, "   ")).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "Describe the problem with this link.",
      },
    });
    expect(await B.reportAbuse("", "spam")).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "A short code is required.",
      },
    });
    expect(await B.reportAbuse("nosuchcode", "spam")).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });

    expect(await B.deleteLink(link.editToken)).toMatchObject({
      __kind__: "ok",
    });
    expect((await B.getLinkByToken(link.editToken))!.status).toBe("deleted");
    expect(await B.resolveCode(link.code, DeviceType.mobile, null)).toEqual({
      __kind__: "unavailable",
      unavailable: "deleted",
    });
    expect(await B.deleteLink(link.editToken)).toMatchObject({
      __kind__: "ok",
    });
    expect(await B.deleteLink("bad-token")).toMatchObject({
      __kind__: "err",
      err: { __kind__: "notFound" },
    });
    // unpausing a deleted link brings it back, exactly as the canister does
    expect(
      ((await B.setPaused(link.editToken, false)) as { ok: { status: string } })
        .ok.status,
    ).toBe("active");
  });

  it("settings enforce the canister's limits", async () => {
    expect(await B.getMySettings()).toBeNull();
    const saved = await B.saveMySettings(
      "  Demo Student  ",
      "Master physics",
      25n,
      "Dark",
    );
    if (saved.__kind__ !== "ok") throw new Error("should save");
    expect(saved.ok).toMatchObject({
      displayName: "Demo Student",
      dailyTarget: 25n,
      appearance: "dark",
    });
    expect((await B.getMySettings())!.studyGoal).toBe("Master physics");

    const failures: [string, string, bigint, string, string][] = [
      ["   ", "goal", 10n, "light", "Display name is required"],
      [
        "x".repeat(81),
        "goal",
        10n,
        "light",
        "Display name must be at most 80 characters",
      ],
      [
        "Name",
        "y".repeat(281),
        10n,
        "light",
        "Study goal must be at most 280 characters",
      ],
      ["Name", "goal", 0n, "light", "Daily target must be at least 1"],
      ["Name", "goal", 1001n, "light", "Daily target must be at most 1000"],
      [
        "Name",
        "goal",
        10n,
        "neon",
        "Appearance must be one of: light, dark, frosted, maroon",
      ],
    ];
    for (const [name, goal, target, appearance, message] of failures) {
      expect(await B.saveMySettings(name, goal, target, appearance)).toEqual({
        __kind__: "err",
        err: { __kind__: "invalidInput", invalidInput: message },
      });
    }
    // the rejected writes must not have touched the stored row
    expect((await B.getMySettings())!.displayName).toBe("Demo Student");
  });

  it("AI config and draft generation", async () => {
    const { topic } = await buildHierarchy();

    expect(await B.getAiConfig()).toEqual({ hasPersonalKey: false });
    const withKey = await B.saveAiKey("sk-abcdef1234567890");
    expect(withKey).toEqual({ hasPersonalKey: true, keyHint: "sk-7890" });
    expect(withKey.keyHint).not.toContain("abcdef1234");
    expect(await B.saveAiKey("short")).toEqual({
      hasPersonalKey: true,
      keyHint: "••••",
    });
    await expect(B.saveAiKey("   ")).rejects.toThrow(
      "API key must not be empty",
    );

    const drafts = await B.generateDrafts({
      topicId: topic.id,
      prompt: "kinematics",
      count: 3n,
      sourceText:
        "A body accelerates uniformly at 9.8 m/s^2 near the surface of the Earth.",
    });
    if (drafts.__kind__ !== "ok") throw new Error("should generate");
    expect(drafts.ok.source).toBe("personalKey");
    expect(drafts.ok.drafts).toHaveLength(3);
    expect(
      drafts.ok.drafts.every((entry) => entry.source === "personalKey"),
    ).toBe(true);
    expect(
      drafts.ok.drafts.every((entry) => entry.draft.topicId === topic.id),
    ).toBe(true);

    const accepted = await B.acceptDraft(topic.id, drafts.ok.drafts[0].draft);
    expect(accepted).not.toBeNull();
    expect((await B.listQuestions(topic.id))[0].prompt).toBe(accepted!.prompt);
    expect(await B.acceptDraft(424242n, drafts.ok.drafts[0].draft)).toBeNull();

    expect(
      await B.generateDrafts({
        topicId: topic.id,
        prompt: "kinematics",
        count: 0n,
      }),
    ).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidRequest",
        invalidRequest: "Ask for at least one question",
      },
    });
    expect(
      await B.generateDrafts({ topicId: topic.id, prompt: "", count: 2n }),
    ).toMatchObject({
      __kind__: "err",
      err: {
        __kind__: "invalidRequest",
        invalidRequest: "Provide a prompt or some source text",
      },
    });
    // a prompt alone is enough, and an unknown topic is not validated
    const promptOnly = await B.generateDrafts({
      topicId: topic.id,
      prompt: "Uniform acceleration in a straight line",
      count: 2n,
    });
    expect(promptOnly.__kind__).toBe("ok");
    const removed = await B.removeAiKey();
    expect(removed).toEqual({ hasPersonalKey: false });
    const platform = await B.generateDrafts({
      topicId: topic.id,
      prompt: "x",
      count: 1n,
    });
    if (platform.__kind__ !== "ok") throw new Error("should generate");
    expect(platform.ok.source).toBe("platform");
  });

  it("identity and diagnostic entry points stay callable", async () => {
    await expect(B._initialize_access_control()).resolves.toBeUndefined();
    expect(await B._internet_identity_sign_in_start()).toBeInstanceOf(
      Uint8Array,
    );
    expect((await B._internet_identity_sign_in_finish()).__kind__).toBe("ok");
    expect(await B.getCallerUserRole()).toBe(UserRole.user);
    expect(await B.isCallerAdmin()).toBe(false);
    const anyone = { toText: () => "2vxsx-fae" } as unknown as Principal;
    await expect(
      B.assignCallerUserRole(anyone, UserRole.user),
    ).resolves.toBeUndefined();
    expect((await B.getApiDoc()).length).toBeGreaterThan(50);
    expect((await B.schema()).length).toBeGreaterThan(0);
    await expect(B.execute()).resolves.toMatchObject({ hasMore: false });
  });

  it("everything survives a reload (fresh module instance over the same localStorage)", async () => {
    const { klass, topic } = await buildHierarchy();
    await B.createQuestion(
      topic.id,
      "g?",
      QuestionType.multipleChoice,
      MCQ,
      null,
    );
    await B.createNote("Persisted note", null, null, null, "{}", "body");
    await B.saveMySettings("Hamza", "goal", 30n, "dark");
    const link = await B.createLink("https://example.com/keep");
    if (link.__kind__ !== "ok") throw new Error("link should be created");
    await B.resolveCode(link.ok.code, DeviceType.mobile, null);
    const before = await B.listClasses();

    await load();

    const after = await B.listClasses();
    expect(after.map((row) => row.name)).toEqual(before.map((row) => row.name));
    expect(after[0].id).toBe(klass.id);
    expect(after[0].createdAt).toBe(klass.createdAt);
    expect(typeof after[0].id).toBe("bigint");
    expect((await B.listQuestions(topic.id))[0].answer).toMatchObject({
      __kind__: "multipleChoice",
      multipleChoice: { correctOptionId: 2n },
    });
    expect((await B.listNotes(null))[0].title).toBe("Persisted note");
    expect((await B.getMySettings())!.dailyTarget).toBe(30n);
    expect((await B.getScanStats(link.ok.editToken))!.totalScans).toBe(1n);
    expect((await B.getDashboardStats()).questionCount).toBe(1n);
    const fresh = await B.createClass("After reload", null);
    expect(fresh.id > klass.id).toBe(true);
  });

  it("a corrupted storage entry starts a fresh database instead of throwing", async () => {
    window.localStorage.setItem("studyforge.mock-backend.v1", "{not json");
    await load();
    // `load()` re-evaluates the backend and its imports, so the health store to
    // read is the one it just loaded — not the module this file imported first.
    const { getStorageProblems } = await import("@/lib/localStore");
    expect(await B.listClasses()).toEqual([]);
    expect((await B.createClass("Recovered", null)).name).toBe("Recovered");
    // Booting empty is only survivable because the unreadable bytes were kept:
    // the write above would otherwise have destroyed the last copy of them.
    expect(
      window.localStorage.getItem("studyforge.mock-backend.v1.corrupt.0"),
    ).toBe("{not json");
    expect(getStorageProblems().map((problem) => problem.kind)).toContain(
      "corrupt",
    );
  });

  it("a write that never lands is reported, not swallowed", async () => {
    const { getStorageProblems } = await import("@/lib/localStore");
    const failure = Object.assign(new Error("quota"), {
      name: "QuotaExceededError",
    });
    // jsdom's `localStorage` is a proxy over named items, so a spy has to go on
    // the prototype or assigning it just stores a key called "setItem".
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw failure;
      });

    expect((await B.createClass("Not saved", null)).name).toBe("Not saved");
    expect(getStorageProblems().map((problem) => problem.kind)).toContain(
      "quota",
    );
    // Nothing was persisted, so a reload would start from an empty archive.
    expect(
      window.localStorage.getItem("studyforge.mock-backend.v1"),
    ).toBeNull();

    spy.mockRestore();
  });

  it("no method is left unimplemented", async () => {
    const record = B as unknown as Record<string, unknown>;
    const names = Object.keys(record).filter(
      (key) => typeof record[key] === "function",
    );
    expect(names).toHaveLength(77);
  });
});
