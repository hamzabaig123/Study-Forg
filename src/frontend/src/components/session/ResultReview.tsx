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
  /** Printed question numbers, one per result, when the list is a filtered
      view of a longer test. Defaults to 1, 2, 3… */
  numbers?: readonly number[];
}

const TYPE_LABELS: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

/** Human-readable rendering of a stored answer payload. */
function describeAnswer(
  answer: AnswerData | SubmittedAnswer | undefined,
  /** The question's own option list, for turning a submitted option id into
      its printed text — the submitted payload carries only the id. */
  optionTextById?: Map<string, string>,
): string | null {
  if (!answer) return null;
  switch (answer.__kind__) {
    case "multipleChoice": {
      const payload = answer.multipleChoice;
      if ("optionId" in payload) {
        const text = optionTextById?.get(payload.optionId.toString());
        return text ?? `Option ${payload.optionId.toString()}`;
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
export function ResultReview({ results, marker, numbers }: ResultReviewProps) {
  return (
    <ol data-ocid={`${marker}.review_list`} className="stagger grid gap-3">
      {results.map((result, index) => {
        // The correct-answer payload carries the question's options; the
        // submitted payload only names one by id. Sharing that list is what
        // turns "Option 2" into the text the user actually chose — option ids
        // are the same on both sides, however the options were shuffled.
        const options =
          result.correctAnswer.__kind__ === "multipleChoice"
            ? result.correctAnswer.multipleChoice.options
            : undefined;
        const optionTextById = options
          ? new Map(
              options.map((option) => [option.id.toString(), option.text]),
            )
          : undefined;
        const submitted = describeAnswer(result.submitted, optionTextById);
        const correctAnswer = describeAnswer(result.correctAnswer);
        const number = numbers?.[index] ?? index + 1;
        // Graded wrong with nothing on record means the question was left blank.
        const status = result.correct
          ? "correct"
          : result.submitted
            ? "wrong"
            : "skipped";
        const Icon =
          status === "correct" ? Check : status === "wrong" ? X : Minus;

        return (
          <li
            key={`${result.questionId.toString()}:${number}`}
            data-ocid={`${marker}.review_item.${number}`}
            data-status={status}
            className={cn(
              "rounded-lg border bg-card p-4 shadow-subtle transition-smooth sm:p-5",
              status === "correct"
                ? "border-success/40"
                : status === "wrong"
                  ? "border-destructive/40"
                  : "border-border",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                  status === "correct"
                    ? "bg-success/15 text-success"
                    : status === "wrong"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground",
                )}
                aria-hidden="true"
              >
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground numeric text-xs font-medium">
                    Q{number}
                  </span>
                  <Badge variant="outline" className="font-normal">
                    {TYPE_LABELS[result.questionType]}
                  </Badge>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      status === "correct"
                        ? "text-success"
                        : status === "wrong"
                          ? "text-destructive"
                          : "text-muted-foreground",
                    )}
                  >
                    {status === "correct"
                      ? "Correct"
                      : status === "wrong"
                        ? "Incorrect"
                        : "Skipped"}
                  </span>
                </div>

                <p
                  dir="auto"
                  className="mt-2 text-sm leading-relaxed font-medium break-words"
                >
                  {result.prompt}
                </p>

                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-md bg-muted/60 px-3 py-2">
                    <dt className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
                      Your answer
                    </dt>
                    <dd dir="auto" className="mt-0.5 break-words">
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
                    <dd dir="auto" className="mt-0.5 break-words font-medium">
                      {correctAnswer ?? "—"}
                    </dd>
                  </div>
                </dl>

                {result.explanation ? (
                  <div className="mt-3 border-l-2 border-primary/40 pl-3">
                    <p className="text-muted-foreground text-[0.65rem] font-medium tracking-wider uppercase">
                      Explanation
                    </p>
                    <p
                      dir="auto"
                      className="mt-0.5 text-sm leading-relaxed break-words"
                    >
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
