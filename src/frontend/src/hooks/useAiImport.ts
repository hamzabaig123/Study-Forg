/**
 * Writing reviewed drafts into the question bank.
 *
 * The canister takes one question at a time, so a batch is a loop that keeps
 * going after a failure and reports both counts — losing 30 approved drafts to
 * one bad topic would be worse than a partial import.
 */

import { useCreateQuestion } from "@/hooks/useContent";
import type { QuestionDraft } from "@/lib/ai/questions";
import { type StudioDraft, useStudioStore } from "@/lib/ai/studioStore";
import { type AnswerData, QuestionType } from "@/types";
import type { Id } from "@/types";
import { useState } from "react";

interface ImportProblem {
  reason: string;
}

/** Whether a draft can become a question, and what is missing if it cannot. */
export function importCheck(draft: QuestionDraft): ImportProblem | null {
  if (draft.question.trim().length < 3) {
    return { reason: "the question text is empty" };
  }
  if (draft.kind === "mcq") {
    const filled = draft.options.filter((option) => option.trim());
    if (filled.length < 2) {
      return { reason: "an MCQ needs at least two options" };
    }
    if (filled.length !== draft.options.length) {
      return { reason: "an option is blank" };
    }
    if (
      new Set(filled.map((option) => option.trim().toLowerCase())).size !==
      filled.length
    ) {
      return {
        reason: "two options are identical, so the answer is ambiguous",
      };
    }
    const index = draft.correctIndex;
    if (index === null || index < 0 || index >= draft.options.length) {
      return { reason: "no option is marked correct" };
    }
    if (!draft.options[index].trim()) {
      return { reason: "the marked correct option is blank" };
    }
    return null;
  }
  if (!draft.answer.trim()) return { reason: "the answer is empty" };
  return null;
}

function toAnswerData(draft: QuestionDraft): AnswerData {
  if (draft.kind === "mcq") {
    const options = draft.options.map((text, index) => ({
      id: BigInt(index + 1),
      text,
    }));
    const correct = options[draft.correctIndex ?? 0] ?? options[0];
    return {
      __kind__: "multipleChoice",
      multipleChoice: {
        options,
        correctOptionId: correct.id,
      },
    };
  }
  return {
    __kind__: "shortAnswer",
    shortAnswer: { expected: draft.answer.trim() },
  };
}

interface ImportResult {
  saved: number;
  skipped: number;
}

export function useAiImport() {
  const createQuestion = useCreateQuestion();
  const markSaved = useStudioStore((state) => state.markSaved);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [isImportingAll, setIsImportingAll] = useState(false);

  const importOne = async (
    draft: StudioDraft,
    topicId: Id,
  ): Promise<ImportResult> => {
    const problem = importCheck(draft);
    if (problem) return { saved: 0, skipped: 1 };

    const created = await createQuestion.mutateAsync({
      topicId,
      prompt: draft.question.trim(),
      questionType:
        draft.kind === "mcq"
          ? QuestionType.multipleChoice
          : QuestionType.shortAnswer,
      answer: toAnswerData(draft),
      explanation: draft.explanation.trim() || null,
    });
    markSaved(draft.id, created.id.toString());
    return { saved: 1, skipped: 0 };
  };

  const importDraft = async (
    draft: StudioDraft,
    topicId: Id,
  ): Promise<ImportResult> => {
    setImportingId(draft.id);
    try {
      return await importOne(draft, topicId);
    } finally {
      setImportingId(null);
    }
  };

  const importApproved = async (
    drafts: StudioDraft[],
    topicId: Id,
  ): Promise<ImportResult & { failures: string[] }> => {
    const approved = drafts.filter((draft) => draft.status === "approved");
    setIsImportingAll(true);
    let saved = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const draft of approved) {
      try {
        const result = await importOne(draft, topicId);
        saved += result.saved;
        skipped += result.skipped;
      } catch (cause) {
        skipped += 1;
        // Keep the reason — a batch that lost rows should be able to say why
        // instead of a bare "skipped" count.
        failures.push(
          `${draft.question.trim().slice(0, 60) || "Untitled draft"}: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        );
      }
    }

    setIsImportingAll(false);
    return { saved, skipped, failures };
  };

  return { importDraft, importApproved, importingId, isImportingAll };
}
