import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { importCheck } from "@/hooks/useAiImport";
import type { QuestionDraft } from "@/lib/ai/questions";
import type { DraftStatus, StudioDraft } from "@/lib/ai/studioStore";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

interface DraftCardProps {
  draft: StudioDraft;
  index: number;
  topicLabel: string | null;
  isSaving: boolean;
  onPatch: (updates: Partial<QuestionDraft>) => void;
  onStatus: (status: DraftStatus) => void;
  onRemove: () => void;
  onImport: () => void;
}

const MAX_OPTIONS = 6;

function StatusBadge({ status }: { status: DraftStatus }) {
  if (status === "imported") {
    return (
      <Badge className="rounded-full bg-success/12 text-[11px] text-success">
        <CheckCircle2 className="mr-1 size-3" aria-hidden="true" />
        Saved
      </Badge>
    );
  }
  if (status === "approved") {
    return (
      <Badge className="rounded-full bg-primary/12 text-[11px] text-primary">
        Approved
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="secondary" className="rounded-full text-[11px]">
        Rejected
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="rounded-full text-[11px] text-amber-700 dark:text-amber-400"
    >
      Needs review
    </Badge>
  );
}

/**
 * One draft under review: read it, fix it, approve it, save it.
 *
 * The edit form and the saved value are separate on purpose — the model's
 * output is what you compare against, so edits only land when Done is pressed
 * and can be dropped by leaving the card.
 */
export function DraftCard({
  draft,
  index,
  topicLabel,
  isSaving,
  onPatch,
  onStatus,
  onRemove,
  onImport,
}: DraftCardProps) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(draft.question);
  const [options, setOptions] = useState<string[]>(
    draft.options.length > 0 ? draft.options : ["", ""],
  );
  const [correctIndex, setCorrectIndex] = useState<number | null>(
    draft.correctIndex,
  );
  const [answer, setAnswer] = useState(draft.answer);
  const [explanation, setExplanation] = useState(draft.explanation);

  const imported = draft.status === "imported";
  const problem = importCheck(draft);

  const startEdit = () => {
    setQuestion(draft.question);
    setOptions(draft.options.length > 0 ? draft.options : ["", ""]);
    setCorrectIndex(draft.correctIndex);
    setAnswer(draft.answer);
    setExplanation(draft.explanation);
    setEditing(true);
  };

  const saveEdit = () => {
    if (draft.kind === "mcq") {
      // Dropping blank options moves the rest, so the marked option is re-found
      // by its text instead of by clamping its old index.
      const kept = options
        .map((option) => option.trim())
        .filter((text) => text.length > 0);
      const marked =
        correctIndex === null ? "" : (options[correctIndex] ?? "").trim();
      const nextCorrect = kept.indexOf(marked);
      onPatch({
        question: question.trim(),
        options: kept,
        correctIndex: nextCorrect === -1 ? null : nextCorrect,
        answer: nextCorrect === -1 ? "" : (kept[nextCorrect] ?? ""),
        explanation: explanation.trim(),
        inferred: false,
      });
    } else {
      onPatch({
        question: question.trim(),
        options: [],
        correctIndex: null,
        answer: answer.trim(),
        explanation: explanation.trim(),
        inferred: false,
      });
    }
    setEditing(false);
  };

  const changeKind = (kind: "mcq" | "qa") => {
    if (kind === draft.kind) return;
    if (kind === "qa") {
      const correct =
        draft.correctIndex === null
          ? draft.answer
          : (draft.options[draft.correctIndex] ?? draft.answer);
      onPatch({ kind: "qa", options: [], correctIndex: null, answer: correct });
      return;
    }
    const seeded = [draft.answer, "", ""].filter(Boolean);
    onPatch({
      kind: "mcq",
      options: seeded.length >= 2 ? seeded.slice(0, MAX_OPTIONS) : ["", ""],
      correctIndex: 0,
      answer: "",
    });
  };

  return (
    <Card
      data-ocid={`ai_studio.draft_card.${index + 1}`}
      className={
        imported
          ? "animate-fade-up overflow-hidden rounded-xl border-success/30 bg-success/[0.04]"
          : draft.status === "approved"
            ? "animate-fade-up overflow-hidden rounded-xl border-primary/40 ring-1 ring-primary/20"
            : draft.status === "rejected"
              ? "animate-fade-up overflow-hidden rounded-xl border-border/60 bg-muted/30 opacity-70"
              : "animate-fade-up overflow-hidden rounded-xl border-border bg-card shadow-subtle"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="numeric text-xs font-semibold text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          {editing ? (
            <Select value={draft.kind} onValueChange={changeKind}>
              <SelectTrigger
                className="h-7 w-[9.5rem] bg-background text-xs"
                aria-label="Question type"
                data-ocid={`ai_studio.kind_select.${index + 1}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mcq">Multiple choice</SelectItem>
                <SelectItem value="qa">Question &amp; answer</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary" className="rounded-full text-xs">
              {draft.kind === "mcq" ? "Multiple choice" : "Q&A"}
            </Badge>
          )}
          <StatusBadge status={draft.status} />
          {draft.page ? (
            <span className="text-[11px] text-muted-foreground">
              Page {draft.page}
            </span>
          ) : null}
        </div>

        {!imported ? (
          <div className="flex flex-wrap items-center gap-1">
            {editing ? (
              <Button
                type="button"
                size="action"
                onClick={saveEdit}
                data-ocid={`ai_studio.save_edit_button.${index + 1}`}
              >
                <Check className="size-3.5" aria-hidden="true" />
                Done
              </Button>
            ) : (
              <Button
                type="button"
                variant="quiet"
                size="action"
                onClick={startEdit}
                data-ocid={`ai_studio.edit_button.${index + 1}`}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Edit
              </Button>
            )}
            {draft.status !== "rejected" ? (
              <Button
                type="button"
                variant="quiet"
                size="action"
                onClick={() => onStatus("rejected")}
                className="hover:text-destructive"
                data-ocid={`ai_studio.reject_button.${index + 1}`}
              >
                <X className="size-3.5" aria-hidden="true" />
                Reject
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="action"
                onClick={() => onStatus("pending")}
                data-ocid={`ai_studio.restore_button.${index + 1}`}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Restore
              </Button>
            )}
            {draft.status === "pending" ? (
              <Button
                type="button"
                variant="outline"
                size="action"
                onClick={() => onStatus("approved")}
                data-ocid={`ai_studio.approve_button.${index + 1}`}
              >
                <Check className="size-3.5" aria-hidden="true" />
                Approve
              </Button>
            ) : null}
            <Button
              type="button"
              variant="quiet"
              size="action"
              onClick={onRemove}
              className="px-2 hover:text-destructive"
              aria-label="Remove this draft"
              data-ocid={`ai_studio.remove_button.${index + 1}`}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      {draft.inferred && !imported ? (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          Nothing in the source marks this answer — verify it before saving.
        </div>
      ) : null}

      <div className="space-y-4 p-4 md:p-5">
        {editing ? (
          <div className="space-y-1.5">
            <Label
              htmlFor={`draft-question-${draft.id}`}
              className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Question
            </Label>
            <Textarea
              id={`draft-question-${draft.id}`}
              rows={2}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              className="text-sm"
            />
          </div>
        ) : (
          <p className="font-display text-base font-medium leading-relaxed text-foreground">
            {draft.question}
          </p>
        )}

        {draft.kind === "mcq" ? (
          <div className="space-y-2">
            {editing ? (
              <>
                {options.slice(0, MAX_OPTIONS).map((option, optionIndex) => {
                  const letter = String.fromCharCode(65 + optionIndex);
                  return (
                    <div key={letter} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCorrectIndex(optionIndex)}
                        aria-label={`Mark option ${letter} correct`}
                        className={
                          correctIndex === optionIndex
                            ? "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] font-mono text-xs font-bold text-primary-foreground"
                            : "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 font-mono text-xs font-bold text-muted-foreground hover:border-primary/50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        }
                      >
                        {letter}
                      </button>
                      <Input
                        value={option}
                        onChange={(event) => {
                          const next = [...options];
                          next[optionIndex] = event.target.value;
                          setOptions(next);
                        }}
                        className="text-sm"
                        aria-label={`Option ${letter}`}
                      />
                      <Button
                        type="button"
                        variant="quiet"
                        size="action"
                        onClick={() => {
                          if (options.length <= 2) return;
                          // Removing an option shifts the ones after it, and
                          // removing the marked one must not quietly move the
                          // answer onto a different option.
                          setOptions(
                            options.filter(
                              (_, position) => position !== optionIndex,
                            ),
                          );
                          setCorrectIndex((marked) =>
                            marked === null
                              ? null
                              : marked === optionIndex
                                ? null
                                : marked > optionIndex
                                  ? marked - 1
                                  : marked,
                          );
                        }}
                        className="size-8 shrink-0 p-0 hover:text-destructive"
                        aria-label="Remove option"
                        disabled={options.length <= 2}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
                {options.length < MAX_OPTIONS ? (
                  <Button
                    type="button"
                    variant="quiet"
                    size="action"
                    onClick={() => setOptions((current) => [...current, ""])}
                    className="text-primary"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add option
                  </Button>
                ) : null}
              </>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {draft.options.map((option, optionIndex) => {
                  const letter = String.fromCharCode(65 + optionIndex);
                  const correct = draft.correctIndex === optionIndex;
                  return (
                    <li
                      key={`${draft.id}-${letter}`}
                      className={
                        correct
                          ? "flex items-start gap-2.5 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm"
                          : "flex items-start gap-2.5 rounded-lg border border-border bg-background p-3 text-sm"
                      }
                    >
                      <span
                        className={
                          correct
                            ? "flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-xs font-bold text-primary-foreground"
                            : "flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-bold text-muted-foreground"
                        }
                      >
                        {letter}
                      </span>
                      <span className="leading-relaxed text-foreground">
                        {option}
                      </span>
                      {correct ? (
                        <Check
                          className="ml-auto size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label
              htmlFor={`draft-answer-${draft.id}`}
              className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Expected answer
            </Label>
            {editing ? (
              <Textarea
                id={`draft-answer-${draft.id}`}
                rows={3}
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="text-sm"
              />
            ) : (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
                {draft.answer || (
                  <span className="text-muted-foreground">
                    No answer found — add one before saving.
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {editing || draft.explanation ? (
          <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              <Lightbulb
                className="size-3.5 text-amber-500"
                aria-hidden="true"
              />
              Explanation
            </div>
            {editing ? (
              <Textarea
                rows={2}
                value={explanation}
                onChange={(event) => setExplanation(event.target.value)}
                placeholder="Optional rationale shown after the answer"
                className="text-xs"
                aria-label="Explanation"
              />
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {draft.explanation}
              </p>
            )}
          </div>
        ) : null}

        {!imported ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {topicLabel ? (
                <>
                  Saves into{" "}
                  <span className="font-medium text-foreground">
                    {topicLabel}
                  </span>
                </>
              ) : (
                "Choose a target topic above to save this question."
              )}
              {!topicLabel || problem ? (
                <span className="mt-0.5 block text-amber-700 dark:text-amber-400">
                  {problem
                    ? `Cannot save yet: ${problem.reason}.`
                    : "No topic selected yet."}
                </span>
              ) : null}
            </p>
            {/* Not a gradient CTA: one card's save is a row action, and the
                page already has a single primary button for the batch. */}
            <Button
              type="button"
              variant="outline"
              size="action"
              disabled={
                !topicLabel ||
                problem !== null ||
                draft.status === "rejected" ||
                isSaving
              }
              onClick={onImport}
              data-ocid={`ai_studio.import_button.${index + 1}`}
            >
              {isSaving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-3.5" aria-hidden="true" />
              )}
              Save question
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
