import { AiKeyDrawer } from "@/components/ai/AiKeyDrawer";
import { BulkActionToolbar } from "@/components/ai/BulkActionToolbar";
import { DraftQuestionCard } from "@/components/ai/DraftQuestionCard";
import { ExtractionCard } from "@/components/ai/ExtractionCard";
import { ExtractionUploader } from "@/components/ai/ExtractionUploader";
import {
  GenerationForm,
  type GenerationFormValues,
} from "@/components/ai/GenerationForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type ExtractionItem,
  useAiExtractionStore,
} from "@/hooks/useAiExtractionStore";
import {
  useAcceptDraft,
  useAiConfig,
  useGenerateDrafts,
} from "@/hooks/useAiStudio";
import {
  useChapters,
  useClasses,
  useCreateQuestion,
  useSubjects,
  useTopics,
} from "@/hooks/useContent";
import { getStoredAiConfig } from "@/lib/ai/aiClient";
import {
  AiSource,
  type AnswerData,
  type DraftQuestion,
  type Id,
  QuestionType,
} from "@/types";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  BookOpen,
  CheckCheck,
  FileSearch,
  FileText,
  Filter,
  KeyRound,
  Layers,
  Loader2,
  Search,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function AiStudio() {
  const [activeStudioTab, setActiveStudioTab] = useState<
    "extraction" | "prompt"
  >("extraction");
  const [isKeyDrawerOpen, setIsKeyDrawerOpen] = useState(false);

  // Content hierarchy for prompt-based generation tab
  const [promptClassId, setPromptClassId] = useState<Id | null>(null);
  const [promptSubjectId, setPromptSubjectId] = useState<Id | null>(null);
  const [promptChapterId, setPromptChapterId] = useState<Id | null>(null);
  const [promptTopicId, setPromptTopicId] = useState<Id | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<DraftQuestion[]>([]);
  const [lastSource, setLastSource] = useState<AiSource | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  // Extraction store
  const {
    items: extractionItems,
    searchQuery,
    statusFilter,
    typeFilter,
    setSearchQuery,
    setStatusFilter,
    setTypeFilter,
    markImported,
  } = useAiExtractionStore();

  const [isImportingAll, setIsImportingAll] = useState(false);
  const [importingSingleId, setImportingSingleId] = useState<string | null>(
    null,
  );

  // Queries & mutations
  const classesQuery = useClasses();
  const subjectsQuery = useSubjects(promptClassId);
  const chaptersQuery = useChapters(promptSubjectId);
  const topicsQuery = useTopics(promptChapterId);
  const configQuery = useAiConfig();
  const generate = useGenerateDrafts();
  const acceptDraft = useAcceptDraft();
  const createQuestion = useCreateQuestion();

  const classes = classesQuery.data ?? [];
  const subjects = subjectsQuery.data ?? [];
  const chapters = chaptersQuery.data ?? [];
  const topics = topicsQuery.data ?? [];

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === promptTopicId) ?? null,
    [topics, promptTopicId],
  );

  const localAiConfig = getStoredAiConfig();
  const hasPersonalKey =
    configQuery.data?.hasPersonalKey ||
    !!localAiConfig.geminiKey ||
    !!localAiConfig.openRouterKey ||
    !!localAiConfig.openAiKey;
  const keyHint = configQuery.data?.keyHint;

  const activeProviderName = useMemo(() => {
    switch (localAiConfig.provider) {
      case "gemini":
        return "Google Gemini 2.0 Flash";
      case "openRouter":
        return "OpenRouter";
      case "openAi":
        return "OpenAI (GPT-4o-mini)";
      default:
        return hasPersonalKey ? "Personal AI Key" : "Built-in Platform AI";
    }
  }, [localAiConfig.provider, hasPersonalKey]);

  /* -------------------------------------------------------------------------- */
  /* Extraction Import Handlers                                                 */
  /* -------------------------------------------------------------------------- */

  const handleImportSingle = async (item: ExtractionItem) => {
    if (!item.targetTopicId) {
      toast.error("Assign a target Topic to this question before importing.");
      return;
    }

    setImportingSingleId(item.id);
    try {
      const topicId = BigInt(item.targetTopicId);

      let answerData: AnswerData;
      if (item.type === "mcq") {
        const opts = (item.options || []).map((text, i) => ({
          id: BigInt(i + 1),
          text,
        }));
        const correctLetter = (item.correctAnswer || "A").toUpperCase();
        const correctIdx = Math.max(0, correctLetter.charCodeAt(0) - 65);
        const correctOptionId = opts[correctIdx]
          ? opts[correctIdx].id
          : BigInt(1);

        answerData = {
          __kind__: "multipleChoice",
          multipleChoice: {
            options: opts,
            correctOptionId,
          },
        };
      } else {
        answerData = {
          __kind__: "shortAnswer",
          shortAnswer: { expected: item.correctAnswer },
        };
      }

      const created = await createQuestion.mutateAsync({
        topicId,
        prompt: item.question,
        questionType:
          item.type === "mcq"
            ? QuestionType.multipleChoice
            : QuestionType.shortAnswer,
        answer: answerData,
        explanation: item.explanation || null,
      });

      if (created) {
        markImported(item.id, created.id.toString());
        toast.success("Added to the topic's question bank!");
      } else {
        toast.error("The selected topic no longer exists.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import question.",
      );
    } finally {
      setImportingSingleId(null);
    }
  };

  const handleImportAllApproved = async () => {
    const approvedItems = extractionItems.filter(
      (i) => i.status === "approved",
    );
    if (approvedItems.length === 0) {
      toast.info("No approved questions ready for import.");
      return;
    }

    const unassigned = approvedItems.filter((i) => !i.targetTopicId);
    if (unassigned.length > 0) {
      toast.error(
        `${unassigned.length} approved question${
          unassigned.length === 1 ? "" : "s"
        } lack a target Topic. Use the bulk assign toolbar to set a topic for all.`,
      );
      return;
    }

    setIsImportingAll(true);
    let successCount = 0;

    for (const item of approvedItems) {
      try {
        const topicId = BigInt(item.targetTopicId!);
        let answerData: AnswerData;

        if (item.type === "mcq") {
          const opts = (item.options || []).map((text, i) => ({
            id: BigInt(i + 1),
            text,
          }));
          const correctLetter = (item.correctAnswer || "A").toUpperCase();
          const correctIdx = Math.max(0, correctLetter.charCodeAt(0) - 65);
          const correctOptionId = opts[correctIdx]
            ? opts[correctIdx].id
            : BigInt(1);

          answerData = {
            __kind__: "multipleChoice",
            multipleChoice: {
              options: opts,
              correctOptionId,
            },
          };
        } else {
          answerData = {
            __kind__: "shortAnswer",
            shortAnswer: { expected: item.correctAnswer },
          };
        }

        const created = await createQuestion.mutateAsync({
          topicId,
          prompt: item.question,
          questionType:
            item.type === "mcq"
              ? QuestionType.multipleChoice
              : QuestionType.shortAnswer,
          answer: answerData,
          explanation: item.explanation || null,
        });

        if (created) {
          markImported(item.id, created.id.toString());
          successCount++;
        }
      } catch (err) {
        console.error("Failed to import question:", item.id, err);
      }
    }

    setIsImportingAll(false);
    toast.success(
      `Successfully imported ${successCount} question${
        successCount === 1 ? "" : "s"
      } into the question bank!`,
    );
  };

  /* -------------------------------------------------------------------------- */
  /* Prompt Generation Handlers                                                 */
  /* -------------------------------------------------------------------------- */

  const handlePromptGenerate = (values: GenerationFormValues) => {
    if (values.topicId === null) {
      toast.error("Choose a topic first.");
      return;
    }
    generate.mutate(
      {
        topicId: values.topicId,
        prompt: values.prompt,
        sourceText:
          values.sourceText.length > 0 ? values.sourceText : undefined,
        count: BigInt(values.count),
      },
      {
        onSuccess: (result) => {
          if (result.__kind__ === "err") {
            const error = result.err;
            if (error.__kind__ === "notConfigured") {
              toast.error(
                "AI is not configured. Add a personal key in AI settings, or use the built-in AI.",
              );
            } else if (error.__kind__ === "invalidRequest") {
              toast.error(error.invalidRequest);
            } else {
              toast.error(error.generationFailed);
            }
            return;
          }
          const gen = result.ok;
          setPromptDrafts(gen.drafts.map((e) => e.draft));
          setLastSource(gen.source);
          if (gen.drafts.length === 0) {
            toast.info(
              "The AI returned no drafts. Try a more specific prompt.",
            );
          } else {
            toast.success(
              `Generated ${gen.drafts.length} draft${
                gen.drafts.length === 1 ? "" : "s"
              }.`,
            );
          }
        },
        onError: (err: Error) => {
          toast.error(err.message);
        },
      },
    );
  };

  const handleAcceptPromptDraft = (draft: DraftQuestion) => {
    setAcceptingId(draft.id.toString());
    acceptDraft.mutate(
      { topicId: draft.topicId, draft },
      {
        onSuccess: (q) => {
          setPromptDrafts((curr) =>
            curr.filter((item) => item.id !== draft.id),
          );
          if (q) {
            toast.success("Added to the topic's question bank.");
          } else {
            toast.error("That topic no longer exists.");
          }
        },
        onError: (err: Error) => toast.error(err.message),
        onSettled: () => setAcceptingId(null),
      },
    );
  };

  const handleDiscardPromptDraft = (draft: DraftQuestion) => {
    setDiscardingId(draft.id.toString());
    setPromptDrafts((curr) => curr.filter((item) => item.id !== draft.id));
    setDiscardingId(null);
  };

  /* -------------------------------------------------------------------------- */
  /* Filtered Extraction Items                                                  */
  /* -------------------------------------------------------------------------- */

  const filteredExtractionItems = useMemo(() => {
    return extractionItems.filter((item) => {
      // Status filter
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      // Type filter
      if (typeFilter !== "all" && item.type !== typeFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesPrompt = item.question.toLowerCase().includes(query);
        const matchesAnswer = item.correctAnswer.toLowerCase().includes(query);
        const matchesOptions = item.options?.some((o) =>
          o.toLowerCase().includes(query),
        );
        if (!matchesPrompt && !matchesAnswer && !matchesOptions) {
          return false;
        }
      }
      return true;
    });
  }, [extractionItems, statusFilter, typeFilter, searchQuery]);

  return (
    <div data-ocid="ai_studio.page" className="mx-auto max-w-6xl space-y-8">
      {/* Page Header */}
      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Wand2 className="size-5" aria-hidden="true" />
          </span>
          <Badge
            variant="secondary"
            className="rounded-full bg-accent/12 text-accent"
          >
            AI Studio
          </Badge>
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          AI Document & Question Studio
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
          Upload PDF test papers or image scans to automatically extract all
          MCQs and Q&A pairs, or generate custom questions by prompt. Review,
          edit, and assign them directly to your question bank.
        </p>
        <div className="h-0.5 w-24 rounded-full bg-gradient-primary" />
      </header>

      {/* AI Configuration Banner */}
      <Card
        data-ocid="ai.config_banner"
        className="rounded-xl border-border bg-card p-4 shadow-subtle md:p-5"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={
                hasPersonalKey
                  ? "flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600"
                  : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"
              }
            >
              {hasPersonalKey ? (
                <CheckCheck className="size-5" aria-hidden="true" />
              ) : (
                <Sparkles className="size-5" aria-hidden="true" />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-display text-base font-semibold text-card-foreground">
                {hasPersonalKey
                  ? localAiConfig.provider === "gemini"
                    ? "Using Google Gemini 2.0 Flash"
                    : localAiConfig.provider === "openRouter"
                      ? "Using OpenRouter"
                      : "Using your personal OpenAI key"
                  : "Using the built-in AI"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {hasPersonalKey
                  ? `Extraction routes through ${activeProviderName}${keyHint ? ` (${keyHint})` : ""}. Built-in AI remains available as a fallback.`
                  : "Generation works right now with the platform's built-in AI — no key required. Add a personal Google Gemini, OpenRouter, or OpenAI key for advanced vision & OCR."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsKeyDrawerOpen(true)}
              className="shrink-0 rounded-lg text-xs"
            >
              <Settings2 className="mr-1.5 size-3.5" />
              AI & Vision Keys
            </Button>

            <Button
              asChild
              variant={hasPersonalKey ? "outline" : "default"}
              size="sm"
              className="shrink-0 rounded-lg text-xs"
            >
              <Link to="/ai-settings" data-ocid="ai.manage_key_link">
                <KeyRound className="mr-1.5 size-3.5" />
                {hasPersonalKey ? "Manage key" : "Add a personal key"}
              </Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Main Studio Mode Tabs */}
      <Tabs
        value={activeStudioTab}
        onValueChange={(val) =>
          setActiveStudioTab(val as "extraction" | "prompt")
        }
        className="space-y-6"
      >
        <TabsList className="h-11 rounded-xl border border-border bg-muted/40 p-1">
          <TabsTrigger
            value="extraction"
            className="rounded-lg px-4 py-2 font-display text-sm data-[state=active]:bg-card data-[state=active]:shadow-xs"
          >
            <FileSearch className="mr-2 size-4 text-primary" />
            PDF & Image Extraction Queue
            {extractionItems.length > 0 && (
              <Badge className="ml-2 h-5 rounded-full bg-primary/15 px-1.5 text-[11px] text-primary">
                {extractionItems.length}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="prompt"
            className="rounded-lg px-4 py-2 font-display text-sm data-[state=active]:bg-card data-[state=active]:shadow-xs"
          >
            <Wand2 className="mr-2 size-4 text-primary" />
            Prompt Question Generator
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Document Extraction & Review Queue */}
        <TabsContent value="extraction" className="space-y-6">
          <ExtractionUploader
            canisterFallback={async (text) => {
              if (!classes[0]) throw new Error("Create a class first");
              const res = await generate.mutateAsync({
                topicId: BigInt(1),
                prompt:
                  "Extract every MCQ and short question from this source text in JSON format",
                sourceText: text,
                count: BigInt(8),
              });
              if (res.__kind__ === "err")
                throw new Error("Fallback generation failed");
              return JSON.stringify({
                items: res.ok.drafts.map((d) => ({
                  type:
                    d.draft.questionType === QuestionType.multipleChoice
                      ? "mcq"
                      : "short_qa",
                  question: d.draft.prompt,
                  options:
                    d.draft.answer.__kind__ === "multipleChoice"
                      ? d.draft.answer.multipleChoice.options.map((o) => o.text)
                      : undefined,
                  correctAnswer:
                    d.draft.answer.__kind__ === "multipleChoice"
                      ? "A"
                      : d.draft.answer.__kind__ === "shortAnswer"
                        ? d.draft.answer.shortAnswer.expected
                        : "True",
                  explanation: d.draft.explanation ?? undefined,
                  inferred: false,
                })),
              });
            }}
          />

          {extractionItems.length > 0 && (
            <div className="space-y-5">
              <BulkActionToolbar
                onImportAllApproved={handleImportAllApproved}
                isImportingAll={isImportingAll}
              />

              {/* Filters & Search Toolbar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {/* Status Tabs */}
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      "all",
                      "pending",
                      "approved",
                      "imported",
                      "rejected",
                    ] as const
                  ).map((st) => (
                    <Button
                      key={st}
                      type="button"
                      variant={statusFilter === st ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setStatusFilter(st)}
                      className={`h-8 rounded-lg text-xs capitalize ${
                        statusFilter === st
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {st}
                    </Button>
                  ))}
                </div>

                {/* Search & Type filter */}
                <div className="flex items-center gap-2">
                  <div className="relative w-48 sm:w-60">
                    <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search questions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>

                  <div className="flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setTypeFilter("all")}
                      className={`rounded-md px-2 py-1 ${
                        typeFilter === "all"
                          ? "bg-muted font-semibold text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setTypeFilter("mcq")}
                      className={`rounded-md px-2 py-1 ${
                        typeFilter === "mcq"
                          ? "bg-muted font-semibold text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      MCQs
                    </button>
                    <button
                      type="button"
                      onClick={() => setTypeFilter("short_qa")}
                      className={`rounded-md px-2 py-1 ${
                        typeFilter === "short_qa"
                          ? "bg-muted font-semibold text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      Q&A
                    </button>
                  </div>
                </div>
              </div>

              {/* Review Cards List */}
              <div className="space-y-4">
                {filteredExtractionItems.length > 0 ? (
                  filteredExtractionItems.map((item, index) => (
                    <ExtractionCard
                      key={item.id}
                      item={item}
                      index={index}
                      onImportSingle={handleImportSingle}
                      isImporting={importingSingleId === item.id}
                    />
                  ))
                ) : (
                  <Card className="rounded-xl border-dashed border-border bg-muted/20 p-8 text-center">
                    <p className="font-display text-base font-medium text-muted-foreground">
                      No questions match the active filters ({statusFilter},{" "}
                      {typeFilter}).
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setStatusFilter("all");
                        setTypeFilter("all");
                        setSearchQuery("");
                      }}
                      className="mt-3 rounded-lg text-xs"
                    >
                      Reset filters
                    </Button>
                  </Card>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* TAB 2: Prompt Generation */}
        <TabsContent value="prompt" className="space-y-6">
          <GenerationForm
            classes={classes}
            subjects={subjects}
            chapters={chapters}
            topics={topics}
            selectedClassId={promptClassId}
            selectedSubjectId={promptSubjectId}
            selectedChapterId={promptChapterId}
            selectedTopicId={promptTopicId}
            onSelectClass={setPromptClassId}
            onSelectSubject={setPromptSubjectId}
            onSelectChapter={setPromptChapterId}
            onSelectTopic={setPromptTopicId}
            isGenerating={generate.isPending}
            onGenerate={handlePromptGenerate}
          />

          {/* Pending Skeleton Loader */}
          {generate.isPending && (
            <Card className="rounded-xl border-border bg-card p-6 shadow-subtle">
              <div className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-primary" />
                <div>
                  <p className="font-display text-base font-semibold text-card-foreground">
                    Drafting questions…
                  </p>
                  <p className="text-sm text-muted-foreground">
                    The AI is analyzing your prompt and crafting
                    curriculum-aligned test questions.
                  </p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {[0, 1, 2].map((id) => (
                  <div
                    key={id}
                    className="space-y-2 rounded-lg border border-border p-4"
                  >
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Prompt Draft Previews */}
          {promptDrafts.length > 0 && (
            <section className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
                    Draft preview
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {promptDrafts.length} draft
                    {promptDrafts.length === 1 ? "" : "s"} for{" "}
                    <span className="font-medium text-foreground">
                      {selectedTopic?.name ?? "the selected topic"}
                    </span>
                    {lastSource && (
                      <>
                        {" "}
                        · generated with{" "}
                        {lastSource === AiSource.personalKey
                          ? "personal key"
                          : "built-in AI"}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPromptDrafts([])}
                    className="rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    Discard all
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                {promptDrafts.map((draft, index) => (
                  <DraftQuestionCard
                    key={draft.id.toString()}
                    draft={draft}
                    index={index}
                    isAccepting={acceptingId === draft.id.toString()}
                    isDiscarding={discardingId === draft.id.toString()}
                    onAccept={handleAcceptPromptDraft}
                    onDiscard={handleDiscardPromptDraft}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Empty Prompt State */}
          {promptDrafts.length === 0 && !generate.isPending && (
            <Card className="rounded-xl border-dashed border-border bg-muted/20 p-8 text-center shadow-none">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/12 text-primary">
                <Sparkles className="size-6" />
              </span>
              <h2 className="mt-4 font-display text-xl font-semibold text-card-foreground">
                No drafts generated yet
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Pick a topic, describe the questions you need, and generate.
                Drafts appear here for review before you accept them.
              </p>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* AI Key & Vision Drawer */}
      <AiKeyDrawer open={isKeyDrawerOpen} onOpenChange={setIsKeyDrawerOpen} />
    </div>
  );
}
