import TimedTest from "@/pages/TimedTest";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makeSessionView } from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderRoute } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A timed session that started at `now`, so the countdown has time left. */
function makeTimedSession(now = Date.now(), overrides = {}) {
  return makeSessionView({
    mode: "timedTest" as never,
    startedAt: BigInt(now) * 1_000_000n,
    durationSeconds: 600n,
    ...overrides,
  });
}

function renderTimed(sessionId = "7") {
  return renderRoute(<TimedTest />, {
    path: "/test/$sessionId",
    initialPath: `/test/${sessionId}`,
  });
}

describe("TimedTest", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("renders the question, the answer controls, and a visible countdown", async () => {
    // The label is derived from Date.now() at render time, so the clock is
    // pinned to the instant the session claims it started. Without this a
    // loaded worker can tick past the second boundary and read 09:59.
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(makeTimedSession(now)),
    });
    setMockActor(actor);

    await renderTimed();

    expect(
      await screen.findByText("Which organelle produces ATP?"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mitochondria/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/remaining/i)).toBeInTheDocument();
    // 600s allotted, started just now → 10:00 remaining.
    expect(screen.getByText("10:00")).toBeInTheDocument();
    nowSpy.mockRestore();
  });

  it("records the selected answer and completes the session on submit", async () => {
    const user = userEvent.setup();
    const submitAnswer = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { correct: true },
    });
    const completeSession = vi.fn().mockResolvedValue({
      __kind__: "ok",
      ok: { id: 7n },
    });
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(makeTimedSession()),
      submitAnswer,
      completeSession,
    });
    setMockActor(actor);

    await renderTimed();

    await user.click(
      await screen.findByRole("button", { name: /mitochondria/i }),
    );
    await user.click(screen.getByRole("button", { name: /submit test/i }));

    await waitFor(() => {
      expect(submitAnswer).toHaveBeenCalledTimes(1);
    });
    expect(submitAnswer.mock.calls[0][0]).toEqual({
      sessionId: 7n,
      questionId: 10n,
      answer: {
        __kind__: "multipleChoice",
        multipleChoice: { optionId: 1n },
      },
    });
    await waitFor(() => {
      expect(completeSession).toHaveBeenCalledWith(7n);
    });
  });

  it("shows a retryable error and does not complete when an answer fails to save", async () => {
    const user = userEvent.setup();
    const submitAnswer = vi.fn().mockResolvedValue({
      __kind__: "err",
      err: { notFound: null },
    });
    const completeSession = vi.fn();
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(makeTimedSession()),
      submitAnswer,
      completeSession,
    });
    setMockActor(actor);

    await renderTimed();

    await user.click(
      await screen.findByRole("button", { name: /mitochondria/i }),
    );
    await user.click(screen.getByRole("button", { name: /submit test/i }));

    expect(await screen.findByText(/couldn't be saved/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
    expect(completeSession).not.toHaveBeenCalled();
  });

  it("shows the unavailable state when the test cannot be loaded", async () => {
    const actor = createMockActor({
      getSession: vi.fn().mockResolvedValue(null),
    });
    setMockActor(actor);

    await renderTimed();

    expect(
      await screen.findByText(/this test is no longer available/i),
    ).toBeInTheDocument();
  });
});
