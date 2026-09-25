import { parseAiExtractionJson } from "@/lib/ai/aiClient";
import { extractQuestionsHeuristically } from "@/lib/ai/documentExtractor";
import { describe, expect, it } from "vitest";

describe("Document & Heuristic Extraction", () => {
  it("extracts multiple choice questions with options and detected answer", () => {
    const sampleText = `
1. What is the process of water movement through a plant and its evaporation?
A) Respiration
B) Transpiration
C) Photosynthesis
D) Osmosis
Answer: B
Explanation: Transpiration is the biological process by which water is lost in the form of water vapor.

2. State Newton's Second Law of Motion.
Ans: Force equals mass times acceleration (F = ma).
    `;

    const candidates = extractQuestionsHeuristically(sampleText);
    expect(candidates.length).toBe(2);

    // Question 1: MCQ
    expect(candidates[0].type).toBe("mcq");
    expect(candidates[0].question).toContain(
      "What is the process of water movement",
    );
    expect(candidates[0].options?.length).toBe(4);
    expect(candidates[0].options?.[1]).toBe("Transpiration");
    expect(candidates[0].correctAnswer).toBe("B");
    expect(candidates[0].inferred).toBe(false);
    expect(candidates[0].explanation).toContain(
      "Transpiration is the biological process",
    );

    // Question 2: Short QA
    expect(candidates[1].type).toBe("short_qa");
    expect(candidates[1].question).toContain("State Newton's Second Law");
    expect(candidates[1].correctAnswer).toContain("F = ma");
  });

  it("handles questions without explicit answer key by marking inferred: true", () => {
    const sample = `
1. Which organelle is known as the powerhouse of the cell?
(A) Nucleus
(B) Mitochondria
(C) Ribosome
(D) Endoplasmic Reticulum
    `;
    const candidates = extractQuestionsHeuristically(sample);
    expect(candidates.length).toBe(1);
    expect(candidates[0].type).toBe("mcq");
    expect(candidates[0].inferred).toBe(true);
  });
});

describe("AI JSON Structuring & Sanitization", () => {
  it("parses valid JSON response from AI", () => {
    const rawAiResponse = JSON.stringify({
      items: [
        {
          type: "mcq",
          question: "What is the unit of electrical resistance?",
          options: ["Ampere", "Volt", "Ohm", "Watt"],
          correctAnswer: "C",
          explanation: "Ohm (Ω) is the SI unit of electrical resistance.",
          inferred: false,
        },
        {
          type: "short_qa",
          question: "Explain the greenhouse effect.",
          correctAnswer:
            "The warming of Earth's surface caused by greenhouse gases trapping heat.",
          explanation: null,
          inferred: false,
        },
      ],
    });

    const parsed = parseAiExtractionJson(rawAiResponse);
    expect(parsed.length).toBe(2);
    expect(parsed[0].type).toBe("mcq");
    expect(parsed[0].correctAnswer).toBe("C");
    expect(parsed[0].options?.length).toBe(4);
    expect(parsed[1].type).toBe("short_qa");
    expect(parsed[1].correctAnswer).toContain("warming of Earth's surface");
  });

  it("strips markdown fences and repairs trailing commas from LLM output", () => {
    const fencedOutput = `
Here is the extracted questions list:
\`\`\`json
{
  "items": [
    {
      "type": "mcq",
      "question": "Which planet is closest to the Sun?",
      "options": ["Venus", "Mercury", "Earth", "Mars"],
      "correctAnswer": "B",
      "explanation": "Mercury is the closest planet.",
    },
  ]
}
\`\`\`
Hope this helps!
    `;

    const parsed = parseAiExtractionJson(fencedOutput);
    expect(parsed.length).toBe(1);
    expect(parsed[0].question).toContain("Which planet is closest to the Sun?");
    expect(parsed[0].correctAnswer).toBe("B");
  });

  it("normalizes numeric answers like '2' or 'B) Mercury' to single letter 'B'", () => {
    const messyOutput = JSON.stringify({
      items: [
        {
          type: "mcq",
          question: "Sample Question",
          options: ["A) Red", "B) Blue", "C) Green"],
          correctAnswer: "2",
        },
      ],
    });

    const parsed = parseAiExtractionJson(messyOutput);
    expect(parsed[0].correctAnswer).toBe("B");
    expect(parsed[0].options?.[0]).toBe("Red");
  });
});
