import { DraftCard } from "@/components/ai/DraftCard";
import { ProviderDialog } from "@/components/ai/ProviderDialog";
import { SourcePanel } from "@/components/ai/SourcePanel";
import { TargetPicker } from "@/components/ai/TargetPicker";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAiExtraction, useAiProviders } from "@/hooks/useAiExtraction";
import { useAiImport } from "@/hooks/useAiImport";
import {
  useChapters,
  useClasses,
  useSubjects,
  useTopicPath,
  useTopics,
} from "@/hooks/useContent";
import {
  type StudioDraft,
  countByStatus,
  filterDrafts,
  useStudioStore,
} from "@/lib/ai/studioStore";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileSearch,
  Layers3,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/** 6, 9, 10, 11, 16 reads better as "6, 9–11, 16" in a line of prose. */
function pageRanges(pages: number[]): string {
  const runs: Array<{ from: number; to: number }> = [];
  for (const page of pages) {
    const last = runs[runs.length - 1];
    if (last && page === last.to + 1) last.to = page;
    else runs.push({ from: page, to: page });
  }
  return runs
    .map((run) =>
      run.from === run.to ? `${run.from}` : `${run.from}–${run.to}`,
    )
    .join(", ");
}

function toId(value: string | null): bigint | null {
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

const STATUS_TABS = [
  "all",
  "pending",
  "approved",
  "imported",
  "rejected",
] as const;
const KIND_TABS = ["all", "mcq", "qa"] as const;

/**
 * How many drafts are on screen at once. A 160-question extraction is taller
 * than the scrollbar can usefully navigate, so the rest waits behind a
 * "show more" step that also keeps the page's first paint cheap.
 */
const DRAFTS_PER_PAGE = 25;

export default function AiStudio() {
  const { providers, connect, choose, disconnect, chooseOffline, followKey } =
    useAiProviders();
  const extraction = useAiExtraction();
  const { importDraft, importApproved, importingId, isImportingAll } =
    useAiImport();

  const drafts = useStudioStore((state) => state.drafts);
  const source = useStudioStore((state) => state.source);
  const target = useStudioStore((state) => state.target);
  const filters = useStudioStore((state) => state.filters);
  const setTarget = useStudioStore((state) => state.setTarget);
  const setFilters = useStudioStore((state) => state.setFilters);
  const patchDraft = useStudioStore((state) => state.patchDraft);
  const setDraftStatus = useStudioStore((state) => state.setDraftStatus);
  const removeDraft = useStudioStore((state) => state.removeDraft);
  const approveAllPending = useStudioStore((state) => state.approveAllPending);
  const clearQueue = useStudioStore((state) => state.clearQueue);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleDrafts, setVisibleDrafts] = useState(DRAFTS_PER_PAGE);
  const queueRef = useRef<HTMLDivElement>(null);

  // A topic page hands its topic over with `?topic=`, so the reviewer does not
  // have to walk the class tree again on the way to the studio.
  const topicParam = useRouterState({
    select: (state) =>
      (state.location.search as { topic?: string } | undefined)?.topic,
  });
  const topicIdParam = toId(topicParam ?? null);
  const pathQuery = useTopicPath(topicIdParam);
  const pathApplied = useRef<string | null>(null);

  const classesQuery = useClasses();
  const classes = classesQuery.data ?? [];
  const subjectsQuery = useSubjects(toId(target.classId));
  const chaptersQuery = useChapters(toId(target.subjectId));
  const topicsQuery = useTopics(toId(target.chapterId));
  const topicPath = useMemo(() => {
    const className = classes.find(
      (item) => item.id.toString() === target.classId,
    )?.name;
    const subjectName = (subjectsQuery.data ?? []).find(
      (item) => item.id.toString() === target.subjectId,
    )?.name;
    const chapterName = (chaptersQuery.data ?? []).find(
      (item) => item.id.toString() === target.chapterId,
    )?.name;
    const topicName = (topicsQuery.data ?? []).find(
      (item) => item.id.toString() === target.topicId,
    )?.name;
    return [className, subjectName, chapterName, topicName]
      .filter(Boolean)
      .join(" › ");
  }, [
    classes,
    chaptersQuery.data,
    subjectsQuery.data,
    target.chapterId,
    target.classId,
    target.subjectId,
    target.topicId,
    topicsQuery.data,
  ]);

  /**
   * Fill the picker from a topic id in the URL. One query resolves the whole
   * chain, so this happens once rather than walking the levels.
   */
  useEffect(() => {
    const path = pathQuery.data;
    if (!topicParam || !path || pathApplied.current === topicParam) return;
    setTarget({
      classId: path.class.id.toString(),
      subjectId: path.subject.id.toString(),
      chapterId: path.chapter.id.toString(),
      topicId: path.topic.id.toString(),
    });
    pathApplied.current = topicParam;
  }, [pathQuery.data, setTarget, topicParam]);

  const engineIsModel = providers.active !== null;
  const engineLabel = providers.active
    ? providers.active.provider.name
    : "Offline parser";

  const filtered = useMemo(
    () => filterDrafts(drafts, filters),
    [drafts, filters],
  );
  const counts = useMemo(() => countByStatus(drafts), [drafts]);
  const missing = source?.missing ?? [];
  const visible = filtered.slice(0, visibleDrafts);

  /**
   * A filter change restarts the list at its first page: landing mid-way down a
   * queue the reviewer has not seen under the new filter reads as lost items.
   */
  const applyFilters = (next: Partial<typeof filters>) => {
    setFilters(next);
    setVisibleDrafts(DRAFTS_PER_PAGE);
  };
  const approvedReady = drafts.filter(
    (draft) => draft.status === "approved",
  ).length;

  const runExtraction = async (forceOffline: boolean) => {
    try {
      const result = await extraction.run(forceOffline);
      if (result.drafts.length === 0) {
        toast.info(
          result.engine === "offline"
            ? "No numbered questions found in this text. Try a vision model, or format the questions as numbered items."
            : "Nothing on this page looked like a question.",
        );
        return;
      }
      setVisibleDrafts(DRAFTS_PER_PAGE);
      // Name the reason a section was lost: "run again" is wrong advice for a
      // refused key, and retrying is what produced the message in the first place.
      const lost =
        result.skipped > 0
          ? ` · ${result.skipped} section${
              result.skipped === 1 ? "" : "s"
            } not read${
              result.warnings[0]
                ? `: ${result.warnings[0]}`
                : ", run again to retry them"
            }`
          : "";
      const made = `${result.drafts.length} question${
        result.drafts.length === 1 ? "" : "s"
      }`;
      // A retry that only filled in the pages a previous run lost is not a new
      // queue, and saying "extracted" over it would hide what happened.
      const merged = result.queued > result.drafts.length;
      const summary = `${made} ${merged ? "added to the queue" : "extracted"}${
        result.providerName ? ` with ${result.providerName}` : " offline"
      }${result.model ? ` — ${result.model} answered instead` : ""}${
        merged ? ` · ${result.queued} in the queue` : ""
      }${lost}. Review them below.`;
      if (result.skipped > 0) toast.warning(summary);
      else toast.success(summary);
      queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Extraction failed.",
      );
    }
  };

  const saveOne = async (draft: StudioDraft) => {
    if (!target.topicId) {
      toast.error("Choose the topic to save into first.");
      return;
    }
    try {
      const result = await importDraft(draft, BigInt(target.topicId));
      if (result.saved === 1) {
        toast.success("Question saved to the topic.");
      } else {
        toast.error("This draft needs a fix before it can be saved.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the question.",
      );
    }
  };

  const saveApproved = async () => {
    if (!target.topicId) {
      toast.error("Choose the topic to save into first.");
      return;
    }
    if (approvedReady === 0) {
      toast.info("Nothing is approved yet.");
      return;
    }
    try {
      const result = await importApproved(drafts, BigInt(target.topicId));
      if (result.failures.length > 0) {
        toast.warning(
          `${result.saved} saved, ${result.skipped} skipped. First problem: ${result.failures[0]}`,
          { duration: 8000 },
        );
      } else if (result.skipped > 0) {
        toast.warning(
          `${result.saved} saved, ${result.skipped} skipped — those drafts need a fix.`,
        );
      } else {
        toast.success(
          `${result.saved} question${result.saved === 1 ? "" : "s"} added to the topic.`,
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not save the questions.",
      );
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6" data-ocid="ai_studio.page">
      <PageHeader
        eyebrow="AI Studio"
        title="Turn a PDF or image into questions"
        description="Upload a test paper or a photo of a page. Every MCQ and question-answer pair on it is pulled out as a draft you can fix, approve and save into a topic's question bank."
        actions={
          <Badge
            variant="outline"
            className={
              engineIsModel
                ? "rounded-full border-primary/30 bg-primary/10 text-primary"
                : "rounded-full border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            }
          >
            <Sparkles className="mr-1.5 size-3" aria-hidden="true" />
            {engineLabel}
          </Badge>
        }
      />

      <SourcePanel
        document={extraction.document}
        summary={extraction.summary}
        pasteText={extraction.pasteText}
        onPasteText={extraction.setPasteText}
        onFile={(file) => void extraction.loadFile(file)}
        onClearFile={extraction.clearFile}
        phase={extraction.phase}
        progress={extraction.progress}
        error={extraction.error}
        onDismissError={() => extraction.setError(null)}
        engineLabel={engineLabel}
        engineIsModel={engineIsModel}
        textAvailable={
          (extraction.effectiveSource !== null &&
            extraction.effectiveSource.text.trim().length > 0) ||
          extraction.pasteText.trim().length > 0
        }
        onRun={() => void runExtraction(false)}
        onRunOffline={() => void runExtraction(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <TargetPicker target={target} onChange={setTarget} />

      <div ref={queueRef} className="space-y-5 scroll-mt-20">
        {drafts.length > 0 ? (
          // Stays under the app header while the queue scrolls: the approve,
          // save and filter controls belong to the whole list, not to one card,
          // and a 160-question queue puts them out of reach otherwise.
          <Card className="sticky top-16 z-30 rounded-xl border-border bg-card/95 p-4 shadow-subtle backdrop-blur supports-[backdrop-filter]:bg-card/80">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Layers3 className="size-4 text-primary" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {drafts.length} draft{drafts.length === 1 ? "" : "s"} from{" "}
                  {source?.fileName ?? "a document"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {counts.pending} to review · {counts.approved} approved ·{" "}
                  {counts.imported} saved
                </span>
                {/* A toast fades; a queue that is short by ten pages stays
                    short, so the gap has to be readable whenever it is looked at. */}
                {missing.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle
                      className="size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    page {pageRanges(missing)} not read — extract again to fetch{" "}
                    {missing.length === 1 ? "it" : "them"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="action"
                  onClick={approveAllPending}
                  data-ocid="ai_studio.approve_all_button"
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  Approve all pending
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="action"
                  disabled={
                    approvedReady === 0 ||
                    target.topicId === null ||
                    isImportingAll
                  }
                  onClick={() => void saveApproved()}
                  data-ocid="ai_studio.import_all_button"
                >
                  {isImportingAll ? (
                    <Loader2
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Save {approvedReady > 0 ? approvedReady : ""} approved
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  size="action"
                  onClick={clearQueue}
                  className="hover:text-destructive"
                  data-ocid="ai_studio.clear_queue_button"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Clear
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1">
                {STATUS_TABS.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    variant={filters.status === status ? "default" : "quiet"}
                    size="chip"
                    onClick={() => applyFilters({ status })}
                    data-ocid={`ai_studio.status_filter.${status}`}
                  >
                    {status === "all" ? "All" : status}
                    {status !== "all" ? ` (${counts[status]})` : ""}
                  </Button>
                ))}
                <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                {KIND_TABS.map((kind) => (
                  <Button
                    key={kind}
                    type="button"
                    variant={filters.kind === kind ? "default" : "quiet"}
                    size="chip"
                    onClick={() => applyFilters({ kind })}
                    data-ocid={`ai_studio.kind_filter.${kind}`}
                  >
                    {kind === "all"
                      ? "Both types"
                      : kind === "mcq"
                        ? "MCQs"
                        : "Q&A"}
                  </Button>
                ))}
              </div>
              <div className="lg:w-64">
                <Input
                  value={filters.query}
                  onChange={(event) =>
                    applyFilters({ query: event.target.value })
                  }
                  placeholder="Search the drafts"
                  aria-label="Search drafts"
                  className="h-8 text-xs"
                  data-ocid="ai_studio.search_input"
                />
              </div>
            </div>
          </Card>
        ) : null}

        {drafts.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="No drafts yet"
            action={
              classes.length === 0 ? (
                <Button
                  asChild
                  variant="outline"
                  size="action"
                  data-ocid="ai_studio.empty_classes_link"
                >
                  <Link to="/classes">Build a class first</Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="action"
                  onClick={() => setSettingsOpen(true)}
                  data-ocid="ai_studio.empty_settings_button"
                >
                  <Wand2 className="size-3.5" aria-hidden="true" />
                  Connect an AI key
                </Button>
              )
            }
            description="Upload a PDF or an image above and extract from it. Nothing enters your question bank until you approve it here."
          />
        ) : filtered.length === 0 ? (
          <Card className="rounded-xl border-dashed border-border bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No drafts match these filters.
            </p>
            <Button
              type="button"
              variant="outline"
              size="action"
              onClick={() =>
                applyFilters({ status: "all", kind: "all", query: "" })
              }
              className="mt-3"
            >
              Reset filters
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {visible.map((draft, index) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                index={index}
                topicLabel={
                  target.topicId ? topicPath || "the selected topic" : null
                }
                isSaving={importingId === draft.id}
                onPatch={(updates) => patchDraft(draft.id, updates)}
                onStatus={(status) => setDraftStatus(draft.id, status)}
                onRemove={() => removeDraft(draft.id)}
                onImport={() => void saveOne(draft)}
              />
            ))}

            {filtered.length > visible.length ? (
              <div className="flex flex-col items-center gap-2 pt-1">
                <p
                  className="text-xs text-muted-foreground"
                  data-ocid="ai_studio.showing_count"
                >
                  Showing {visible.length} of {filtered.length}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="action"
                  onClick={() =>
                    setVisibleDrafts((count) => count + DRAFTS_PER_PAGE)
                  }
                  data-ocid="ai_studio.show_more_button"
                >
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                  Show{" "}
                  {Math.min(DRAFTS_PER_PAGE, filtered.length - visible.length)}{" "}
                  more
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <ProviderDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        providers={providers}
        onConnect={connect}
        onChoose={choose}
        onDisconnect={disconnect}
        onChooseOffline={chooseOffline}
        onFollowKey={followKey}
      />
    </div>
  );
}
