import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type AnswerData,
  type QuestionResult,
  QuestionType,
  type SubmittedAnswer,
} from "@/types";
import { Check, Minus, X } from "lucide-react";

interface ResultReviewProps {
  results: QuestionResult[];
  /** Deterministic-test marker prefix, e.g. `results`. */
  marker: string;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

/** Human-readable rendering of a stored answer payload. */
function describeAnswer(
  answer: AnswerData | SubmittedAnswer | undefined,
): string | null {
  if (!answer) return null;
  switch (answer.__kind__) {
    case "multipleChoice": {
      const payload = answer.multipleChoice;
      if ("optionId" in payload) {
        return `Option ${payload.optionId.toString()}`;
      }
      const correct = payload.options.find(
        (option) => option.id === payload.correctOptionId,
      );
      return correct ? correct.text : "—";
    }
    case "trueFalse": {
      const payload = answer.trueFalse as {
        value?: boolean;
        correct?: boolean;
      };
      if (typeof payload.value === "boolean")
        return payload.value ? "True" : "False";
      return payload.correct ? "True" : "False";
    }
    case "shortAnswer": {
      const payload = answer.shortAnswer;
      if ("text" in payload) {
        return payload.text.trim() || "(blank)";
      }
      return payload.expected;
    }
    default:
      return null;
  }
}

/**
 * Per-question review list: the prompt, the submitted answer, the correct
 * answer, and the explanation for each question in a completed session.
 */
export function ResultReview({ results, marker }: ResultReviewProps) {
  return (
    <ol data-ocid={`${marker}.review_list`} className="grid gap-3">
      {results.map((result, index) => {
        const submitted = describeAnswer(result.submitted);
        const correctAnswer = describeAnswer(result.correctAnswer);
        const Icon = result.correct ? Check : X;

        return (
          <li
            key={result.questionId.toString()}
            data-ocid={`${marker}.review_item.${index + 1}`}
            className={cn(
              "rounded-lg border bg-card p-4 shadow-subtle transition-smooth sm:p-5",
              result.correct ? "border-success/40" : "border-destructive/40",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                  result.correct
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive",
                )}
                aria-hidden="true"
              >
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground numeric text-xs font-medium">
                    Q{index + 1}
                  </span>
                  <Badge variant="outline" className="font-normal">
                    {TYPE_LABELS[result.questionType]}
                  </Badge>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      result.correct ? "text-success" : "text-destructive",
                    )}
                  >
                    {result.correct ? "Correct" : "Incorrect"}
                  </span>
                </div>

                <p className="mt-2 text-sm leading-relaxed font-medium break-words">
                  {result.prompt}
                </p>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-md bg-muted/60 px-3 py-2">
                    <dt className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
                      Your answer
                    </dt>
                    <dd className="mt-0.5 break-words">
                      {submitted ?? (
                        <span className="text-muted-foreground inline-flex items-center gap-1">
                          <Minus className="size-3" /> Not answered
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="rounded-md bg-success/10 px-3 py-2">
                    <dt className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
                      Correct answer
                    </dt>
                    <dd className="mt-0.5 break-words font-medium">
                      {correctAnswer ?? "—"}
                    </dd>
                  </div>
                </dl>

                {result.explanation ? (
                  <div className="mt-3 border-l-2 border-primary/40 pl-3">
                    <p className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
                      Explanation
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed break-words">
                      {result.explanation}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
