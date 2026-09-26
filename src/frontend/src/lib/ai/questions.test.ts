/**
 * Unit coverage for the two parsers that fill the review queue.
 *
 * The model path is exercised through its text contract only — a real API call
 * is never made here — because the risk this file guards against is the
 * normalisation step: a letter, ordinal or free-text answer has to land on the
 * same `correctIndex` before a draft reaches the question bank.
 */

import {
  countInferred,
  parseModelResponse,
  parseTextWithRules,
} from "@/lib/ai/questions";
import { describe, expect, it } from "vitest";

describe("parseModelResponse", () => {
  it("reads a fenced JSON reply and normalises a letter answer", () => {
    const payload = {
      items: [
        {
          question: "Which gas do plants absorb?",
          type: "mcq",
          options: ["A) Oxygen", "B) Carbon dioxide", "C) Nitrogen"],
          correctAnswer: "B",
          explanation: "Photosynthesis takes in CO2.",
          sourcePage: 2,
        },
      ],
    };

    const drafts = parseModelResponse(
      `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
    );

    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    expect(draft.kind).toBe("mcq");
    expect(draft.options).toEqual(["Oxygen", "Carbon dioxide", "Nitrogen"]);
    expect(draft.correctIndex).toBe(1);
    expect(draft.answer).toBe("Carbon dioxide");
    expect(draft.explanation).toBe("Photosynthesis takes in CO2.");
    expect(draft.page).toBe(2);
    expect(draft.inferred).toBe(false);
  });

  it("keeps a short-answer item as Q&A even when the model sent options", () => {
    const drafts = parseModelResponse(
      JSON.stringify({
        items: [
          {
            question: "State Newton's first law of motion.",
            type: "short_answer",
            options: ["", ""],
            answer: "A body stays at rest unless a force acts on it.",
          },
        ],
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].kind).toBe("qa");
    expect(drafts[0].options).toEqual([]);
    expect(drafts[0].correctIndex).toBeNull();
    expect(drafts[0].answer).toBe(
      "A body stays at rest unless a force acts on it.",
    );
  });

  it("repairs a trailing comma and reads a bare array", () => {
    const drafts = parseModelResponse(
      'Sure — here you go:\n{"items":[{"question":"What is 2 + 2?","options":["A) 3","B) 4"],"answer":"2"},]}',
    );

    expect(drafts).toHaveLength(1);
    // A numeric answer is an ordinal, not an index.
    expect(drafts[0].correctIndex).toBe(1);
  });

  it("leaves an MCQ unmarked rather than guessing option A", () => {
    const drafts = parseModelResponse(
      JSON.stringify({
        items: [
          {
            question: "Which of these is a prime number?",
            type: "mcq",
            options: ["8", "9", "11"],
            answer: "None of the above",
          },
        ],
      }),
    );

    expect(drafts).toHaveLength(1);
    expect(drafts[0].inferred).toBe(true);
    // Defaulting to A here would store a wrong answer that an "approve all"
    // review never looked at; unmarked means it cannot be saved until marked.
    expect(drafts[0].correctIndex).toBeNull();
    expect(drafts[0].answer).toBe("");
  });

  it("keeps the answered letter on its own option when a blank one is dropped", () => {
    const drafts = parseModelResponse(
      JSON.stringify({
        items: [
          {
            question: "The unit 'mole' measures which quantity?",
            type: "mcq",
            options: [
              "A) Amount of substance",
              "B) Mass",
              "",
              "D) Number of atoms",
            ],
            answer: "D",
          },
        ],
      }),
    );

    const draft = drafts[0];
    expect(draft.options).toEqual([
      "Amount of substance",
      "Mass",
      "Number of atoms",
    ]);
    // "D" is the printed fourth choice, which is the third one that survived.
    expect(draft.correctIndex).toBe(2);
    expect(draft.answer).toBe("Number of atoms");
    expect(draft.inferred).toBe(false);
  });

  it("treats a numeric answer as the printed position, not the kept one", () => {
    const drafts = parseModelResponse(
      JSON.stringify({
        items: [
          {
            question: "Which statement is correct?",
            type: "mcq",
            options: ["first", "", "third"],
            answer: "3",
          },
        ],
      }),
    );

    expect(drafts[0].options).toEqual(["first", "third"]);
    expect(drafts[0].correctIndex).toBe(1);
    expect(drafts[0].inferred).toBe(false);
  });

  it("throws instead of returning an empty queue for a non-JSON reply", () => {
    expect(() => parseModelResponse("I could not read that page.")).toThrow(
      /not valid JSON/i,
    );
  });
});

describe("parseTextWithRules", () => {
  it("reads numbered MCQs with lettered options and an answer line", () => {
    const text = `1. Which gas do plants absorb?
A) Oxygen
B) Carbon dioxide
C) Nitrogen
D) Hydrogen
Answer: B
Explanation: Plants take in CO2 for photosynthesis.

2. Which planet is closest to the Sun?
(A) Earth
(B) Venus
(C) Mercury
Answer: 3
`;

    const drafts = parseTextWithRules(text);

    expect(drafts).toHaveLength(2);
    const [first, second] = drafts;
    expect(first.question).toBe("Which gas do plants absorb?");
    expect(first.options).toHaveLength(4);
    expect(first.correctIndex).toBe(1);
    expect(first.answer).toBe("Carbon dioxide");
    expect(first.explanation).toBe("Plants take in CO2 for photosynthesis.");
    expect(first.inferred).toBe(false);
    expect(second.options).toEqual(["Earth", "Venus", "Mercury"]);
    expect(second.correctIndex).toBe(2);
    expect(second.inferred).toBe(false);
  });

  it("falls back to Q&A and flags an answer the text never states", () => {
    const drafts = parseTextWithRules(
      "Q1. Define photosynthesis.\n\nQ2. What is the SI unit of force?\nAnswer: newton",
    );

    expect(drafts.map((draft) => draft.kind)).toEqual(["qa", "qa"]);
    expect(drafts[0].answer).toBe("");
    expect(drafts[0].inferred).toBe(true);
    expect(drafts[1].answer).toBe("newton");
    expect(drafts[1].inferred).toBe(false);
    expect(countInferred(drafts)).toBe(1);
  });

  it("keeps section headings out of the stems", () => {
    const drafts = parseTextWithRules(`Section A - Multiple Choice

1. Which planet is closest to the Sun?
A) Earth
B) Venus
C) Mercury

Section B - Short Answer

2. Define photosynthesis.
Answer: Making food from light.`);

    expect(drafts).toHaveLength(2);
    expect(drafts[0].question).toBe("Which planet is closest to the Sun?");
    expect(drafts[1].question).toBe("Define photosynthesis.");
  });

  it("returns nothing for prose that has no numbered questions", () => {
    expect(
      parseTextWithRules("A page of chapter notes with no questions."),
    ).toEqual([]);
    expect(parseTextWithRules("   \n  ")).toEqual([]);
  });
});
