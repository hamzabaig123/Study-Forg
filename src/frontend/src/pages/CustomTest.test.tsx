import {
  createLocalSession,
  getLocalSession,
  saveLocalAnswers,
} from "@/lib/localSessions";
import type { AssembledQuestion, TopicLabels } from "@/lib/sessionEngine";
import CustomTest from "@/pages/CustomTest";
import { makeMultipleChoiceAnswer } from "@/test/fixtures";
import { renderRoute } from "@/test/render";
import { QuestionType, SessionMode } from "@/types";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The finished run is mirrored to the account; the local store is what this page
// owns, and a fetch to a backend that is not mounted here proves nothing.
vi.mock("@/lib/customSync", () => ({ syncCustomSession: vi.fn() }));

const LABELS: TopicLabels = {
  className: "Class 11",
  subjectName: "Biology",
  chapterName: "Cell",
  topicName: "Organelles",
};

/** A multiple-choice question whose correct option is always id `1`. */
function question(id: bigint): AssembledQuestion {
  return {
    id,
    prompt: `Question ${id}`,
    questionType: QuestionType.multipleChoice,
    options: [
      { id: 1n, text: "Mitochondria" },
      { id: 2n, text: "Nucleus" },
    ],
    correctAnswer: makeMultipleChoiceAnswer(),
    explanation: null,
    labels: LABELS,
  };
}

function choice(optionId: bigint) {
  return {
    __kind__: "multipleChoice" as const,
    multipleChoice: { optionId },
  };
}

/**
 * Create a timed session with `Date.now` pinned to `startedAtMs`, then let the
 * clock run on for real — so the page mounts onto a run that expired while the
 * tab was closed.
 */
function timedSession(
  answers: Record<string, ReturnType<typeof choice>>,
  startedAtMs: number,
  durationSeconds: number,
): string {
  const now = vi.spyOn(Date, "now").mockReturnValue(startedAtMs);
  const session = createLocalSession({
    mode: SessionMode.timedTest,
    scopeLabel: "Biology",
    questions: [question(1n), question(2n), question(3n)],
    durationSeconds,
  });
  now.mockRestore();
  saveLocalAnswers(session.id, answers);
  return session.id;
}

async function open(id: string) {
  return renderRoute(<CustomTest />, {
    path: "/custom-test/$sessionId",
    initialPath: `/custom-test/${id}`,
  });
}

describe("CustomTest", () => {
  it("grades a rejoined-expired timed run with the answers already on the device", async () => {
    const id = timedSession(
      { "1": choice(1n), "2": choice(2n), "3": choice(1n) },
      Date.now() - 120_000,
      60,
    );

    await open(id);

    const finished = getLocalSession(id);
    expect(finished?.status).toBe("completed");
    // Two right, one wrong — not the 0/3 that grading an unhydrated answer map
    // records, which the same call then mirrors to the account as this
    // learner's day.
    expect(finished?.score).toBe(2);
    expect(
      finished?.results.map((result) => result.submitted !== null),
    ).toEqual([true, true, true]);
  });

  it("leaves a timed run that still has time on the clock open", async () => {
    const id = timedSession({ "1": choice(1n) }, Date.now(), 600);

    await open(id);

    expect(getLocalSession(id)?.status).toBe("active");
    expect(await screen.findByText("Question 1")).toBeInTheDocument();
  });
});
