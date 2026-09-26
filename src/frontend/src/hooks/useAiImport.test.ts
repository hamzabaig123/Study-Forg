import { importCheck } from "@/hooks/useAiImport";
import type { QuestionDraft } from "@/lib/ai/questions";
import { describe, expect, it } from "vitest";

function draft(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return {
    id: "draft-1",
    kind: "mcq",
    question: "Which of these is a saturated hydrocarbon?",
    options: ["Methane", "Ethene", "Ethyne", "Benzene"],
    correctIndex: 0,
    answer: "Methane",
    explanation: "Alkanes are saturated.",
    inferred: false,
    page: 3,
    ...overrides,
  };
}

/** The reason the draft cannot be saved, or "" when it can. */
function reason(source: QuestionDraft): string {
  return importCheck(source)?.reason ?? "";
}

describe("importCheck", () => {
  it("accepts a complete MCQ", () => {
    expect(importCheck(draft())).toBeNull();
  });

  it("refuses a question with no stem", () => {
    expect(reason(draft({ question: "  " }))).toMatch(/question text is empty/);
  });

  it("refuses an MCQ with fewer than two options", () => {
    expect(reason(draft({ options: ["Methane", ""] }))).toMatch(
      /at least two options/,
    );
  });

  it("refuses an MCQ with a blank option", () => {
    expect(reason(draft({ options: ["Methane", "", "Ethyne"] }))).toMatch(
      /option is blank/,
    );
  });

  it("refuses an MCQ whose two options say the same thing", () => {
    // Either marked option is correct, so the question cannot be practised.
    expect(
      reason(draft({ options: ["Methane", "methane", "Ethyne"] })),
    ).toMatch(/identical/);
  });

  it("refuses an MCQ with no usable option marked correct", () => {
    expect(reason(draft({ correctIndex: null, answer: "" }))).toMatch(
      /no option is marked correct/,
    );
    expect(reason(draft({ correctIndex: 4 }))).toMatch(
      /no option is marked correct/,
    );
    expect(reason(draft({ correctIndex: -1 }))).toMatch(
      /no option is marked correct/,
    );
  });

  it("refuses a Q&A with no answer", () => {
    expect(
      reason(
        draft({ kind: "qa", options: [], correctIndex: null, answer: " " }),
      ),
    ).toMatch(/answer is empty/);
  });
});
