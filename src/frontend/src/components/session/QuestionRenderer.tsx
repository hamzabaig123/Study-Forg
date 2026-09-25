import { AnswerControls } from "@/components/session/AnswerControls";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Option as QuestionOption } from "@/declarations/backend.did";
import { cn } from "@/lib/utils";
import { QuestionType, type SubmittedAnswer } from "@/types";

interface QuestionRendererProps {
  prompt: string;
  questionType: QuestionType;
  options: QuestionOption[];
  /** 1-based position of this question in the session. */
  index: number;
  total: number;
  value: SubmittedAnswer | null;
  onChange: (answer: SubmittedAnswer) => void;
  disabled?: boolean;
  /** Deterministic-test marker prefix, e.g. `practice`. */
  marker: string;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

/**
 * Renders one question: its prompt, a type label, the progress indicator
 * (question N of M), and the answer controls matched to the question type.
 */
export function QuestionRenderer({
  prompt,
  questionType,
  options,
  index,
  total,
  value,
  onChange,
  disabled = false,
  marker,
}: QuestionRendererProps) {
  const percent = total > 0 ? (index / total) * 100 : 0;

  return (
    <section
      data-ocid={`${marker}.question`}
      className="animate-fade-up flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span
            data-ocid={`${marker}.progress_label`}
            className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
          >
            Question {index} of {total}
          </span>
          <Badge variant="secondary" className="font-normal">
            {TYPE_LABELS[questionType]}
          </Badge>
        </div>
        <Progress
          value={percent}
          data-ocid={`${marker}.progress`}
          aria-label={`Question ${index} of ${total}`}
          className="h-1.5"
        />
      </div>

      <h2
        data-ocid={`${marker}.prompt`}
        className={cn(
          "font-display text-xl leading-snug font-semibold text-balance sm:text-2xl",
        )}
      >
        {prompt}
      </h2>

      <AnswerControls
        questionType={questionType}
        options={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        marker={marker}
      />
    </section>
  );
}
