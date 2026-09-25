import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type AnswerData, type DraftQuestion, QuestionType } from "@/types";
import { Check, HelpCircle, Lightbulb, Trash2 } from "lucide-react";

const TYPE_LABEL: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

/** The correct answer rendered as readable text for any answer shape. */
function answerSummary(answer: AnswerData): string {
  switch (answer.__kind__) {
    case "multipleChoice": {
      const correct = answer.multipleChoice.options.find(
        (option) => option.id === answer.multipleChoice.correctOptionId,
      );
      return correct ? correct.text : "No correct option set";
    }
    case "trueFalse":
      return answer.trueFalse.correct ? "True" : "False";
    case "shortAnswer":
      return answer.shortAnswer.expected;
    default:
      return "—";
  }
}

interface DraftQuestionCardProps {
  draft: DraftQuestion;
  index: number;
  isAccepting?: boolean;
  isDiscarding?: boolean;
  onAccept: (draft: DraftQuestion) => void;
  onDiscard: (draft: DraftQuestion) => void;
}

/**
 * A single AI-generated draft preview. Shows the prompt, its type, the answer
 * data, and the explanation, with accept and discard actions.
 */
export function DraftQuestionCard({
  draft,
  index,
  isAccepting = false,
  isDiscarding = false,
  onAccept,
  onDiscard,
}: DraftQuestionCardProps) {
  const busy = isAccepting || isDiscarding;
  const options =
    draft.answer.__kind__ === "multipleChoice"
      ? draft.answer.multipleChoice.options
      : [];

  return (
    <Card
      data-ocid={`ai.draft_card.${index + 1}`}
      className="animate-fade-up gap-0 overflow-hidden rounded-xl border-border bg-card p-0 shadow-subtle"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="numeric text-xs font-semibold text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <Badge
            variant="secondary"
            className="rounded-full bg-accent/12 text-accent"
          >
            {TYPE_LABEL[draft.questionType]}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-ocid={`ai.discard_button.${index + 1}`}
            disabled={busy}
            onClick={() => onDiscard(draft)}
            className="rounded-lg text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Discard
          </Button>
          <Button
            type="button"
            size="sm"
            data-ocid={`ai.accept_button.${index + 1}`}
            disabled={busy}
            onClick={() => onAccept(draft)}
            className="rounded-lg bg-primary text-primary-foreground shadow-subtle transition-smooth hover:shadow-elevated"
          >
            <Check className="size-4" aria-hidden="true" />
            {isAccepting ? "Accepting…" : "Accept"}
          </Button>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        <p className="font-display text-lg leading-snug text-card-foreground">
          {draft.prompt}
        </p>

        {options.length > 0 ? (
          <ul className="space-y-1.5">
            {options.map((option) => {
              const isCorrect =
                draft.answer.__kind__ === "multipleChoice" &&
                option.id === draft.answer.multipleChoice.correctOptionId;
              return (
                <li
                  key={option.id.toString()}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                    isCorrect
                      ? "border-success/40 bg-success/10 text-foreground"
                      : "border-border bg-background text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      isCorrect
                        ? "border-success bg-success text-success-foreground"
                        : "border-border",
                    )}
                    aria-hidden="true"
                  >
                    {isCorrect ? <Check className="size-3" /> : null}
                  </span>
                  <span className="min-w-0 break-words">{option.text}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Expected answer
            </p>
            <p className="mt-1 text-sm text-foreground">
              {answerSummary(draft.answer)}
            </p>
          </div>
        )}

        {options.length > 0 ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <HelpCircle className="size-3.5" aria-hidden="true" />
            Correct answer:{" "}
            <span className="font-medium text-foreground">
              {answerSummary(draft.answer)}
            </span>
          </p>
        ) : null}

        {draft.explanation ? (
          <div className="flex gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
            <Lightbulb
              className="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {draft.explanation}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
