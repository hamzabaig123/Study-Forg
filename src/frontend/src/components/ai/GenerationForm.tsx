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
import { cn } from "@/lib/utils";
import type {
  ChapterSummary,
  ClassSummary,
  Id,
  SubjectSummary,
  TopicSummary,
} from "@/types";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

const COUNT_OPTIONS = [3, 5, 8, 10] as const;

export interface GenerationFormValues {
  topicId: Id | null;
  prompt: string;
  sourceText: string;
  count: number;
}

interface GenerationFormProps {
  classes: ClassSummary[];
  subjects: SubjectSummary[];
  chapters: ChapterSummary[];
  topics: TopicSummary[];
  selectedClassId: Id | null;
  selectedSubjectId: Id | null;
  selectedChapterId: Id | null;
  selectedTopicId: Id | null;
  onSelectClass: (id: Id | null) => void;
  onSelectSubject: (id: Id | null) => void;
  onSelectChapter: (id: Id | null) => void;
  onSelectTopic: (id: Id | null) => void;
  isGenerating: boolean;
  onGenerate: (values: GenerationFormValues) => void;
}

function StepSelect({
  label,
  placeholder,
  value,
  options,
  disabled,
  ocid,
  onSelect,
}: {
  label: string;
  placeholder: string;
  value: Id | null;
  options: Array<{ id: Id; name: string }>;
  disabled: boolean;
  ocid: string;
  onSelect: (id: Id | null) => void;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      <Select
        value={value ? value.toString() : undefined}
        disabled={disabled}
        onValueChange={(next) => onSelect(BigInt(next))}
      >
        <SelectTrigger
          data-ocid={ocid}
          className="w-full rounded-lg border-input bg-background"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.id.toString()} value={option.id.toString()}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The AI generation form: browse the class > subject > chapter > topic
 * hierarchy, describe what to generate, optionally paste source text, and
 * choose how many questions to produce.
 */
export function GenerationForm({
  classes,
  subjects,
  chapters,
  topics,
  selectedClassId,
  selectedSubjectId,
  selectedChapterId,
  selectedTopicId,
  onSelectClass,
  onSelectSubject,
  onSelectChapter,
  onSelectTopic,
  isGenerating,
  onGenerate,
}: GenerationFormProps) {
  const [prompt, setPrompt] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState<number>(5);

  const canGenerate =
    selectedTopicId !== null && prompt.trim().length > 0 && !isGenerating;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canGenerate) return;
    onGenerate({
      topicId: selectedTopicId,
      prompt: prompt.trim(),
      sourceText: sourceText.trim(),
      count,
    });
  };

  return (
    <Card
      data-ocid="ai.generation_form"
      className="rounded-xl border-border bg-card p-5 shadow-subtle md:p-6"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
              1
            </span>
            <h2 className="font-display text-lg text-card-foreground">
              Choose a topic
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <StepSelect
              label="Class"
              placeholder="Select a class"
              value={selectedClassId}
              options={classes}
              disabled={classes.length === 0}
              ocid="ai.class_select"
              onSelect={(id) => {
                onSelectClass(id);
                onSelectSubject(null);
                onSelectChapter(null);
                onSelectTopic(null);
              }}
            />
            <StepSelect
              label="Subject"
              placeholder={
                selectedClassId ? "Select a subject" : "Pick a class first"
              }
              value={selectedSubjectId}
              options={subjects}
              disabled={!selectedClassId}
              ocid="ai.subject_select"
              onSelect={(id) => {
                onSelectSubject(id);
                onSelectChapter(null);
                onSelectTopic(null);
              }}
            />
            <StepSelect
              label="Chapter"
              placeholder={
                selectedSubjectId ? "Select a chapter" : "Pick a subject first"
              }
              value={selectedChapterId}
              options={chapters}
              disabled={!selectedSubjectId}
              ocid="ai.chapter_select"
              onSelect={(id) => {
                onSelectChapter(id);
                onSelectTopic(null);
              }}
            />
            <StepSelect
              label="Topic"
              placeholder={
                selectedChapterId ? "Select a topic" : "Pick a chapter first"
              }
              value={selectedTopicId}
              options={topics}
              disabled={!selectedChapterId}
              ocid="ai.topic_select"
              onSelect={onSelectTopic}
            />
          </div>
          {selectedTopicId === null ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ChevronRight className="size-3.5" aria-hidden="true" />
              Drafts are added to the question bank of the topic you pick here.
            </p>
          ) : null}
        </div>

        <div className="h-px bg-border" />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
              2
            </span>
            <h2 className="font-display text-lg text-card-foreground">
              Describe the questions
            </h2>
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="ai-prompt"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Generation prompt
            </Label>
            <Textarea
              id="ai-prompt"
              data-ocid="ai.prompt_textarea"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. Write questions that test understanding of the causes of the French Revolution, mixing recall and application."
              rows={3}
              className="resize-y rounded-lg border-input bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="ai-source"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Source text{" "}
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="ai-source"
              data-ocid="ai.source_textarea"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="Paste lecture notes, a textbook passage, or an article to ground the questions in your own material."
              rows={5}
              className="resize-y rounded-lg border-input bg-background"
            />
          </div>
        </div>

        <div className="h-px bg-border" />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary">
              3
            </span>
            <h2 className="font-display text-lg text-card-foreground">
              How many questions?
            </h2>
          </div>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Number of questions to generate</legend>
            {COUNT_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                data-ocid={`ai.count_option.${option}`}
                aria-pressed={count === option}
                onClick={() => setCount(option)}
                className={cn(
                  "numeric min-w-14 rounded-lg border px-4 py-2 text-sm font-semibold transition-smooth",
                  count === option
                    ? "border-primary bg-primary text-primary-foreground shadow-subtle"
                    : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {option}
              </button>
            ))}
          </fieldset>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Generation runs on the platform's built-in AI — no key required.
          </p>
          <Button
            type="submit"
            data-ocid="ai.generate_button"
            disabled={!canGenerate}
            className="rounded-lg bg-gradient-primary text-primary-foreground shadow-subtle transition-smooth hover:shadow-elevated"
          >
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {isGenerating ? "Generating…" : "Generate drafts"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
