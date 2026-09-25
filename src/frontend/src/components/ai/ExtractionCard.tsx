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
import {
  type ExtractionItem,
  useAiExtractionStore,
} from "@/hooks/useAiExtractionStore";
import {
  useChapters,
  useClasses,
  useSubjects,
  useTopics,
} from "@/hooks/useContent";
import type { Id } from "@/types";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Edit2,
  FolderTree,
  Lightbulb,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface ExtractionCardProps {
  item: ExtractionItem;
  index: number;
  onImportSingle?: (item: ExtractionItem) => Promise<void>;
  isImporting?: boolean;
}

export function ExtractionCard({
  item,
  index,
  onImportSingle,
  isImporting = false,
}: ExtractionCardProps) {
  const {
    updateItem,
    approveItem,
    rejectItem,
    restoreItem,
    toggleEditItem,
    deleteItem,
  } = useAiExtractionStore();

  const [promptDraft, setPromptDraft] = useState(item.question);
  const [optionsDraft, setOptionsDraft] = useState<string[]>(
    item.options || [],
  );
  const [correctAnswerDraft, setCorrectAnswerDraft] = useState(
    item.correctAnswer,
  );
  const [explanationDraft, setExplanationDraft] = useState(
    item.explanation || "",
  );

  // Content hierarchy queries for per-card target assignment
  const classesQuery = useClasses();
  const selectedClassId = item.targetClassId
    ? BigInt(item.targetClassId)
    : null;
  const subjectsQuery = useSubjects(selectedClassId);
  const selectedSubjectId = item.targetSubjectId
    ? BigInt(item.targetSubjectId)
    : null;
  const chaptersQuery = useChapters(selectedSubjectId);
  const selectedChapterId = item.targetChapterId
    ? BigInt(item.targetChapterId)
    : null;
  const topicsQuery = useTopics(selectedChapterId);

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const topics = topicsQuery.data ?? [];

  const handleSaveEdit = () => {
    updateItem(item.id, {
      question: promptDraft.trim(),
      options:
        item.type === "mcq"
          ? optionsDraft.map((o) => o.trim()).filter(Boolean)
          : undefined,
      correctAnswer: correctAnswerDraft.trim(),
      explanation: explanationDraft.trim() || undefined,
      isEditing: false,
    });
    toast.success("Question edits saved.");
  };

  const handleAddOption = () => {
    const nextChar = String.fromCharCode(65 + optionsDraft.length);
    setOptionsDraft([...optionsDraft, `Option ${nextChar}`]);
  };

  const handleRemoveOption = (optIndex: number) => {
    if (optionsDraft.length <= 2) {
      toast.error("Multiple choice questions require at least two options.");
      return;
    }
    const newOptions = optionsDraft.filter((_, i) => i !== optIndex);
    setOptionsDraft(newOptions);

    // If removed option was the correct one, reset to A
    const char = String.fromCharCode(65 + optIndex);
    if (correctAnswerDraft === char) {
      setCorrectAnswerDraft("A");
    }
  };

  const isRejected = item.status === "rejected";
  const isApproved = item.status === "approved";
  const isImported = item.status === "imported";

  return (
    <Card
      data-ocid={`ai.extraction_card.${index + 1}`}
      className={`animate-fade-up overflow-hidden rounded-xl border transition-all ${
        isImported
          ? "border-emerald-500/30 bg-emerald-500/5 shadow-subtle"
          : isApproved
            ? "border-primary/40 bg-primary/[0.02] shadow-subtle ring-1 ring-primary/20"
            : isRejected
              ? "border-border/60 bg-muted/30 opacity-60"
              : "border-border bg-card shadow-subtle"
      }`}
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/30 px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="numeric text-xs font-semibold text-muted-foreground">
            #{String(index + 1).padStart(2, "0")}
          </span>

          <Badge
            variant="secondary"
            className="rounded-full bg-accent/12 text-accent text-xs font-medium"
          >
            {item.type === "mcq" ? "Multiple Choice" : "Short Q&A"}
          </Badge>

          {item.status === "pending" && (
            <Badge
              variant="outline"
              className="rounded-full text-[11px] text-amber-600 border-amber-500/30"
            >
              Pending Review
            </Badge>
          )}

          {isApproved && (
            <Badge className="rounded-full bg-primary/15 text-primary text-[11px] font-semibold border-primary/30">
              Approved
            </Badge>
          )}

          {isRejected && (
            <Badge
              variant="secondary"
              className="rounded-full text-[11px] text-muted-foreground"
            >
              Rejected
            </Badge>
          )}

          {isImported && (
            <Badge className="rounded-full bg-emerald-600/15 text-emerald-600 text-[11px] font-semibold border-emerald-600/30">
              <CheckCircle2 className="mr-1 size-3" />
              Saved to Bank
            </Badge>
          )}

          {item.sourcePage && (
            <span className="text-[11px] text-muted-foreground">
              Page {item.sourcePage}
            </span>
          )}
        </div>

        {/* Card Actions */}
        <div className="flex items-center gap-1.5">
          {!isImported && (
            <>
              {item.isEditing ? (
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={handleSaveEdit}
                  className="h-8 rounded-lg bg-primary text-xs text-primary-foreground"
                >
                  <Check className="mr-1 size-3.5" />
                  Done
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleEditItem(item.id)}
                  className="h-8 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                >
                  <Edit2 className="mr-1 size-3.5" />
                  Edit
                </Button>
              )}

              {item.status === "pending" && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => approveItem(item.id)}
                    className="h-8 rounded-lg text-xs border-primary/30 text-primary hover:bg-primary/10"
                  >
                    <Check className="mr-1 size-3.5" />
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => rejectItem(item.id)}
                    className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive"
                  >
                    <X className="mr-1 size-3.5" />
                    Reject
                  </Button>
                </>
              )}

              {isApproved && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => rejectItem(item.id)}
                  className="h-8 rounded-lg text-xs text-muted-foreground hover:text-destructive"
                >
                  <X className="mr-1 size-3.5" />
                  Reject
                </Button>
              )}

              {isRejected && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => restoreItem(item.id)}
                  className="h-8 rounded-lg text-xs"
                >
                  <RotateCcw className="mr-1 size-3.5" />
                  Restore
                </Button>
              )}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => deleteItem(item.id)}
                className="h-8 rounded-lg px-2 text-xs text-muted-foreground hover:text-destructive"
                title="Delete from review"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* AI-inferred alert banner */}
      {item.inferred && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-5 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            <strong>AI-inferred answer:</strong> The correct answer was not
            explicitly marked in the source document. Please verify the answer
            before approving.
          </span>
        </div>
      )}

      {/* Content body */}
      <div className="space-y-4 p-5 md:p-6">
        {/* Question Prompt */}
        <div>
          {item.isEditing ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Question Text
              </Label>
              <Textarea
                rows={3}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="font-display text-sm md:text-base"
              />
            </div>
          ) : (
            <h3 className="font-display text-base font-semibold leading-relaxed text-foreground md:text-lg">
              {item.question}
            </h3>
          )}
        </div>

        {/* MCQ Options Display & Edit */}
        {item.type === "mcq" && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Options{" "}
              {item.isEditing ? "(select radio for correct option)" : ""}
            </Label>

            {item.isEditing ? (
              <div className="space-y-2">
                {optionsDraft.map((opt, optIdx) => {
                  const letter = String.fromCharCode(65 + optIdx);
                  const isChecked = correctAnswerDraft === letter;
                  return (
                    <div key={letter} className="flex items-center gap-2">
                      <label
                        className={`flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border font-mono text-xs font-bold transition-all ${
                          isChecked
                            ? "border-primary bg-primary text-primary-foreground shadow-xs"
                            : "border-border bg-muted/40 text-muted-foreground hover:border-primary/50"
                        }`}
                        title="Click to set as correct answer"
                      >
                        <input
                          type="radio"
                          name={`correct-radio-${item.id}`}
                          checked={isChecked}
                          onChange={() => setCorrectAnswerDraft(letter)}
                          className="hidden"
                        />
                        {letter}
                      </label>
                      <Input
                        value={opt}
                        onChange={(e) => {
                          const next = [...optionsDraft];
                          next[optIdx] = e.target.value;
                          setOptionsDraft(next);
                        }}
                        className="text-xs sm:text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveOption(optIdx)}
                        className="size-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}

                {optionsDraft.length < 6 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddOption}
                    className="h-8 rounded-lg text-xs text-primary"
                  >
                    <Plus className="mr-1 size-3.5" />
                    Add Option
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {(item.options || []).map((opt, optIdx) => {
                  const letter = String.fromCharCode(65 + optIdx);
                  const isCorrect = item.correctAnswer.toUpperCase() === letter;

                  return (
                    <div
                      key={letter}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-xs transition-colors md:text-sm ${
                        isCorrect
                          ? "border-primary/40 bg-primary/10 font-medium text-foreground ring-1 ring-primary/30"
                          : "border-border bg-card text-foreground/90"
                      }`}
                    >
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-bold ${
                          isCorrect
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {letter}
                      </span>
                      <span className="mt-0.5 leading-relaxed">{opt}</span>
                      {isCorrect && (
                        <Check className="ml-auto mt-0.5 size-4 shrink-0 text-primary" />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Short Q&A Answer Display & Edit */}
        {item.type === "short_qa" && (
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Expected Answer / Solution
            </Label>
            {item.isEditing ? (
              <Textarea
                rows={3}
                value={correctAnswerDraft}
                onChange={(e) => setCorrectAnswerDraft(e.target.value)}
                placeholder="Enter expected answer text..."
                className="text-xs sm:text-sm"
              />
            ) : (
              <div className="rounded-lg border border-border/80 bg-muted/30 p-3.5 text-xs text-foreground md:text-sm">
                <span className="font-semibold text-primary">Answer: </span>
                {item.correctAnswer || "—"}
              </div>
            )}
          </div>
        )}

        {/* Explanation Display & Edit */}
        {(item.explanation || item.isEditing) && (
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/15 p-3.5 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-muted-foreground">
              <Lightbulb className="size-3.5 text-amber-500" />
              Explanation & Context
            </div>
            {item.isEditing ? (
              <Textarea
                rows={2}
                value={explanationDraft}
                onChange={(e) => setExplanationDraft(e.target.value)}
                placeholder="Add explanation or rationale for this question..."
                className="mt-1 text-xs"
              />
            ) : (
              <p className="mt-0.5 leading-relaxed text-muted-foreground">
                {item.explanation}
              </p>
            )}
          </div>
        )}

        {/* Taxonomy Assignment Footer */}
        <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <FolderTree className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              Assign to:
            </span>

            {/* Cascading Class -> Subject -> Chapter -> Topic */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Class Select */}
              <Select
                value={item.targetClassId || undefined}
                disabled={isImported}
                onValueChange={(val) => {
                  updateItem(item.id, {
                    targetClassId: val,
                    targetSubjectId: null,
                    targetChapterId: null,
                    targetTopicId: null,
                  });
                }}
              >
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue placeholder="Class..." />
                </SelectTrigger>
                <SelectContent>
                  {classes.map((cls) => (
                    <SelectItem
                      key={cls.id.toString()}
                      value={cls.id.toString()}
                    >
                      {cls.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Subject Select */}
              <Select
                value={item.targetSubjectId || undefined}
                disabled={!selectedClassId || isImported}
                onValueChange={(val) => {
                  updateItem(item.id, {
                    targetSubjectId: val,
                    targetChapterId: null,
                    targetTopicId: null,
                  });
                }}
              >
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue placeholder="Subject..." />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((sub) => (
                    <SelectItem
                      key={sub.id.toString()}
                      value={sub.id.toString()}
                    >
                      {sub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Chapter Select */}
              <Select
                value={item.targetChapterId || undefined}
                disabled={!selectedSubjectId || isImported}
                onValueChange={(val) => {
                  updateItem(item.id, {
                    targetChapterId: val,
                    targetTopicId: null,
                  });
                }}
              >
                <SelectTrigger className="h-7 w-28 text-xs">
                  <SelectValue placeholder="Chapter..." />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((ch) => (
                    <SelectItem key={ch.id.toString()} value={ch.id.toString()}>
                      {ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Topic Select */}
              <Select
                value={item.targetTopicId || undefined}
                disabled={!selectedChapterId || isImported}
                onValueChange={(val) => {
                  updateItem(item.id, { targetTopicId: val });
                }}
              >
                <SelectTrigger className="h-7 w-28 text-xs font-medium">
                  <SelectValue placeholder="Topic..." />
                </SelectTrigger>
                <SelectContent>
                  {topics.map((top) => (
                    <SelectItem
                      key={top.id.toString()}
                      value={top.id.toString()}
                    >
                      {top.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Quick single import button */}
          {!isImported && onImportSingle && (
            <Button
              type="button"
              size="sm"
              disabled={isImporting || !item.targetTopicId}
              onClick={() => onImportSingle(item)}
              className="h-8 rounded-lg bg-primary text-xs text-primary-foreground shadow-subtle hover:shadow-elevated"
            >
              <Check className="mr-1.5 size-3.5" />
              Save to Topic
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
