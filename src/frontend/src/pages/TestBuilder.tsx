import { PageHeader } from "@/components/common/PageHeader";
import { ModeCard } from "@/components/session/SessionSetupDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBackend } from "@/hooks/useBackend";
import {
  useChapter,
  useChapters,
  useClass,
  useClasses,
  useSubject,
  useSubjects,
  useTopicPath,
  useTopics,
} from "@/hooks/useContent";
import { createLocalSession } from "@/lib/localSessions";
import {
  type TestSelection,
  assembleTest,
  gatherPool,
} from "@/lib/sessionEngine";
import { cn } from "@/lib/utils";
import { type Id, SessionMode, type TopicSummary } from "@/types";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Layers,
  ListChecks,
  Loader2,
  Settings2,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const MARKER = "builder";

const COUNT_PRESETS = [5, 10, 15, 20, 30];
const DURATION_PRESETS = [5, 10, 15, 30, 45, 60];

function parseIdParam(value: unknown): Id | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? BigInt(text) : null;
}

function scopeLabelFor(selections: readonly TestSelection[]): string {
  if (selections.length === 0) return "Custom test";
  if (selections.length === 1) return selections[0].label;
  const names = selections.map((selection) => selection.label);
  const head = names.slice(0, 3).join(" · ");
  return names.length > 3 ? `${head} +${names.length - 3} more` : head;
}

export default function TestBuilder() {
  const navigate = useNavigate();
  const { actor } = useBackend();
  const search = useSearch({ strict: false }) as {
    topic?: string | number;
    chapter?: string | number;
    mode?: string;
  };

  /* Picker navigation ---------------------------------------------------- */
  const [classId, setClassId] = useState<Id | null>(null);
  const [subjectId, setSubjectId] = useState<Id | null>(null);

  /* Test configuration ---------------------------------------------------- */
  const [selections, setSelections] = useState<TestSelection[]>([]);
  const [mode, setMode] = useState<SessionMode>(() =>
    search.mode === "practice" ? SessionMode.practice : SessionMode.timedTest,
  );
  const [useAllQuestions, setUseAllQuestions] = useState(true);
  const [questionCount, setQuestionCount] = useState(10);
  const [durationMinutes, setDurationMinutes] = useState(10);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const classesQuery = useClasses();
  const subjectsQuery = useSubjects(classId);
  const chaptersQuery = useChapters(subjectId);

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];

  /* Preselection from ?topic= / ?chapter= --------------------------------- */
  const topicParamId = parseIdParam(search.topic);
  const chapterParamId = parseIdParam(search.chapter);
  const topicPathQuery = useTopicPath(topicParamId);
  const preChapterQuery = useChapter(chapterParamId);
  const preSubjectQuery = useSubject(
    preChapterQuery.data?.chapter.subjectId ?? null,
  );
  const preClassQuery = useClass(preSubjectQuery.data?.subject.classId ?? null);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    const path = topicPathQuery.data;
    if (!path || topicParamId === null) return;
    appliedRef.current = true;
    setClassId(path.class.id);
    setSubjectId(path.subject.id);
    setSelections((prev) =>
      prev.some((item) => item.id === path.topic.id)
        ? prev
        : [
            ...prev,
            {
              key: `topic:${path.topic.id.toString()}`,
              kind: "topic" as const,
              id: path.topic.id,
              chapterId: path.chapter.id,
              label: path.topic.name,
              labels: {
                className: path.class.name,
                subjectName: path.subject.name,
                chapterName: path.chapter.name,
              },
            },
          ],
    );
  }, [topicPathQuery.data, topicParamId]);

  useEffect(() => {
    if (appliedRef.current) return;
    const chapter = preChapterQuery.data?.chapter;
    const subject = preSubjectQuery.data?.subject;
    const klass = preClassQuery.data?.class;
    if (!chapter || !subject || !klass || chapterParamId === null) return;
    appliedRef.current = true;
    setClassId(klass.id);
    setSubjectId(subject.id);
    setSelections((prev) =>
      prev.some((item) => item.id === chapter.id)
        ? prev
        : [
            ...prev,
            {
              key: `chapter:${chapter.id.toString()}`,
              kind: "chapter" as const,
              id: chapter.id,
              chapterId: chapter.id,
              label: chapter.name,
              labels: {
                className: klass.name,
                subjectName: subject.name,
                chapterName: chapter.name,
              },
            },
          ],
    );
  }, [
    preChapterQuery.data,
    preSubjectQuery.data,
    preClassQuery.data,
    chapterParamId,
  ]);

  /* Selection toggles ------------------------------------------------------ */
  const toggleChapter = useCallback(
    (
      chapter: { id: Id; name: string },
      labels: { className: string; subjectName: string },
    ) => {
      setSelections((prev) => {
        const key = `chapter:${chapter.id.toString()}`;
        if (prev.some((item) => item.key === key)) {
          return prev.filter((item) => item.key !== key);
        }
        const next: TestSelection[] = [
          ...prev.filter((item) => item.chapterId !== chapter.id),
          {
            key,
            kind: "chapter",
            id: chapter.id,
            chapterId: chapter.id,
            label: chapter.name,
            labels: { ...labels, chapterName: chapter.name },
          },
        ];
        return next;
      });
    },
    [],
  );

  const toggleTopic = useCallback(
    (
      topic: TopicSummary,
      labels: { className: string; subjectName: string; chapterName: string },
    ) => {
      setSelections((prev) => {
        const key = `topic:${topic.id.toString()}`;
        if (prev.some((item) => item.key === key)) {
          return prev.filter((item) => item.key !== key);
        }
        return [
          ...prev,
          {
            key,
            kind: "topic",
            id: topic.id,
            chapterId: topic.chapterId,
            label: topic.name,
            labels,
            questionCount: Number(topic.questionCount),
          },
        ];
      });
    },
    [],
  );

  const selectedChapterIds = useMemo(
    () =>
      new Set(
        selections
          .filter((item) => item.kind === "chapter")
          .map((item) => item.id.toString()),
      ),
    [selections],
  );

  const knownQuestionEstimate = useMemo(() => {
    let known = 0;
    let hasChapter = false;
    for (const item of selections) {
      if (item.kind === "chapter") {
        hasChapter = true;
      } else if (typeof item.questionCount === "number") {
        known += item.questionCount;
      } else {
        hasChapter = true;
      }
    }
    return { known, hasChapter };
  }, [selections]);

  const isTimed = mode === SessionMode.timedTest;
  const totalDurationSeconds = durationMinutes * 60 + durationSeconds;

  const canStart =
    selections.length > 0 &&
    !starting &&
    (!isTimed || totalDurationSeconds >= 30) &&
    (useAllQuestions || questionCount >= 1);

  async function handleStart() {
    if (!actor || !canStart) return;
    setStarting(true);
    setError(null);
    try {
      const pool = await gatherPool(actor, selections);
      if (pool.length === 0) {
        setError(
          "Those topics don't have any questions yet. Add questions first — try AI Studio.",
        );
        return;
      }
      const assembled = assembleTest(pool, {
        mode,
        questionCount: useAllQuestions ? null : questionCount,
        durationSeconds: isTimed ? totalDurationSeconds : null,
        shuffleQuestions,
        shuffleOptions,
        scopeLabel: scopeLabelFor(selections),
      });
      if (assembled.questions.length === 0) {
        setError("No questions matched. Try a different selection.");
        return;
      }
      const session = createLocalSession({
        mode,
        scopeLabel: scopeLabelFor(selections),
        questions: assembled.questions,
        durationSeconds: isTimed ? totalDurationSeconds : null,
      });
      void navigate({
        to: "/custom-test/$sessionId",
        params: { sessionId: session.id },
      });
    } catch {
      setError("Couldn't build the test. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  }

  const className = classes.find((item) => item.id === classId)?.name ?? "";
  const subjectName =
    subjects.find((item) => item.id === subjectId)?.name ?? "";
  return (
    <div data-ocid={`${MARKER}.page`} className="stagger space-y-8">
      <PageHeader
        eyebrow="Practice"
        title="Build a test"
        description="Combine any subjects, chapters, and topics into one session. Set your own question count and time, and shuffle everything so order never gives the answer away."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Content picker ------------------------------------------------- */}
        <Card
          data-ocid={`${MARKER}.picker_card`}
          className="gap-0 rounded-lg border-border/70 py-0 shadow-none"
        >
          <CardHeader className="border-b border-border/60 px-5 py-4">
            <CardTitle className="flex items-center gap-2 font-display text-base font-semibold">
              <Layers
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Choose your questions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {selections.length > 0 ? (
              <div
                data-ocid={`${MARKER}.selected_list`}
                className="flex flex-wrap gap-2"
              >
                {selections.map((selection) => (
                  <span
                    key={selection.key}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1.5 text-xs font-medium text-primary"
                  >
                    <span className="truncate">
                      {selection.kind === "chapter" ? "Chapter · " : ""}
                      {selection.label}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${selection.label}`}
                      onClick={() =>
                        setSelections((prev) =>
                          prev.filter((item) => item.key !== selection.key),
                        )
                      }
                      className="flex size-5 shrink-0 items-center justify-center rounded-full transition-smooth hover:bg-primary/20"
                      data-ocid={`${MARKER}.remove_${selection.kind}`}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label
                  htmlFor="builder-class"
                  className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Class
                </Label>
                <Select
                  value={classId ? classId.toString() : undefined}
                  onValueChange={(next) => {
                    setClassId(BigInt(next));
                    setSubjectId(null);
                  }}
                >
                  <SelectTrigger
                    id="builder-class"
                    className="w-full rounded-lg"
                    data-ocid={`${MARKER}.class_select`}
                  >
                    <SelectValue placeholder="Select a class" />
                  </SelectTrigger>
                  <SelectContent>
                    {classes.map((item) => (
                      <SelectItem
                        key={item.id.toString()}
                        value={item.id.toString()}
                      >
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label
                  htmlFor="builder-subject"
                  className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
                >
                  Subject
                </Label>
                <Select
                  value={subjectId ? subjectId.toString() : undefined}
                  disabled={classId === null}
                  onValueChange={(next) => setSubjectId(BigInt(next))}
                >
                  <SelectTrigger
                    id="builder-subject"
                    className="w-full rounded-lg"
                    data-ocid={`${MARKER}.subject_select`}
                  >
                    <SelectValue placeholder="Select a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((item) => (
                      <SelectItem
                        key={item.id.toString()}
                        value={item.id.toString()}
                      >
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {classId === null ? (
              <p
                data-ocid={`${MARKER}.pick_class_state`}
                className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
              >
                Pick a class and subject to browse chapters and topics. Your
                selections stay even when you switch subjects — mix as many as
                you like.
              </p>
            ) : subjectId === null ? (
              <p
                data-ocid={`${MARKER}.pick_subject_state`}
                className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
              >
                Pick a subject to see its chapters.
              </p>
            ) : chapters.length === 0 ? (
              <p
                data-ocid={`${MARKER}.empty_state`}
                className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
              >
                This subject has no chapters yet. Create some under Classes
                first.
              </p>
            ) : (
              <ul data-ocid={`${MARKER}.chapter_list`} className="space-y-2">
                {chapters.map((chapter) => (
                  <ChapterRow
                    key={chapter.id.toString()}
                    chapter={chapter}
                    className={className}
                    subjectName={subjectName}
                    selected={selectedChapterIds.has(chapter.id.toString())}
                    selections={selections}
                    onToggleChapter={toggleChapter}
                    onToggleTopic={toggleTopic}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Settings -------------------------------------------------------- */}
        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Card
            data-ocid={`${MARKER}.settings_card`}
            className="gap-0 rounded-lg border-border/70 py-0 shadow-none"
          >
            <CardHeader className="border-b border-border/60 px-5 py-4">
              <CardTitle className="flex items-center gap-2 font-display text-base font-semibold">
                <Settings2
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
                Test setup
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 p-5">
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Mode</legend>
                <div className="grid gap-2.5">
                  <ModeCard
                    selected={mode === SessionMode.timedTest}
                    onSelect={() => setMode(SessionMode.timedTest)}
                    icon={<Clock className="size-4" />}
                    title="Timed test"
                    description="Your own countdown; it auto-submits when time runs out."
                    marker={`${MARKER}.mode.timed`}
                  />
                  <ModeCard
                    selected={mode === SessionMode.practice}
                    onSelect={() => setMode(SessionMode.practice)}
                    icon={<Sparkles className="size-4" />}
                    title="Practice"
                    description="No clock — instant feedback and explanations after each question."
                    marker={`${MARKER}.mode.practice`}
                  />
                </div>
              </fieldset>

              <div className="grid gap-2">
                <Label htmlFor={`${MARKER}-count`}>
                  <ListChecks className="size-3.5" aria-hidden="true" />{" "}
                  Questions
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  {COUNT_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={
                        !useAllQuestions && questionCount === preset
                          ? "default"
                          : "outline"
                      }
                      data-ocid={`${MARKER}.count.${preset}`}
                      onClick={() => {
                        setUseAllQuestions(false);
                        setQuestionCount(preset);
                      }}
                    >
                      {preset}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant={useAllQuestions ? "default" : "outline"}
                    data-ocid={`${MARKER}.count.all`}
                    onClick={() => setUseAllQuestions(true)}
                  >
                    All
                  </Button>
                  <Input
                    id={`${MARKER}-count`}
                    data-ocid={`${MARKER}.count_input`}
                    type="number"
                    min={1}
                    max={500}
                    disabled={useAllQuestions}
                    value={questionCount}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setQuestionCount(
                        Number.isFinite(next)
                          ? Math.min(500, Math.max(1, Math.round(next)))
                          : 1,
                      );
                      setUseAllQuestions(false);
                    }}
                    className="numeric h-8 w-20"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {useAllQuestions
                    ? "Every question in the selection, in the order you chose."
                    : "Fewer than the pool holds? A random subset is drawn."}
                </p>
              </div>

              {isTimed ? (
                <div className="animate-fade-in grid gap-3 rounded-lg border bg-muted/40 p-4">
                  <Label>
                    <Clock className="size-3.5" aria-hidden="true" /> Duration
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {DURATION_PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type="button"
                        size="sm"
                        variant={
                          durationMinutes === preset && durationSeconds === 0
                            ? "default"
                            : "outline"
                        }
                        data-ocid={`${MARKER}.duration.${preset}`}
                        onClick={() => {
                          setDurationMinutes(preset);
                          setDurationSeconds(0);
                        }}
                      >
                        {preset}m
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="grid flex-1 gap-1">
                      <Label
                        htmlFor={`${MARKER}-minutes`}
                        className="text-xs text-muted-foreground"
                      >
                        Minutes
                      </Label>
                      <Input
                        id={`${MARKER}-minutes`}
                        data-ocid={`${MARKER}.minutes_input`}
                        type="number"
                        min={0}
                        max={180}
                        value={durationMinutes}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          setDurationMinutes(
                            Number.isFinite(next)
                              ? Math.min(180, Math.max(0, Math.round(next)))
                              : 0,
                          );
                        }}
                        className="numeric"
                      />
                    </div>
                    <div className="grid flex-1 gap-1">
                      <Label
                        htmlFor={`${MARKER}-seconds`}
                        className="text-xs text-muted-foreground"
                      >
                        Seconds
                      </Label>
                      <Input
                        id={`${MARKER}-seconds`}
                        data-ocid={`${MARKER}.seconds_input`}
                        type="number"
                        min={0}
                        max={59}
                        value={durationSeconds}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          setDurationSeconds(
                            Number.isFinite(next)
                              ? Math.min(59, Math.max(0, Math.round(next)))
                              : 0,
                          );
                        }}
                        className="numeric"
                      />
                    </div>
                  </div>
                  {totalDurationSeconds < 30 ? (
                    <p className="text-xs text-warning">
                      Give yourself at least 30 seconds.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-2">
                <ToggleRow
                  checked={shuffleQuestions}
                  onCheckedChange={setShuffleQuestions}
                  label="Shuffle questions"
                  description="Break the line-by-line order every run."
                  icon={<Shuffle className="size-4" aria-hidden="true" />}
                  marker={`${MARKER}.shuffle_questions`}
                />
                <ToggleRow
                  checked={shuffleOptions}
                  onCheckedChange={setShuffleOptions}
                  label="Shuffle answer options"
                  description="Multiple-choice choices change position too."
                  icon={<Shuffle className="size-4" aria-hidden="true" />}
                  marker={`${MARKER}.shuffle_options`}
                />
              </div>

              {error ? (
                <p
                  data-ocid={`${MARKER}.error_state`}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              ) : null}

              <div className="space-y-2 border-t border-border/60 pt-4">
                <p className="text-sm text-muted-foreground">
                  {selections.length === 0
                    ? "Select at least one chapter or topic."
                    : `${selections.length} ${selections.length === 1 ? "source" : "sources"} selected${knownQuestionEstimate.known > 0 || knownQuestionEstimate.hasChapter ? ` · ${knownQuestionEstimate.known}${knownQuestionEstimate.hasChapter ? "+" : ""} questions` : ""}`}
                </p>
                <Button
                  type="button"
                  className="w-full gap-2 rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90"
                  onClick={() => void handleStart()}
                  disabled={!canStart}
                  data-ocid={`${MARKER}.start_button`}
                >
                  {starting ? (
                    <>
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                      Building…
                    </>
                  ) : isTimed ? (
                    <>
                      <Clock className="size-4" aria-hidden="true" />
                      Start timed test
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" aria-hidden="true" />
                      Start practice
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chapter picker row                                                          */
/* -------------------------------------------------------------------------- */

interface ChapterRowProps {
  chapter: { id: Id; name: string; topicCount: bigint };
  className: string;
  subjectName: string;
  selected: boolean;
  selections: TestSelection[];
  onToggleChapter: (
    chapter: { id: Id; name: string },
    labels: { className: string; subjectName: string },
  ) => void;
  onToggleTopic: (
    topic: TopicSummary,
    labels: { className: string; subjectName: string; chapterName: string },
  ) => void;
}

function ChapterRow({
  chapter,
  className,
  subjectName,
  selected,
  selections,
  onToggleChapter,
  onToggleTopic,
}: ChapterRowProps) {
  const [expanded, setExpanded] = useState(false);
  const topicsQuery = useTopics(chapter.id);
  const topics = topicsQuery.data ?? [];
  const selectedTopicIds = useMemo(
    () =>
      new Set(
        selections
          .filter(
            (item) => item.kind === "topic" && item.chapterId === chapter.id,
          )
          .map((item) => item.id.toString()),
      ),
    [selections, chapter.id],
  );
  const chapterQuestionTotal = topics.reduce(
    (sum, topic) => sum + Number(topic.questionCount),
    0,
  );
  const labels = { className, subjectName, chapterName: chapter.name };

  return (
    <li
      data-ocid={`${MARKER}.chapter_row`}
      className={cn(
        "rounded-lg border transition-smooth",
        selected ? "border-primary/50 bg-primary/5" : "border-border/70",
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <CheckToggle
          checked={selected}
          onToggle={() => onToggleChapter(chapter, { className, subjectName })}
          label={`Whole chapter: ${chapter.name}`}
          marker={`${MARKER}.chapter_toggle`}
        />
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-smooth hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-ocid={`${MARKER}.chapter_expand`}
        >
          {expanded ? (
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {chapter.name}
            </span>
            <span className="numeric block text-xs text-muted-foreground">
              {chapter.topicCount.toString()}{" "}
              {chapter.topicCount === 1n ? "topic" : "topics"}
              {topicsQuery.isSuccess
                ? ` · ${chapterQuestionTotal} questions`
                : ""}
            </span>
          </span>
        </button>
      </div>
      {expanded ? (
        <ul className="animate-fade-in space-y-1 border-t border-border/60 p-3">
          {topics.length === 0 ? (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No topics in this chapter yet.
            </li>
          ) : (
            topics.map((topic) => {
              const topicSelected =
                selected || selectedTopicIds.has(topic.id.toString());
              return (
                <li
                  key={topic.id.toString()}
                  className="flex items-center gap-3 rounded-md px-1 py-1.5"
                >
                  <CheckToggle
                    checked={topicSelected}
                    disabled={selected}
                    onToggle={() => onToggleTopic(topic, labels)}
                    label={`Topic: ${topic.name}`}
                    marker={`${MARKER}.topic_toggle`}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {topic.name}
                  </span>
                  <span className="numeric shrink-0 text-xs text-muted-foreground">
                    {topic.questionCount.toString()} q
                  </span>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Small controls                                                              */
/* -------------------------------------------------------------------------- */

function CheckToggle({
  checked,
  disabled = false,
  onToggle,
  label,
  marker,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  label: string;
  marker: string;
}) {
  return (
    // A native checkbox underneath: the styled box is the input itself, so
    // keyboard and screen-reader behaviour come for free.
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onToggle}
      data-ocid={marker}
      className={cn(
        "flex size-5 shrink-0 appearance-none items-center justify-center rounded-md border transition-smooth",
        "checked:border-primary checked:bg-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "hover:border-primary/60 disabled:opacity-60",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22white%22 stroke-width=%223.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M20 6 9 17l-5-5%22/></svg>')] bg-[length:14px_14px] bg-center bg-no-repeat",
      )}
    />
  );
}

function ToggleRow({
  checked,
  onCheckedChange,
  label,
  description,
  icon,
  marker,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  description: string;
  icon: React.ReactNode;
  marker: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-ocid={marker}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-smooth",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "border-primary/40 bg-primary/5" : "border-border bg-card",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          checked
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-smooth",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full bg-background shadow-sm transition-smooth",
            checked ? "left-[1.125rem]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}
