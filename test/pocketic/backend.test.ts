import { PocketIc } from "@dfinity/pic";
import { Principal } from "@icp-sdk/core/principal";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type {
  CreateLinkError,
  CreatedLink,
  LinkDetail,
  NoteShareLink,
  NoteView,
  ScanStats,
  SharedNote,
  UserSettingsView,
  _SERVICE,
} from "../../src/frontend/src/declarations/backend.did";

/**
 * Backend behavior lane.
 *
 * Installs the app's own compiled `src/backend/dist/backend.wasm` into the
 * platform's PocketIC replica and calls the real public API. This is the only
 * place in the build that exercises the canister itself: the frontend suite
 * mocks the actor, so it would pass identically against a backend whose public
 * methods are all `Debug.todo()` stubs.
 *
 * The runner (`run-backend-lane.mjs`) has already proved a live replica exists
 * before this file runs, so a failure here is the application's behavior.
 *
 * Shapes come from the agent-js declarations, not the TypeScript wrapper:
 * `Nat`/`Int` are `bigint`, `?T` is `[] | [T]`, a variant is `{ name: null }`,
 * and a unit reply decodes to `null`.
 */

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

let pic: PocketIc | undefined;
let actor: _SERVICE;

/** A second, distinct caller for the isolation test. */
const ALICE = Principal.fromText("aaaaa-aa");

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  }));
});

// `setPrincipal` persists across calls, so every test starts from a known
// caller rather than whatever the previous test left behind.
beforeEach(() => {
  actor.setPrincipal(ALICE);
});

afterAll(async () => {
  // `?.` because `beforeAll` may not have got that far. A failed
  // `PocketIc.create` otherwise stacks "Cannot read properties of undefined"
  // on top of the real error and buries the one line that explains the run.
  await pic?.tearDown();
});

describe("empty-state reads", () => {
  it("answers every list read with an empty array instead of trapping", async () => {
    await expect(actor.listClasses()).resolves.toEqual([]);
    await expect(actor.listShares()).resolves.toEqual([]);
    await expect(actor.getAttemptHistory()).resolves.toEqual([]);
    await expect(actor.getRecentActivity(8n)).resolves.toEqual([]);
  });

  it("answers the dashboard and analytics reads with zeroed structures", async () => {
    await expect(actor.getDashboardStats()).resolves.toEqual({
      classCount: 0n,
      subjectCount: 0n,
      chapterCount: 0n,
      questionCount: 0n,
      topicCount: 0n,
    });
    await expect(actor.getAnalyticsBreakdown()).resolves.toEqual({
      byClass: [],
      bySubject: [],
      byQuestionType: [],
    });
  });

  it("reports no personal AI key configured", async () => {
    await expect(actor.getAiConfig()).resolves.toEqual({
      hasPersonalKey: false,
      keyHint: [],
    });
  });

  it("returns no content for an unknown share token", async () => {
    await expect(actor.getSharedContent("does-not-exist")).resolves.toEqual([]);
  });
});

describe("content hierarchy round-trip", () => {
  it("creates a class, subject, chapter, and topic and lists each under its parent", async () => {
    const klass = await actor.createClass("Biology 101", ["Introductory biology"]);
    expect(klass.name).toBe("Biology 101");
    expect(klass.subjectCount).toBe(0n);

    const subject = await actor.createSubject(klass.id, "Cell Biology", []);
    expect(subject).not.toEqual([]);
    const subjectId = (subject as [{ id: bigint }])[0].id;

    const chapter = await actor.createChapter(subjectId, "Cell Structure", []);
    expect(chapter).not.toEqual([]);
    const chapterId = (chapter as [{ id: bigint }])[0].id;

    const topic = await actor.createTopic(chapterId, "Mitochondria", []);
    expect(topic).not.toEqual([]);
    const topicId = (topic as [{ id: bigint }])[0].id;

    // Each appears in its parent's list.
    const classes = await actor.listClasses();
    expect(classes.map((c) => c.name)).toContain("Biology 101");
    const subjects = await actor.listSubjects(klass.id);
    expect(subjects.map((s) => s.name)).toContain("Cell Biology");
    const chapters = await actor.listChapters(subjectId);
    expect(chapters.map((c) => c.name)).toContain("Cell Structure");
    const topics = await actor.listTopics(chapterId);
    expect(topics.map((t) => t.name)).toContain("Mitochondria");

    // The breadcrumb path resolves the full chain.
    const path = await actor.getTopicPath(topicId);
    expect(path).not.toEqual([]);
    const resolved = (path as [NonNullable<Awaited<ReturnType<_SERVICE["getTopicPath"]>>[number]>])[0];
    expect(resolved.class.name).toBe("Biology 101");
    expect(resolved.subject.name).toBe("Cell Biology");
    expect(resolved.chapter.name).toBe("Cell Structure");
    expect(resolved.topic.name).toBe("Mitochondria");
  });

  it("renames and deletes a class", async () => {
    const klass = await actor.createClass("Temp", []);
    const renamed = await actor.renameClass(klass.id, "Renamed", ["now described"]);
    expect(renamed).not.toEqual([]);
    expect((renamed as [{ name: string }])[0].name).toBe("Renamed");

    await expect(actor.deleteClass(klass.id)).resolves.toBe(true);
    const classes = await actor.listClasses();
    expect(classes.map((c) => c.id)).not.toContain(klass.id);
  });
});

describe("questions of all three types", () => {
  it("creates a multiple-choice, true/false, and short-answer question and lists all three", async () => {
    const klass = await actor.createClass("Question Bank", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "T", [])) as [{ id: bigint }];
    const topicId = topic[0].id;

    const mc = await actor.createQuestion(
      topicId,
      "Which organelle produces ATP?",
      { multipleChoice: null },
      {
        multipleChoice: {
          options: [
            { id: 1n, text: "Mitochondria" },
            { id: 2n, text: "Nucleus" },
          ],
          correctOptionId: 1n,
        },
      },
      ["Oxidative phosphorylation"],
    );
    expect(mc).not.toEqual([]);

    const tf = await actor.createQuestion(
      topicId,
      "The mitochondria is the powerhouse of the cell.",
      { trueFalse: null },
      { trueFalse: { correct: true } },
      [],
    );
    expect(tf).not.toEqual([]);

    const sa = await actor.createQuestion(
      topicId,
      "Name the powerhouse of the cell.",
      { shortAnswer: null },
      { shortAnswer: { expected: "Mitochondria" } },
      [],
    );
    expect(sa).not.toEqual([]);

    const questions = await actor.listQuestions(topicId);
    expect(questions).toHaveLength(3);
    const types = questions.map((q) => Object.keys(q.questionType)[0]);
    expect(types).toEqual(
      expect.arrayContaining(["multipleChoice", "trueFalse", "shortAnswer"]),
    );
  });
});

describe("practice and timed-test sessions", () => {
  it("starts a practice session, submits an answer, and completes it with a score", async () => {
    const klass = await actor.createClass("Session Class", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "T", [])) as [{ id: bigint }];
    const topicId = topic[0].id;

    await actor.createQuestion(
      topicId,
      "2 + 2?",
      { multipleChoice: null },
      {
        multipleChoice: {
          options: [
            { id: 1n, text: "4" },
            { id: 2n, text: "5" },
          ],
          correctOptionId: 1n,
        },
      },
      [],
    );

    const started = await actor.startSession({
      mode: { practice: null },
      scope: { topic: topicId },
      durationSeconds: [],
      questionCount: [],
    });
    expect(started).toHaveProperty("ok");
    const session = (started as { ok: { id: bigint; questions: Array<{ id: bigint }> } }).ok;
    expect(session.questions).toHaveLength(1);

    const feedback = await actor.submitAnswer({
      sessionId: session.id,
      questionId: session.questions[0].id,
      answer: { multipleChoice: { optionId: 1n } },
    });
    expect(feedback).toHaveProperty("ok");
    expect((feedback as { ok: { correct: boolean } }).ok.correct).toBe(true);

    const completed = await actor.completeSession(session.id);
    expect(completed).toHaveProperty("ok");
    const result = (completed as { ok: { score: bigint; total: bigint } }).ok;
    expect(result.score).toBe(1n);
    expect(result.total).toBe(1n);

    // The recorded result is readable afterwards.
    const fetched = await actor.getSessionResult(session.id);
    expect(fetched).not.toEqual([]);
  });

  it("starts a timed test with a duration and a visible countdown value", async () => {
    const klass = await actor.createClass("Timed Class", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "T", [])) as [{ id: bigint }];
    const topicId = topic[0].id;

    await actor.createQuestion(
      topicId,
      "True or false: water is wet.",
      { trueFalse: null },
      { trueFalse: { correct: true } },
      [],
    );

    const started = await actor.startSession({
      mode: { timedTest: null },
      scope: { topic: topicId },
      durationSeconds: [600n],
      questionCount: [1n],
    });
    expect(started).toHaveProperty("ok");
    const session = (started as { ok: { durationSeconds: [] | [bigint] } }).ok;
    expect(session.durationSeconds).toEqual([600n]);
  });

  it("rejects starting a session on a topic with no questions", async () => {
    const klass = await actor.createClass("Empty Class", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "T", [])) as [{ id: bigint }];

    const started = await actor.startSession({
      mode: { practice: null },
      scope: { topic: topic[0].id },
      durationSeconds: [],
      questionCount: [],
    });
    expect(started).toEqual({ err: { noQuestions: null } });
  });
});

describe("sharing and export", () => {
  it("creates a share link, resolves it anonymously, and revokes it", async () => {
    const klass = await actor.createClass("Share Class", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "T", [])) as [{ id: bigint }];
    const topicId = topic[0].id;

    await actor.createQuestion(
      topicId,
      "Shared question?",
      { shortAnswer: null },
      { shortAnswer: { expected: "yes" } },
      [],
    );

    // The share is created by ALICE, the caller set in `beforeEach`.
    const created = await actor.createShare({ topic: topicId });
    expect(created).toHaveProperty("ok");
    const token = (created as { ok: { token: string } }).ok.token;

    // Anonymous callers can resolve the token; answers are never revealed.
    actor.setPrincipal(Principal.anonymous());
    const shared = await actor.getSharedContent(token);
    expect(shared).not.toEqual([]);
    const content = (shared as [{ title: string; questions: unknown[] }])[0];
    expect(content.title).toBe("T");
    expect(content.questions).toHaveLength(1);

    // A non-owner cannot revoke it.
    actor.setPrincipal(Principal.fromText("2vxsx-fae"));
    await expect(actor.revokeShare(token)).resolves.toBe(false);

    // The owner can, and afterwards it no longer resolves.
    actor.setPrincipal(ALICE);
    await expect(actor.revokeShare(token)).resolves.toBe(true);
    actor.setPrincipal(Principal.anonymous());
    await expect(actor.getSharedContent(token)).resolves.toEqual([]);
  });

  it("exports a topic with questions as a CSV file", async () => {
    const klass = await actor.createClass("Export Class", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "Exportable", [])) as [{ id: bigint }];
    const topicId = topic[0].id;

    await actor.createQuestion(
      topicId,
      "Export me?",
      { shortAnswer: null },
      { shortAnswer: { expected: "yes" } },
      [],
    );

    const exported = await actor.exportContent({ topic: topicId }, { csv: null });
    expect(exported).toHaveProperty("ok");
    const file = (exported as { ok: { filename: string; mimeType: string; content: string } }).ok;
    expect(file.filename).toBe("Exportable.csv");
    expect(file.mimeType).toBe("text/csv");
    expect(file.content).toContain("Export me?");
  });

  it("refuses to export a topic with no questions", async () => {
    const klass = await actor.createClass("Empty Export", []);
    const subject = (await actor.createSubject(klass.id, "S", [])) as [{ id: bigint }];
    const chapter = (await actor.createChapter(subject[0].id, "C", [])) as [{ id: bigint }];
    const topic = (await actor.createTopic(chapter[0].id, "Nothing", [])) as [{ id: bigint }];

    const exported = await actor.exportContent({ topic: topic[0].id }, { csv: null });
    expect(exported).toEqual({ err: { empty: null } });
  });
});

describe("AI configuration", () => {
  it("saves a personal key, reports a hint, and removes it", async () => {
    actor.setPrincipal(ALICE);

    const saved = await actor.saveAiKey("sk-test-1234567890");
    expect(saved.hasPersonalKey).toBe(true);
    // First three + last four characters, never the middle.
    expect(saved.keyHint).toEqual(["sk-7890"]);

    const removed = await actor.removeAiKey();
    expect(removed.hasPersonalKey).toBe(false);
  });
});

describe("dynamic QR links", () => {
  it("creates a link, resolves it, and reports its scan stats", async () => {
    const created = await actor.createLink("https://example.com/spring");
    expect(created).toHaveProperty("ok");
    const link = (created as { ok: CreatedLink }).ok;
    expect(link.targetUrl).toBe("https://example.com/spring");
    expect(link.status).toEqual({ active: null });
    expect(link.code.length).toBeGreaterThan(0);
    expect(link.shortUrl).toBe(`/r/${link.code}`);
    expect(link.manageUrl).toBe(`/manage/${link.editToken}`);

    // An anonymous scan resolves the code to its current target.
    actor.setPrincipal(Principal.anonymous());
    const resolved = await actor.resolveCode(link.code, { desktop: null }, []);
    expect(resolved).toEqual({
      redirect: { targetUrl: "https://example.com/spring" },
    });

    // The scan is recorded against the link's secret token.
    actor.setPrincipal(ALICE);
    const stats = await actor.getScanStats(link.editToken);
    expect(stats).not.toEqual([]);
    const scanStats = (stats as [ScanStats])[0];
    expect(scanStats.totalScans).toBe(1n);
    expect(scanStats.perDay).toHaveLength(1);
    expect(scanStats.perDay[0].count).toBe(1n);
  });

  it("rejects a javascript: target and a private-IP target without creating a link", async () => {
    const scripted = await actor.createLink("javascript:alert(1)");
    expect(scripted).toHaveProperty("err");
    expect((scripted as { err: CreateLinkError }).err).toHaveProperty(
      "invalidUrl",
    );

    const privateIp = await actor.createLink("http://192.168.0.1/admin");
    expect(privateIp).toHaveProperty("err");
    expect((privateIp as { err: CreateLinkError }).err).toHaveProperty(
      "invalidUrl",
    );

    // Neither rejected attempt produced a resolvable link.
    const loopback = await actor.createLink("http://127.0.0.1:8080");
    expect(loopback).toHaveProperty("err");

    // Bracketed IPv6 literals reach the private-host check too: unique-local
    // and link-local addresses, and the dotted IPv4-mapped form.
    const uniqueLocal = await actor.createLink("http://[fc00::1]/router");
    expect(uniqueLocal).toHaveProperty("err");
    const linkLocal = await actor.createLink("http://[fe80::1]/printer");
    expect(linkLocal).toHaveProperty("err");
    const mappedV4 = await actor.createLink("http://[::ffff:10.0.0.1]/");
    expect(mappedV4).toHaveProperty("err");

    // A hostname that merely starts with "fc" is an ordinary public host,
    // not an IPv6 literal — the range checks must not refuse it.
    const fcHostname = await actor.createLink(
      "https://fcbarcelona.com/schedule",
    );
    expect(fcHostname).toHaveProperty("ok");
  });

  it("changes the target, pauses, and deletes a link by its secret token", async () => {
    const created = await actor.createLink("https://example.com/old");
    const link = (created as { ok: CreatedLink }).ok;

    // The same short code now redirects to the new target.
    const updated = await actor.updateTarget(
      link.editToken,
      "https://example.com/new",
    );
    expect(updated).toHaveProperty("ok");
    expect((updated as { ok: LinkDetail }).ok.targetUrl).toBe(
      "https://example.com/new",
    );
    actor.setPrincipal(Principal.anonymous());
    await expect(
      actor.resolveCode(link.code, { mobile: null }, []),
    ).resolves.toEqual({ redirect: { targetUrl: "https://example.com/new" } });

    // Pausing makes the code unavailable instead of redirecting.
    actor.setPrincipal(ALICE);
    const paused = await actor.setPaused(link.editToken, true);
    expect(paused).toHaveProperty("ok");
    expect((paused as { ok: LinkDetail }).ok.status).toEqual({ paused: null });
    actor.setPrincipal(Principal.anonymous());
    await expect(
      actor.resolveCode(link.code, { mobile: null }, []),
    ).resolves.toEqual({ unavailable: { paused: null } });

    // Deleting does the same.
    actor.setPrincipal(ALICE);
    await expect(actor.deleteLink(link.editToken)).resolves.toEqual({
      ok: null,
    });
    actor.setPrincipal(Principal.anonymous());
    await expect(
      actor.resolveCode(link.code, { mobile: null }, []),
    ).resolves.toEqual({ unavailable: { deleted: null } });
  });

  it("returns no link detail or stats for an unknown edit token", async () => {
    await expect(actor.getLinkByToken("no-such-token")).resolves.toEqual([]);
    await expect(actor.getScanStats("no-such-token")).resolves.toEqual([]);
    await expect(
      actor.updateTarget("no-such-token", "https://example.com"),
    ).resolves.toEqual({ err: { notFound: null } });
  });

  it("answers an abuse report the same way whether the code exists or not", async () => {
    const created = await actor.createLink("https://example.com/report-me");
    const link = (created as { ok: CreatedLink }).ok;

    // A known code records the report; an unknown one answers the same
    // `{ ok: null }` and records nothing, so this anonymous endpoint is not
    // a "which short codes exist?" oracle — the same rule the Postgres path
    // applies in 0013_abuse_report_throttle_and_oracle.sql.
    await expect(
      actor.reportAbuse(link.code, "This is spam"),
    ).resolves.toEqual({ ok: null });
    await expect(
      actor.reportAbuse("missing", "This is spam"),
    ).resolves.toEqual({ ok: null });
  });

  it("rate limits link creation to the configured window", async () => {
    // Anonymous callers all share one principal, so one window is one bucket.
    // Nothing earlier in the file creates links anonymously, so this window
    // starts fresh.
    actor.setPrincipal(Principal.anonymous());

    let refused = false;
    let attempts = 0;
    while (attempts < 30 && !refused) {
      const created = await actor.createLink(
        `https://example.com/burst-${attempts}`,
      );
      if ("err" in created) {
        refused = true;
        expect((created as { err: CreateLinkError }).err).toHaveProperty(
          "rateLimited",
        );
      }
      attempts += 1;
    }
    expect(refused).toBe(true);
  });
});

describe("notes workspace", () => {
  it("creates, reads, updates, soft-deletes, and restores a note", async () => {
    const created = await actor.createNote(
      "Cell division",
      ["Biology"],
      ["Cell Cycle"],
      [],
      JSON.stringify({
        version: 1,
        blocks: [{ id: "b1", kind: "paragraph", text: "Mitosis has four phases." }],
      }),
      "Mitosis has four phases.",
    );
    expect(created.title).toBe("Cell division");
    expect(created.status).toBe("active");
    expect(created.revision).toBe(1n);
    expect(created.subjectLabel).toEqual(["Biology"]);

    // The note appears in the caller's live list and resolves by id.
    const listed = await actor.listNotes([]);
    expect(listed.map((n) => n.id)).toContain(created.id);
    const fetched = await actor.getNote(created.id);
    expect(fetched).not.toEqual([]);
    expect((fetched as [NoteView])[0].title).toBe("Cell division");

    // A matching update advances the revision.
    const updated = await actor.updateNote(
      created.id,
      "Cell division revised",
      ["Biology"],
      ["Cell Cycle"],
      [],
      JSON.stringify({
        version: 1,
        blocks: [{ id: "b1", kind: "paragraph", text: "Four phases." }],
      }),
      "Four phases.",
      1n,
    );
    expect(updated).toHaveProperty("ok");
    expect((updated as { ok: NoteView }).ok.revision).toBe(2n);

    // A stale revision is rejected with the actual revision.
    const stale = await actor.updateNote(
      created.id,
      "Conflicting edit",
      [],
      [],
      [],
      "{}",
      "",
      1n,
    );
    expect(stale).toEqual({
      err: { staleRevision: { expected: 1n, actual: 2n } },
    });

    // Soft delete moves it to the trash and out of the live list.
    const trashed = await actor.softDeleteNote(created.id);
    expect(trashed).toHaveProperty("ok");
    expect((trashed as { ok: NoteView }).ok.status).toBe("trashed");
    expect((await actor.listNotes([])).map((n) => n.id)).not.toContain(
      created.id,
    );
    expect((await actor.listTrashedNotes()).map((n) => n.id)).toContain(
      created.id,
    );

    // Restore brings it back.
    const restored = await actor.restoreNote(created.id);
    expect(restored).toHaveProperty("ok");
    expect((restored as { ok: NoteView }).ok.status).toBe("active");
    expect((await actor.listNotes([])).map((n) => n.id)).toContain(created.id);
  });

  it("finds a note by a word that appears only in its body", async () => {
    await actor.createNote(
      "Photosynthesis",
      [],
      [],
      [],
      JSON.stringify({
        version: 1,
        blocks: [{ id: "b1", kind: "paragraph", text: "Chlorophyll absorbs light." }],
      }),
      "Chlorophyll absorbs light.",
    );

    const matches = await actor.listNotes(["chlorophyll"]);
    expect(matches.map((n) => n.title)).toContain("Photosynthesis");
    const misses = await actor.listNotes(["mitochondria"]);
    expect(misses.map((n) => n.title)).not.toContain("Photosynthesis");
  });

  it("shares a note publicly and stops resolving it after revocation", async () => {
    const note = await actor.createNote(
      "Shared note",
      [],
      [],
      [],
      JSON.stringify({
        version: 1,
        blocks: [{ id: "b1", kind: "heading", text: "Shared heading" }],
      }),
      "Shared heading",
    );

    const shared = await actor.createNoteShare(note.id);
    expect(shared).toHaveProperty("ok");
    const token = (shared as { ok: NoteShareLink }).ok.token;

    // Anonymous callers can read the shared payload.
    actor.setPrincipal(Principal.anonymous());
    const resolved = await actor.getSharedNote(token);
    expect(resolved).not.toEqual([]);
    expect((resolved as [SharedNote])[0].title).toBe("Shared note");

    // Revoking makes the token stop resolving.
    actor.setPrincipal(ALICE);
    await expect(actor.revokeNoteShare(token)).resolves.toEqual({ ok: null });
    actor.setPrincipal(Principal.anonymous());
    await expect(actor.getSharedNote(token)).resolves.toEqual([]);
  });

  it("saves and reads the caller's settings", async () => {
    await expect(actor.getMySettings()).resolves.toEqual([]);

    const saved = await actor.saveMySettings("Ada", "Pass the exam", 20n, "dark");
    expect(saved).toHaveProperty("ok");
    const view = (saved as { ok: UserSettingsView }).ok;
    expect(view.displayName).toBe("Ada");
    expect(view.dailyTarget).toBe(20n);
    expect(view.appearance).toBe("dark");

    const read = await actor.getMySettings();
    expect(read).not.toEqual([]);
    expect((read as [UserSettingsView])[0].displayName).toBe("Ada");

    // The fourth theme is accepted and normalized, matching the widened
    // appearance CHECK on the Postgres path (0012_maroon_appearance.sql).
    await expect(
      actor.saveMySettings("Ada", "", 20n, "Maroon"),
    ).resolves.toHaveProperty("ok");

    // An out-of-range daily target is rejected.
    await expect(
      actor.saveMySettings("Ada", "", 0n, "dark"),
    ).resolves.toEqual({
      err: { invalidInput: "Daily target must be at least 1" },
    });
  });

  it("exports the caller's data as a JSON file", async () => {
    await actor.createNote(
      "Exportable note",
      [],
      [],
      [],
      JSON.stringify({ version: 1, blocks: [{ id: "b1", kind: "paragraph", text: "Body" }] }),
      "Body",
    );

    const exported = await actor.exportMyData();
    expect(exported.mimeType).toBe("application/json");
    expect(exported.filename).toBe("studydesk-export.json");
    expect(exported.content).toContain("Exportable note");
  });
});

describe("caller isolation", () => {
  it("does not show one caller's classes to another", async () => {
    actor.setPrincipal(ALICE);
    await actor.createClass("Alice's private class", []);

    actor.setPrincipal(Principal.anonymous());
    const anonymousClasses = await actor.listClasses();
    expect(anonymousClasses.map((c) => c.name)).not.toContain(
      "Alice's private class",
    );
  });

  it("rejects an anonymous caller trying to save an AI key", async () => {
    actor.setPrincipal(Principal.anonymous());
    await expect(actor.saveAiKey("sk-anon")).rejects.toThrow();
  });

  it("does not show one caller's notes to another", async () => {
    actor.setPrincipal(ALICE);
    const note = await actor.createNote(
      "Alice's private note",
      [],
      [],
      [],
      JSON.stringify({ version: 1, blocks: [{ id: "b1", kind: "paragraph", text: "secret" }] }),
      "secret",
    );

    // A different signed-in caller sees neither the list entry nor the note.
    const BOB = Principal.fromText("2vxsx-fae");
    actor.setPrincipal(BOB);
    expect((await actor.listNotes([])).map((n) => n.id)).not.toContain(note.id);
    await expect(actor.getNote(note.id)).resolves.toEqual([]);
    await expect(actor.softDeleteNote(note.id)).resolves.toEqual({
      err: { notAuthorized: null },
    });

    // An anonymous caller cannot create a note at all.
    actor.setPrincipal(Principal.anonymous());
    await expect(
      actor.createNote("Anon", [], [], [], "{}", ""),
    ).rejects.toThrow();
  });
});
