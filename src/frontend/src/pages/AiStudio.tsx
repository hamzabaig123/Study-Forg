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
  Check,
  FileSearch,
  Layers3,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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

export default function AiStudio() {
  const { providers, connect, disconnect, chooseOffline, followKey } =
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
      toast.success(
        `${result.drafts.length} question${
          result.drafts.length === 1 ? "" : "s"
        } extracted${
          result.providerName ? ` with ${result.providerName}` : " offline"
        }. Review them below.`,
      );
      queueRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Extraction failed.",
      );
    }
  };

  const saveOne = async (draft: StudioDraft) => {
    if (!target.topicId) return;
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
      if (result.skipped > 0) {
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

      <div ref={queueRef} className="space-y-5">
        {drafts.length > 0 ? (
          <Card className="rounded-xl border-border bg-card p-4 shadow-subtle">
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
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={approveAllPending}
                  className="rounded-lg text-xs"
                  data-ocid="ai_studio.approve_all_button"
                >
                  <Check className="mr-1.5 size-3.5" aria-hidden="true" />
                  Approve all pending
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    approvedReady === 0 ||
                    target.topicId === null ||
                    isImportingAll
                  }
                  onClick={() => void saveApproved()}
                  className="rounded-lg bg-gradient-primary text-primary-foreground"
                  data-ocid="ai_studio.import_all_button"
                >
                  {isImportingAll ? (
                    <Loader2
                      className="mr-1.5 size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : null}
                  Save {approvedReady > 0 ? approvedReady : ""} approved
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearQueue}
                  className="rounded-lg text-xs text-muted-foreground hover:text-destructive"
                  data-ocid="ai_studio.clear_queue_button"
                >
                  <Trash2 className="mr-1.5 size-3.5" aria-hidden="true" />
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
                    variant={filters.status === status ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFilters({ status })}
                    className={
                      filters.status === status
                        ? "h-7 rounded-lg text-xs"
                        : "h-7 rounded-lg text-xs text-muted-foreground"
                    }
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
                    variant={filters.kind === kind ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setFilters({ kind })}
                    className={
                      filters.kind === kind
                        ? "h-7 rounded-lg text-xs"
                        : "h-7 rounded-lg text-xs text-muted-foreground"
                    }
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
                    setFilters({ query: event.target.value })
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
                <Button asChild variant="outline" className="rounded-full">
                  <Link to="/classes" data-ocid="ai_studio.empty_classes_link">
                    Build a class first
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => setSettingsOpen(true)}
                  data-ocid="ai_studio.empty_settings_button"
                >
                  <Wand2 className="mr-2 size-4" aria-hidden="true" />
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
              size="sm"
              onClick={() =>
                setFilters({ status: "all", kind: "all", query: "" })
              }
              className="mt-3 rounded-lg text-xs"
            >
              Reset filters
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {filtered.map((draft, index) => (
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
          </div>
        )}
      </div>

      <ProviderDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        providers={providers}
        onConnect={connect}
        onDisconnect={disconnect}
        onChooseOffline={chooseOffline}
        onFollowKey={followKey}
      />
    </div>
  );
}
