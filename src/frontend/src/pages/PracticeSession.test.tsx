import PracticeSession from "@/pages/PracticeSession";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makeFeedback, makeSessionView } from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderRoute } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

function renderPractice(sessionId = "7") {
  return renderRoute(<PracticeSession />, {
    path: "/practice/$sessionId",
    initialPath: `/practice/${sessionId}`,
  });
}

describe("PracticeSession", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("renders the current question with its type-appropriate controls", async () => {
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(makeSessionView()),
    });
    setMockActor(actor);

    await renderPractice();

    expect(
      await screen.findByText("Which organelle produces ATP?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/question 1 of 1/i)).toBeInTheDocument();
    expect(screen.getByText(/multiple choice/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mitochondria/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /nucleus/i }),
    ).toBeInTheDocument();
  });

  it("submits the selected answer and shows immediate feedback", async () => {
    const user = userEvent.setup();
    const submitAnswer = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: makeFeedback({ correct: true }),
    });
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(makeSessionView()),
      submitAnswer,
    });
    setMockActor(actor);

    await renderPractice();

    await user.click(
      await screen.findByRole("button", { name: /mitochondria/i }),
    );
    await user.click(screen.getByRole("button", { name: /check answer/i }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledTimes(1);
    });
    const request = submitAnswer.mock.calls[0][0];
    expect(request.sessionId).toBe(7n);
    expect(request.questionId).toBe(10n);
    expect(request.answer).toEqual({
      __kind__: "multipleChoice",
      multipleChoice: { optionId: 1n },
    });

    expect(await screen.findByText("Correct")).toBeInTheDocument();
    expect(screen.getByText(/oxidative phosphorylation/i)).toBeInTheDocument();
  });

  it("shows the correct answer and explanation when the answer is wrong", async () => {
    const user = userEvent.setup();
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(makeSessionView()),
      submitAnswer: vi.fn().mockResolvedValue({
        __kind__: "ok",
        ok: makeFeedback({ correct: false }),
      }),
    });
    setMockActor(actor);

    await renderPractice();

    await user.click(await screen.findByRole("button", { name: /nucleus/i }));
    await user.click(screen.getByRole("button", { name: /check answer/i }));

    expect(await screen.findByText("Not quite")).toBeInTheDocument();
    expect(screen.getByText(/correct answer:/i)).toBeInTheDocument();
    const feedback = document.querySelector('[data-ocid="practice.feedback"]');
    expect(feedback).not.toBeNull();
    expect(feedback?.textContent).toContain("Mitochondria");
  });

  it("renders true/false controls for a true-false question", async () => {
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(
        makeSessionView({
          questions: [
            {
              id: 11n,
              questionType: "trueFalse" as never,
              prompt: "The mitochondria is the powerhouse of the cell.",
              options: [],
            },
          ],
        }),
      ),
    });
    setMockActor(actor);

    await renderPractice();

    expect(
      await screen.findByText(/powerhouse of the cell/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^true$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^false$/i }),
    ).toBeInTheDocument();
  });

  it("renders a text input for a short-answer question", async () => {
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(
        makeSessionView({
          questions: [
            {
              id: 12n,
              questionType: "shortAnswer" as never,
              prompt: "Name the powerhouse of the cell.",
              options: [],
            },
          ],
        }),
      ),
    });
    setMockActor(actor);

    await renderPractice();

    expect(
      await screen.findByText(/name the powerhouse of the cell/i),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/type your answer/i),
    ).toBeInTheDocument();
  });

  it("shows the unavailable state when the session cannot be loaded", async () => {
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(null),
    });
    setMockActor(actor);

    await renderPractice();

    expect(
      await screen.findByText(/this session is no longer available/i),
    ).toBeInTheDocument();
  });
});
