import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { type AnswerData, type Question, QuestionType } from "@/types";
import { Check, Pencil, Trash2 } from "lucide-react";

interface QuestionCardProps {
  question: Question;
  index: number;
  onEdit: (question: Question) => void;
  onDelete: (question: Question) => void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

function correctAnswerText(answer: AnswerData): string {
  switch (answer.__kind__) {
    case "multipleChoice": {
      const correct = answer.multipleChoice.options.find(
        (option) => option.id === answer.multipleChoice.correctOptionId,
      );
      return correct?.text ?? "—";
    }
    case "trueFalse":
      return answer.trueFalse.correct ? "True" : "False";
    case "shortAnswer":
      return answer.shortAnswer.expected;
  }
}

export function QuestionCard({
  question,
  index,
  onEdit,
  onDelete,
}: QuestionCardProps) {
  const multipleChoice =
    question.answer.__kind__ === "multipleChoice"
      ? question.answer.multipleChoice
      : null;
  const options = multipleChoice?.options ?? [];

  return (
    <Card
      data-ocid={`questions.item.${index}`}
      className="gap-0 rounded-lg border-border/70 py-0 shadow-none"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="numeric text-muted-foreground mt-0.5 shrink-0 text-xs">
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="text-foreground text-sm leading-relaxed font-medium">
              {question.prompt}
            </p>
          </div>
          <Badge
            variant="secondary"
            data-ocid={`questions.type.${index}`}
            className="shrink-0 text-[0.7rem] tracking-wide uppercase"
          >
            {TYPE_LABELS[question.questionType]}
          </Badge>
        </div>

        {options.length > 0 ? (
          <ul className="grid gap-1.5 pl-7">
            {options.map((option) => {
              const isCorrect = option.id === multipleChoice?.correctOptionId;
              return (
                <li
                  key={option.id.toString()}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm",
                    isCorrect
                      ? "border-success/40 bg-success/10 text-foreground"
                      : "border-border/60 text-muted-foreground",
                  )}
                >
                  {isCorrect ? (
                    <Check
                      className="text-success size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="size-3.5 shrink-0 rounded-full border border-current opacity-40"
                    />
                  )}
                  <span className="min-w-0 break-words">{option.text}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="border-success/40 bg-success/10 ml-7 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Check
              className="text-success size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">Answer:</span>
            <span className="text-foreground font-medium">
              {correctAnswerText(question.answer)}
            </span>
          </div>
        )}

        {question.explanation?.trim() ? (
          <p className="text-muted-foreground border-border/60 ml-7 border-l-2 pl-3 text-xs leading-relaxed">
            {question.explanation}
          </p>
        ) : null}
      </div>

      <div className="border-border/60 flex items-center justify-end gap-1 border-t px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`questions.edit_button.${index}`}
          onClick={() => onEdit(question)}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-ocid={`questions.delete_button.${index}`}
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(question)}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Delete
        </Button>
      </div>
    </Card>
  );
}
