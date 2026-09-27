import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import {
  EntityFormDialog,
  type EntityFormValues,
} from "@/components/content/EntityFormDialog";
import { TopicCard } from "@/components/content/TopicCard";
import { Button } from "@/components/ui/button";
import {
  useChapter,
  useCreateTopic,
  useDeleteTopic,
  useRenameTopic,
  useTopics,
} from "@/hooks/useContent";
import type { TopicSummary } from "@/types";
import { Link, useParams } from "@tanstack/react-router";
import { HelpCircle, Plus, Share2, Timer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ChapterDetail() {
  const { chapterId } = useParams({ from: "/app/chapters/$chapterId" });
  const id = BigInt(chapterId);

  const chapterQuery = useChapter(id);
  const topicsQuery = useTopics(id);
  const createTopic = useCreateTopic();
  const renameTopic = useRenameTopic();
  const deleteTopic = useDeleteTopic();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TopicSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TopicSummary | null>(null);

  const topics = topicsQuery.data ?? [];
  const chapter = chapterQuery.data?.chapter;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openRename(target: TopicSummary) {
    setEditing(target);
    setFormOpen(true);
  }

  function handleSubmit(values: EntityFormValues) {
    const description =
      values.description.length > 0 ? values.description : null;
    if (editing) {
      renameTopic.mutate(
        { topicId: editing.id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Topic updated");
          },
          onError: () =>
            toast.error("Couldn't update topic. Please try again."),
        },
      );
    } else {
      createTopic.mutate(
        { chapterId: id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Topic created");
          },
          onError: () =>
            toast.error("Couldn't create topic. Please try again."),
        },
      );
    }
  }

  function handleDelete() {
    if (!pendingDelete) return;
    deleteTopic.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success("Topic deleted");
      },
      onError: () => toast.error("Couldn't delete topic. Please try again."),
    });
  }

  if (chapterQuery.isLoading) {
    return <LoadingState label="Loading chapter…" />;
  }

  if (chapterQuery.isError || !chapter) {
    return (
      <ErrorState
        title="Chapter not found"
        description="This chapter may have been deleted, or the link is incorrect."
        onRetry={() => void chapterQuery.refetch()}
      />
    );
  }

  return (
    <div data-ocid="chapter_detail.page" className="space-y-8">
      <Breadcrumbs
        items={[
          { label: "Classes", to: "/classes" },
          { label: "Subject", to: `/subjects/${chapter.subjectId.toString()}` },
          { label: chapter.name },
        ]}
      />

      <PageHeader
        eyebrow="Chapter"
        title={chapter.name}
        description={
          chapter.description?.trim() ||
          "Topics are the smallest unit you author questions for. Add one to begin."
        }
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full">
              <Link
                to="/share"
                search={{ chapter: chapter.id.toString() }}
                data-ocid="chapter_detail.share_link"
              >
                <Share2 className="size-4" aria-hidden="true" />
                Share
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="rounded-full"
              aria-disabled={topics.length === 0}
            >
              <Link
                to="/test-builder"
                search={{ chapter: chapter.id.toString(), mode: "timed" }}
                data-ocid="chapter_detail.timed_test_button"
                className={
                  topics.length === 0
                    ? "pointer-events-none opacity-50"
                    : undefined
                }
              >
                <Timer className="size-4" aria-hidden="true" />
                Timed test
              </Link>
            </Button>
            <Button
              type="button"
              className="rounded-full bg-gradient-primary text-primary-foreground"
              onClick={openCreate}
              data-ocid="chapter_detail.create_topic_button"
            >
              <Plus className="size-4" aria-hidden="true" />
              New topic
            </Button>
          </>
        }
      />

      {topicsQuery.isLoading ? (
        <LoadingState variant="cards" rows={3} label="Loading topics…" />
      ) : topicsQuery.isError ? (
        <ErrorState
          title="Couldn't load topics"
          description="Something went wrong while fetching this chapter's topics."
          onRetry={() => void topicsQuery.refetch()}
        />
      ) : topics.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="No topics yet"
          description="Topics hold the questions. Create one, then author questions or generate a first draft with AI."
          action={
            <Button
              type="button"
              className="rounded-full"
              onClick={openCreate}
              data-ocid="chapter_detail.empty_state.create_topic_button"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create a topic
            </Button>
          }
        />
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-ocid="topics.list"
        >
          {topics.map((topic, index) => (
            <TopicCard
              key={topic.id.toString()}
              topic={topic}
              index={index}
              onRename={openRename}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-muted/30 px-5 py-4">
        <Timer className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Open a topic to run a practice session or a timed test on its
          questions.
        </p>
      </div>

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        marker="topic"
        title={editing ? "Rename topic" : "New topic"}
        description={
          editing
            ? "Update the topic name and description."
            : "Give the topic a clear name so it's easy to find later."
        }
        submitLabel={editing ? "Save changes" : "Create topic"}
        initialValues={
          editing
            ? { name: editing.name, description: editing.description ?? "" }
            : undefined
        }
        pending={createTopic.isPending || renameTopic.isPending}
        errorMessage={
          createTopic.isError || renameTopic.isError
            ? "Couldn't save the topic. Please try again."
            : null
        }
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        trigger={<span className="hidden" aria-hidden="true" />}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        description="This permanently removes the topic and every question inside it. This cannot be undone."
        confirmLabel="Delete topic"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
