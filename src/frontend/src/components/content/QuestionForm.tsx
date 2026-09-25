import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { type AnswerData, type Question, QuestionType } from "@/types";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

export interface QuestionFormValues {
  prompt: string;
  questionType: QuestionType;
  answer: AnswerData;
  explanation: string;
}

interface OptionDraft {
  key: string;
  text: string;
}

interface QuestionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing question. */
  question?: Question | null;
  pending?: boolean;
  errorMessage?: string | null;
  onSubmit: (values: QuestionFormValues) => void;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

let optionSeq = 0;
function nextOptionKey(): string {
  optionSeq += 1;
  return `opt-${optionSeq}`;
}

function initialOptions(question?: Question | null): OptionDraft[] {
  if (question && question.answer.__kind__ === "multipleChoice") {
    return question.answer.multipleChoice.options.map((option) => ({
      key: nextOptionKey(),
      text: option.text,
    }));
  }
  return [
    { key: nextOptionKey(), text: "" },
    { key: nextOptionKey(), text: "" },
  ];
}

function initialCorrectIndex(question?: Question | null): number {
  if (question && question.answer.__kind__ === "multipleChoice") {
    const { options, correctOptionId } = question.answer.multipleChoice;
    const index = options.findIndex((option) => option.id === correctOptionId);
    return index >= 0 ? index : 0;
  }
  return 0;
}

/**
 * Create/edit dialog for all three question types. Owns its draft locally and
 * re-seeds only when the dialog opens, so a failed save keeps the user's work.
 */
export function QuestionForm({
  open,
  onOpenChange,
  question,
  pending = false,
  errorMessage,
  onSubmit,
}: QuestionFormProps) {
  const [prompt, setPrompt] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType>(
    QuestionType.multipleChoice,
  );
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    initialOptions(question),
  );
  const [correctIndex, setCorrectIndex] = useState(() =>
    initialCorrectIndex(question),
  );
  const [trueFalseCorrect, setTrueFalseCorrect] = useState(true);
  const [expected, setExpected] = useState("");
  const [explanation, setExplanation] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrompt(question?.prompt ?? "");
    setQuestionType(question?.questionType ?? QuestionType.multipleChoice);
    setOptions(initialOptions(question));
    setCorrectIndex(initialCorrectIndex(question));
    setTrueFalseCorrect(
      question?.answer.__kind__ === "trueFalse"
        ? question.answer.trueFalse.correct
        : true,
    );
    setExpected(
      question?.answer.__kind__ === "shortAnswer"
        ? question.answer.shortAnswer.expected
        : "",
    );
    setExplanation(question?.explanation ?? "");
  }, [open, question]);

  const filledOptions = options.filter(
    (option) => option.text.trim().length > 0,
  );
  const hasEnoughOptions = filledOptions.length >= 2;
  const correctOptionFilled =
    (options[correctIndex]?.text.trim().length ?? 0) > 0;

  const canSubmit =
    prompt.trim().length > 0 &&
    !pending &&
    (questionType === QuestionType.multipleChoice
      ? hasEnoughOptions && correctOptionFilled
      : questionType === QuestionType.shortAnswer
        ? expected.trim().length > 0
        : true);

  function updateOption(key: string, text: string) {
    setOptions((current) =>
      current.map((option) =>
        option.key === key ? { ...option, text } : option,
      ),
    );
  }

  function addOption() {
    setOptions((current) => [...current, { key: nextOptionKey(), text: "" }]);
  }

  function removeOption(key: string) {
    setOptions((current) => {
      if (current.length <= 2) return current;
      const removedIndex = current.findIndex((option) => option.key === key);
      const next = current.filter((option) => option.key !== key);
      if (removedIndex >= 0 && removedIndex <= correctIndex) {
        setCorrectIndex((index) => Math.max(0, index - 1));
      }
      return next;
    });
  }

  function buildAnswer(): AnswerData {
    if (questionType === QuestionType.multipleChoice) {
      const kept = options.filter((option) => option.text.trim().length > 0);
      const correctKey = options[correctIndex]?.key;
      const correctPosition = Math.max(
        0,
        kept.findIndex((option) => option.key === correctKey),
      );
      const builtOptions = kept.map((option, index) => ({
        id: BigInt(index + 1),
        text: option.text.trim(),
      }));
      return {
        __kind__: "multipleChoice",
        multipleChoice: {
          options: builtOptions,
          correctOptionId: builtOptions[correctPosition]?.id ?? 1n,
        },
      };
    }
    if (questionType === QuestionType.trueFalse) {
      return {
        __kind__: "trueFalse",
        trueFalse: { correct: trueFalseCorrect },
      };
    }
    return {
      __kind__: "shortAnswer",
      shortAnswer: { expected: expected.trim() },
    };
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      prompt: prompt.trim(),
      questionType,
      answer: buildAnswer(),
      explanation: explanation.trim(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-ocid="question.dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {question ? "Edit question" : "New question"}
          </DialogTitle>
          <DialogDescription>
            Author the prompt, choose a type, and record the correct answer.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="question-prompt">Prompt</Label>
            <Textarea
              id="question-prompt"
              data-ocid="question.prompt.textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What is the powerhouse of the cell?"
              rows={3}
              maxLength={500}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="question-type">Question type</Label>
            <Select
              value={questionType}
              onValueChange={(value) => setQuestionType(value as QuestionType)}
            >
              <SelectTrigger
                id="question-type"
                data-ocid="question.type.select"
                className="w-full sm:w-64"
              >
                <SelectValue placeholder="Choose a type" />
              </SelectTrigger>
              <SelectContent>
                {Object.values(QuestionType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {questionType === QuestionType.multipleChoice ? (
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium">
                Options{" "}
                <span className="text-muted-foreground font-normal">
                  — select the correct one
                </span>
              </legend>
              <RadioGroup
                value={String(correctIndex)}
                onValueChange={(value) => setCorrectIndex(Number(value))}
                className="grid gap-2"
              >
                {options.map((option, index) => (
                  <div
                    key={option.key}
                    className={cn(
                      "flex items-center gap-2 rounded-md border border-input bg-background p-2 transition-smooth",
                      correctIndex === index &&
                        "border-primary/60 bg-primary/5",
                    )}
                  >
                    <RadioGroupItem
                      value={String(index)}
                      id={`option-${option.key}`}
                      data-ocid={`question.correct_option.${index}`}
                      aria-label={`Mark option ${index + 1} correct`}
                    />
                    <Input
                      value={option.text}
                      onChange={(event) =>
                        updateOption(option.key, event.target.value)
                      }
                      data-ocid={`question.option.input.${index}`}
                      placeholder={`Option ${index + 1}`}
                      maxLength={200}
                      className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-ocid={`question.option.delete_button.${index}`}
                      aria-label={`Remove option ${index + 1}`}
                      disabled={options.length <= 2}
                      onClick={() => removeOption(option.key)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </RadioGroup>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-ocid="question.add_option_button"
                className="w-fit"
                onClick={addOption}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add option
              </Button>
              {!hasEnoughOptions ? (
                <p className="text-muted-foreground text-xs">
                  Add at least two options.
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {questionType === QuestionType.trueFalse ? (
            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium">Correct answer</legend>
              <RadioGroup
                value={trueFalseCorrect ? "true" : "false"}
                onValueChange={(value) => setTrueFalseCorrect(value === "true")}
                className="flex gap-3"
              >
                {[
                  { value: "true", label: "True" },
                  { value: "false", label: "False" },
                ].map((choice) => (
                  <Label
                    key={choice.value}
                    htmlFor={`tf-${choice.value}`}
                    className={cn(
                      "flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-input bg-background p-3 transition-smooth",
                      (trueFalseCorrect ? "true" : "false") === choice.value &&
                        "border-primary/60 bg-primary/5",
                    )}
                  >
                    <RadioGroupItem
                      value={choice.value}
                      id={`tf-${choice.value}`}
                      data-ocid={`question.true_false.${choice.value}`}
                    />
                    {choice.label}
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
          ) : null}

          {questionType === QuestionType.shortAnswer ? (
            <div className="grid gap-2">
              <Label htmlFor="question-expected">Expected answer</Label>
              <Input
                id="question-expected"
                data-ocid="question.expected.input"
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
                placeholder="Mitochondria"
                maxLength={300}
              />
            </div>
          ) : null}

          <div className="grid gap-2">
            <Label htmlFor="question-explanation">
              Explanation{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="question-explanation"
              data-ocid="question.explanation.textarea"
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              placeholder="Shown after an answer is submitted."
              rows={2}
              maxLength={500}
            />
          </div>

          {errorMessage ? (
            <p
              data-ocid="question.error_state"
              className="text-destructive text-sm"
            >
              {errorMessage}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              data-ocid="question.cancel_button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-ocid="question.submit_button"
              disabled={!canSubmit}
            >
              {pending ? "Saving…" : question ? "Save changes" : "Add question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
