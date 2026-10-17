import {
  type LocalQuestionResult,
  completeLocalSession,
  createLocalSession,
  deleteLocalSession,
  getLocalSession,
} from "@/lib/localSessions";
import TestHistory from "@/pages/TestHistory";
import TestHistoryDetail from "@/pages/TestHistoryDetail";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderRoute, renderWithProviders } from "@/test/render";
import {
  type AttemptSummary,
  QuestionType,
  SessionMode,
  type SessionResult,
} from "@/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NS_PER_MS = 1_000_000n;
const OCT_10 = Date.UTC(2026, 9, 10, 9, 0);

const LABELS = {
  className: "Class 11",
  subjectName: "Biology",
  chapterName: "Cell",
  topicName: "Organelles",
};

const summaries: AttemptSummary[] = [
  {
    id: 41n,
    completedAt: BigInt(OCT_10) * NS_PER_MS,
    total: 4n,
    mode: SessionMode.practice,
    scopeLabel: "Organelles",
    score: 3n,
  },
  {
    id: 42n,
    completedAt: BigInt(OCT_10 - 86_400_000) * NS_PER_MS,
    total: 5n,
    mode: SessionMode.timedTest,
    scopeLabel: "Photosynthesis",
    score: 2n,
  },
];

const options = [
  { id: 1n, text: "Nucleus" },
  { id: 2n, text: "Ribosome" },
];

const sessionResult: SessionResult = {
  id: 41n,
  scope: { __kind__: "topic", topic: 7n },
  mode: SessionMode.practice,
  startedAt: BigInt(OCT_10 - 125_000) * NS_PER_MS,
  completedAt: BigInt(OCT_10) * NS_PER_MS,
  score: 1n,
  total: 3n,
  results: [
    {
      questionId: 101n,
      prompt: "Which organelle holds the DNA?",
      questionType: QuestionType.multipleChoice,
      submitted: {
        __kind__: "multipleChoice",
        multipleChoice: { optionId: 1n },
      },
      correct: true,
      correctAnswer: {
        __kind__: "multipleChoice",
        multipleChoice: { correctOptionId: 1n, options },
      },
      explanation: "The nucleus stores the genome.",
    },
    {
      questionId: 102n,
      prompt: "Which organelle makes proteins?",
      questionType: QuestionType.multipleChoice,
      submitted: {
        __kind__: "multipleChoice",
        multipleChoice: { optionId: 1n },
      },
      correct: false,
      correctAnswer: {
        __kind__: "multipleChoice",
        multipleChoice: { correctOptionId: 2n, options },
      },
      explanation: undefined,
    },
    {
      questionId: 103n,
      prompt: "Mitochondria have their own DNA.",
      questionType: QuestionType.trueFalse,
      submitted: undefined,
      correct: false,
      correctAnswer: { __kind__: "trueFalse", trueFalse: { correct: true } },
      explanation: undefined,
    },
  ],
};

function finishLocalRun(title: string): string {
  const session = createLocalSession({
    mode: SessionMode.timedTest,
    scopeLabel: title,
    questions: [],
    durationSeconds: 600,
  });
  const results: LocalQuestionResult[] = [
    {
      questionId: "201",
      prompt: "Water boils at 100 °C at sea level.",
      questionType: QuestionType.trueFalse,
      submitted: { __kind__: "trueFalse", trueFalse: { value: true } },
      correct: true,
      correctAnswer: { __kind__: "trueFalse", trueFalse: { correct: true } },
      explanation: null,
      labels: LABELS,
    },
    {
      questionId: "202",
      prompt: "The cell wall is found in animal cells.",
      questionType: QuestionType.trueFalse,
      submitted: { __kind__: "trueFalse", trueFalse: { value: true } },
      correct: false,
      correctAnswer: { __kind__: "trueFalse", trueFalse: { correct: false } },
      explanation: "Only plant cells, fungi and bacteria have one.",
      labels: LABELS,
    },
  ];
  completeLocalSession(session.id, results);
  return session.id;
}

const created: string[] = [];

beforeEach(() => {
  setMockAuth(createAuthState({ isAuthenticated: true }));
});

afterEach(() => {
  for (const id of created.splice(0)) deleteLocalSession(id);
});

describe("TestHistory", () => {
  it("lists recorded sessions and this device's Test Builder runs together", async () => {
    created.push(finishLocalRun("Mixed biology revision"));
    setMockActor(
      createMockActor({
        getAttemptHistory: vi.fn().mockResolvedValue(summaries),
      }),
    );

    await renderWithProviders(<TestHistory />);

    expect(await screen.findByText("Organelles")).toBeInTheDocument();
    expect(screen.getByText("Photosynthesis")).toBeInTheDocument();
    expect(screen.getByText("Mixed biology revision")).toBeInTheDocument();
    expect(screen.getByText("Test Builder")).toBeInTheDocument();
    expect(screen.getByText("3 tests")).toBeInTheDocument();

    const tests = document.querySelector(
      '[data-ocid="history.stat_card.0"]',
    ) as HTMLElement;
    expect(within(tests).getByText("3")).toBeInTheDocument();

    const row = screen.getByRole("link", { name: /^Organelles, Practice/ });
    expect(row).toHaveAttribute("href", "/history/session/41");
    expect(within(row).getByText("75%")).toBeInTheDocument();
    expect(within(row).getByText("3/4")).toBeInTheDocument();
  });

  it("narrows the list by search and by mode", async () => {
    setMockActor(
      createMockActor({
        getAttemptHistory: vi.fn().mockResolvedValue(summaries),
      }),
    );
    const user = userEvent.setup();

    await renderWithProviders(<TestHistory />);
    await screen.findByText("Organelles");

    await user.type(screen.getByLabelText("Search tests"), "photo");
    expect(screen.getByText("1 of 2 tests")).toBeInTheDocument();
    expect(screen.queryByText("Organelles")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search tests"));
    await user.click(screen.getByRole("tab", { name: "Practice" }));
    expect(screen.getByText("Organelles")).toBeInTheDocument();
    expect(screen.queryByText("Photosynthesis")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Search tests"), "zzz");
    expect(screen.getByText(/no tests match/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Photosynthesis")).toBeInTheDocument();
  });

  it("shows the empty state when nothing has been finished", async () => {
    setMockActor(
      createMockActor({ getAttemptHistory: vi.fn().mockResolvedValue([]) }),
    );

    await renderWithProviders(<TestHistory />);

    expect(await screen.findByText("No tests yet")).toBeInTheDocument();
  });

  it("keeps the device's runs listed when the account history fails", async () => {
    created.push(finishLocalRun("Offline run"));
    setMockActor(
      createMockActor({
        getAttemptHistory: vi.fn().mockRejectedValue(new Error("offline")),
      }),
    );

    await renderWithProviders(<TestHistory />);

    expect(
      await screen.findByText(/only the tests saved on this device/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Offline run")).toBeInTheDocument();
  });

  it("shows the error state when there is nothing else to show", async () => {
    setMockActor(
      createMockActor({
        getAttemptHistory: vi.fn().mockRejectedValue(new Error("offline")),
      }),
    );

    await renderWithProviders(<TestHistory />);

    expect(
      await screen.findByText(/couldn't load your test history/i),
    ).toBeInTheDocument();
  });
});

describe("TestHistoryDetail", () => {
  it("reopens a recorded session with every question's verdict", async () => {
    setMockActor(
      createMockActor({
        getSessionResult: vi.fn().mockResolvedValue(sessionResult),
        getAttemptHistory: vi.fn().mockResolvedValue(summaries),
      }),
    );
    const user = userEvent.setup();

    await renderRoute(<TestHistoryDetail />, {
      path: "/history/$kind/$id",
      initialPath: "/history/session/41",
    });

    expect(
      await screen.findByRole("heading", { name: "Organelles" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 3 correct")).toBeInTheDocument();
    expect(screen.getByText("2m 5s")).toBeInTheDocument();

    const wrong = document.querySelector(
      '[data-ocid="history_detail.review_item.2"]',
    ) as HTMLElement;
    expect(wrong).toHaveAttribute("data-status", "wrong");
    // The submitted option is named by its text, not its id.
    expect(within(wrong).getByText("Nucleus")).toBeInTheDocument();
    expect(within(wrong).getByText("Ribosome")).toBeInTheDocument();

    const skipped = document.querySelector(
      '[data-ocid="history_detail.review_item.3"]',
    ) as HTMLElement;
    expect(within(skipped).getByText("Skipped")).toBeInTheDocument();
    expect(within(skipped).getByText("Not answered")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Wrong/ }));
    const items = document.querySelectorAll(
      '[data-ocid^="history_detail.review_item."]',
    );
    expect(items).toHaveLength(1);
    // A filtered view keeps the test's own question numbers.
    expect(within(items[0] as HTMLElement).getByText("Q2")).toBeInTheDocument();

    // Recorded sessions off Supabase have no delete path.
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();
  });

  it("deletes a Test Builder run from this device", async () => {
    const id = finishLocalRun("Cell biology quiz");
    created.push(id);
    setMockActor(createMockActor({}));
    const user = userEvent.setup();

    await renderRoute(<TestHistoryDetail />, {
      path: "/history/$kind/$id",
      initialPath: `/history/custom/${id}`,
    });

    expect(
      await screen.findByRole("heading", { name: "Cell biology quiz" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Only plant cells, fungi and bacteria have one."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: "Delete test" }));

    await waitFor(() => expect(getLocalSession(id)).toBeNull());
  });

  it("says so when the test is not in the history", async () => {
    setMockActor(
      createMockActor({
        getSessionResult: vi.fn().mockResolvedValue(null),
        getAttemptHistory: vi.fn().mockResolvedValue([]),
      }),
    );

    await renderRoute(<TestHistoryDetail />, {
      path: "/history/$kind/$id",
      initialPath: "/history/session/999",
    });

    expect(
      await screen.findByText("This test isn't in your history"),
    ).toBeInTheDocument();
  });

  it("rejects an unknown kind without asking the backend", async () => {
    const getSessionResult = vi.fn();
    setMockActor(createMockActor({ getSessionResult }));

    await renderRoute(<TestHistoryDetail />, {
      path: "/history/$kind/$id",
      initialPath: "/history/quiz/41",
    });

    expect(
      await screen.findByText("This test isn't in your history"),
    ).toBeInTheDocument();
    expect(getSessionResult).not.toHaveBeenCalled();
  });
});
