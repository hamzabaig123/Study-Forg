import { Input } from "@/components/ui/input";
import type { Option as QuestionOption } from "@/declarations/backend.did";
import { cn } from "@/lib/utils";
import { QuestionType, type SubmittedAnswer } from "@/types";
import { Check, X } from "lucide-react";

interface AnswerControlsProps {
  questionType: QuestionType;
  options: QuestionOption[];
  /** The answer currently chosen/typed, or null when unanswered. */
  value: SubmittedAnswer | null;
  onChange: (answer: SubmittedAnswer) => void;
  /** Locked after a practice answer is graded or a timed test is submitted. */
  disabled?: boolean;
  /** Deterministic-test marker prefix, e.g. `practice`. */
  marker: string;
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/**
 * Answer controls matched to the question type: option buttons for multiple
 * choice, true/false buttons for true-false, and a text input for short answer.
 */
export function AnswerControls({
  questionType,
  options,
  value,
  onChange,
  disabled = false,
  marker,
}: AnswerControlsProps) {
  if (questionType === QuestionType.multipleChoice) {
    const selectedId =
      value?.__kind__ === "multipleChoice"
        ? value.multipleChoice.optionId
        : null;

    return (
      <fieldset data-ocid={`${marker}.options`} className="grid gap-2.5">
        <legend className="sr-only">Answer options</legend>
        {options.map((option, index) => {
          const selected = selectedId === option.id;
          return (
            <button
              key={option.id.toString()}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              data-ocid={`${marker}.option.${index + 1}`}
              onClick={() =>
                onChange({
                  __kind__: "multipleChoice",
                  multipleChoice: { optionId: option.id },
                })
              }
              className={cn(
                "group flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-smooth",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed",
                selected
                  ? "border-primary bg-primary/10 shadow-subtle"
                  : "border-border bg-card hover:border-primary/50 hover:bg-accent/5",
                disabled && !selected && "opacity-60",
              )}
            >
              <span
                className={cn(
                  "numeric flex size-7 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted text-muted-foreground",
                )}
              >
                {OPTION_LETTERS[index] ?? index + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-relaxed break-words">
                {option.text}
              </span>
            </button>
          );
        })}
      </fieldset>
    );
  }

  if (questionType === QuestionType.trueFalse) {
    const selected =
      value?.__kind__ === "trueFalse" ? value.trueFalse.value : null;
    const choices: Array<{ label: string; bool: boolean; icon: typeof Check }> =
      [
        { label: "True", bool: true, icon: Check },
        { label: "False", bool: false, icon: X },
      ];

    return (
      <fieldset
        data-ocid={`${marker}.true_false`}
        className="grid grid-cols-2 gap-3"
      >
        <legend className="sr-only">True or false</legend>
        {choices.map((choice, index) => {
          const isSelected = selected === choice.bool;
          const Icon = choice.icon;
          return (
            <button
              key={choice.label}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              data-ocid={`${marker}.option.${index + 1}`}
              onClick={() =>
                onChange({
                  __kind__: "trueFalse",
                  trueFalse: { value: choice.bool },
                })
              }
              className={cn(
                "flex items-center justify-center gap-2 rounded-lg border px-4 py-4 text-sm font-medium transition-smooth",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed",
                isSelected
                  ? "border-primary bg-primary/10 text-foreground shadow-subtle"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                disabled && !isSelected && "opacity-60",
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  isSelected ? "text-primary" : "text-muted-foreground",
                )}
              />
              {choice.label}
            </button>
          );
        })}
      </fieldset>
    );
  }

  const text = value?.__kind__ === "shortAnswer" ? value.shortAnswer.text : "";

  return (
    <div className="grid gap-2">
      <label
        htmlFor={`${marker}-short-answer`}
        className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
      >
        Your answer
      </label>
      <Input
        id={`${marker}-short-answer`}
        data-ocid={`${marker}.input`}
        value={text}
        disabled={disabled}
        autoComplete="off"
        placeholder="Type your answer…"
        onChange={(event) =>
          onChange({
            __kind__: "shortAnswer",
            shortAnswer: { text: event.target.value },
          })
        }
        className="h-11 text-base"
      />
    </div>
  );
}
