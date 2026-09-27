import { mergeCustomSessions } from "@/lib/customSync";
import type { LocalSession } from "@/lib/localSessions";
import { QuestionType, SessionMode } from "@/types";
import { describe, expect, it } from "vitest";

function session(id: string, completedAtMs: number): LocalSession {
  return {
    id,
    mode: SessionMode.timedTest,
    scopeLabel: `Scope ${id}`,
    questions: [],
    answers: {},
    startedAtMs: completedAtMs - 60_000,
    durationSeconds: 60,
    status: "completed",
    completedAtMs,
    results: [],
    score: 1,
    total: 1,
  };
}

describe("mergeCustomSessions", () => {
  it("unions both lists deduplicated by id, newest first", () => {
    const merged = mergeCustomSessions(
      [session("local-1", 3_000), session("shared", 1_000)],
      [session("shared", 1_000), session("server-1", 2_000)],
    );
    expect(merged.map((s) => s.id)).toEqual(["local-1", "server-1", "shared"]);
  });

  it("prefers the device copy of a shared id", () => {
    const device = { ...session("shared", 1_000), total: 5 };
    const mirrored = { ...session("shared", 1_000), total: 5, questions: [] };
    device.questions = [
      {
        id: 1n,
        prompt: "p",
        questionType: QuestionType.shortAnswer,
        options: [],
        correctAnswer: {
          __kind__: "shortAnswer",
          shortAnswer: { expected: "x" },
        },
        explanation: null,
        labels: {
          className: "c",
          subjectName: "s",
          chapterName: "ch",
          topicName: "t",
        },
      },
    ];
    const merged = mergeCustomSessions([device], [mirrored]);
    expect(merged).toHaveLength(1);
    expect(merged[0].questions).toHaveLength(1);
  });

  it("returns the server list unchanged in order when local is empty", () => {
    const merged = mergeCustomSessions(
      [],
      [session("a", 1_000), session("b", 2_000)],
    );
    expect(merged.map((s) => s.id)).toEqual(["b", "a"]);
  });
});
