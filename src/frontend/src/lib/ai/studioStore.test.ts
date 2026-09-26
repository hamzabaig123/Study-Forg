/**
 * The review queue is the only place a draft exists between extraction and the
 * question bank, so its transitions are covered here rather than through the
 * cards: a draft that loses its status or its saved id on a patch would either
 * reappear in a batch import or silently never get written.
 */

import type { QuestionDraft } from "@/lib/ai/questions";
import {
  countByStatus,
  filterDrafts,
  useStudioStore,
} from "@/lib/ai/studioStore";
import { beforeEach, describe, expect, it } from "vitest";

function draft(over: Partial<QuestionDraft> & { id: string }): QuestionDraft {
  return {
    kind: "mcq",
    question: `Question ${over.id}?`,
    options: ["One", "Two"],
    correctIndex: 1,
    answer: "Two",
    explanation: "",
    inferred: false,
    page: null,
    ...over,
  };
}

const SOURCE = {
  fileName: "paper-1.pdf",
  engine: "offline" as const,
  providerName: null,
  missing: [] as number[],
};

beforeEach(() => {
  window.localStorage.clear();
  useStudioStore.setState({
    drafts: [],
    source: null,
    target: { classId: null, subjectId: null, chapterId: null, topicId: null },
    filters: { status: "all", kind: "all", query: "" },
  });
});

describe("useStudioStore queue", () => {
  it("starts every extracted draft as pending and keeps the chosen target", () => {
    useStudioStore.getState().setTarget({ topicId: "44" });
    useStudioStore
      .getState()
      .replaceQueue([draft({ id: "a" }), draft({ id: "b" })], SOURCE);

    const state = useStudioStore.getState();
    expect(state.drafts.map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(state.drafts.every((item) => item.savedQuestionId === null)).toBe(
      true,
    );
    expect(state.source?.fileName).toBe("paper-1.pdf");
    expect(state.target.topicId).toBe("44");
  });

  it("carries an edit through without resetting the status", () => {
    const { replaceQueue, patchDraft, setDraftStatus } =
      useStudioStore.getState();
    replaceQueue([draft({ id: "a" })], SOURCE);
    setDraftStatus("a", "approved");
    patchDraft("a", { correctIndex: 0, answer: "One" });

    const [only] = useStudioStore.getState().drafts;
    expect(only.status).toBe("approved");
    expect(only.correctIndex).toBe(0);
    expect(only.answer).toBe("One");
  });

  it("marks a saved draft imported and records the question id", () => {
    const { replaceQueue, markSaved } = useStudioStore.getState();
    replaceQueue([draft({ id: "a" })], SOURCE);
    markSaved("a", "907");

    const [only] = useStudioStore.getState().drafts;
    expect(only.status).toBe("imported");
    expect(only.savedQuestionId).toBe("907");
  });

  it("approves every pending draft but leaves rejected and saved ones alone", () => {
    const { replaceQueue, setDraftStatus, approveAllPending } =
      useStudioStore.getState();
    replaceQueue(
      [draft({ id: "a" }), draft({ id: "b" }), draft({ id: "c" })],
      SOURCE,
    );
    setDraftStatus("b", "rejected");
    setDraftStatus("c", "imported");
    approveAllPending();

    expect(
      useStudioStore
        .getState()
        .drafts.map((item) => `${item.id}:${item.status}`),
    ).toEqual(["a:approved", "b:rejected", "c:imported"]);
  });

  it("clears the queue but keeps the target for the next upload", () => {
    useStudioStore.getState().setTarget({ topicId: "44" });
    useStudioStore.getState().replaceQueue([draft({ id: "a" })], SOURCE);
    useStudioStore.getState().clearQueue();

    const state = useStudioStore.getState();
    expect(state.drafts).toEqual([]);
    expect(state.source).toBeNull();
    expect(state.target.topicId).toBe("44");
  });

  it("merges a retry without duplicating a page or resetting a reviewed draft", () => {
    const { replaceQueue, mergeDrafts, setDraftStatus } =
      useStudioStore.getState();
    replaceQueue([draft({ id: "a", page: 3 }), draft({ id: "b", page: 4 })], {
      ...SOURCE,
      missing: [5],
    });
    setDraftStatus("a", "approved");
    // Left on the "approved" slice, the retried pages would look lost.
    useStudioStore.getState().setFilters({ status: "approved" });

    // A retry re-reads what it can and may cover page 4 again on the way. The
    // repeat must not queue twice, and the reviewed page must stay reviewed.
    mergeDrafts(
      [
        draft({ id: "again", page: 4, question: "Question b?" }),
        draft({ id: "c", page: 5 }),
      ],
      { ...SOURCE, missing: [] },
    );

    const state = useStudioStore.getState();
    expect(state.filters.status).toBe("all");
    expect(state.drafts.map((item) => `${item.page}:${item.status}`)).toEqual([
      "3:approved",
      "4:pending",
      "5:pending",
    ]);
    expect(state.source?.missing).toEqual([]);
  });
});

describe("queue filters and counts", () => {
  beforeEach(() => {
    useStudioStore.getState().replaceQueue(
      [
        draft({ id: "a", question: "Which gas do plants absorb?" }),
        draft({
          id: "b",
          kind: "qa",
          question: "Define photosynthesis.",
          options: [],
          correctIndex: null,
          answer: "Plants making food from light.",
        }),
      ],
      SOURCE,
    );
    useStudioStore.getState().setDraftStatus("b", "approved");
  });

  it("filters by status and kind", () => {
    const { drafts } = useStudioStore.getState();
    expect(
      filterDrafts(drafts, { status: "approved", kind: "all", query: "" }).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
    expect(
      filterDrafts(drafts, { status: "all", kind: "mcq", query: "" }).map(
        (item) => item.id,
      ),
    ).toEqual(["a"]);
  });

  it("searches stems, answers and options", () => {
    const { drafts } = useStudioStore.getState();
    const search = (query: string) =>
      filterDrafts(drafts, { status: "all", kind: "all", query }).map(
        (item) => item.id,
      );

    expect(search("photosynthesis")).toEqual(["b"]);
    expect(search("which gas")).toEqual(["a"]);
    expect(search("")).toEqual(["a", "b"]);
  });

  it("counts drafts by status", () => {
    expect(countByStatus(useStudioStore.getState().drafts)).toEqual({
      pending: 1,
      approved: 1,
      imported: 0,
      rejected: 0,
    });
  });
});
