import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { ChapterCard } from "@/components/content/ChapterCard";
import {
  EntityFormDialog,
  type EntityFormValues,
} from "@/components/content/EntityFormDialog";
import { Button } from "@/components/ui/button";
import {
  useChapters,
  useCreateChapter,
  useDeleteChapter,
  useRenameChapter,
  useSubject,
} from "@/hooks/useContent";
import type { ChapterSummary } from "@/types";
import { Link, useParams } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function SubjectDetail() {
  const { subjectId } = useParams({ from: "/app/subjects/$subjectId" });
  const id = BigInt(subjectId);

  const subjectQuery = useSubject(id);
  const chaptersQuery = useChapters(id);
  const createChapter = useCreateChapter();
  const renameChapter = useRenameChapter();
  const deleteChapter = useDeleteChapter();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ChapterSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChapterSummary | null>(
    null,
  );

  const chapters = chaptersQuery.data ?? [];
  const subject = subjectQuery.data?.subject;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openRename(target: ChapterSummary) {
    setEditing(target);
    setFormOpen(true);
  }

  function handleSubmit(values: EntityFormValues) {
    const description =
      values.description.length > 0 ? values.description : null;
    if (editing) {
      renameChapter.mutate(
        { chapterId: editing.id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Chapter updated");
          },
          onError: () =>
            toast.error("Couldn't update chapter. Please try again."),
        },
      );
    } else {
      createChapter.mutate(
        { subjectId: id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Chapter created");
          },
          onError: () =>
            toast.error("Couldn't create chapter. Please try again."),
        },
      );
    }
  }

  function handleDelete() {
    if (!pendingDelete) return;
    deleteChapter.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success("Chapter deleted");
      },
      onError: () => toast.error("Couldn't delete chapter. Please try again."),
    });
  }

  if (subjectQuery.isLoading) {
    return <LoadingState label="Loading subject…" />;
  }

  if (subjectQuery.isError || !subject) {
    return (
      <ErrorState
        title="Subject not found"
        description="This subject may have been deleted, or the link is incorrect."
        onRetry={() => void subjectQuery.refetch()}
      />
    );
  }

  return (
    <div data-ocid="subject_detail.page" className="space-y-8">
      <Breadcrumbs
        items={[
          { label: "Classes", to: "/classes" },
          { label: "Class", to: `/classes/${subject.classId.toString()}` },
          { label: subject.name },
        ]}
      />

      <PageHeader
        eyebrow="Subject"
        title={subject.name}
        description={
          subject.description?.trim() ||
          "Break this subject into chapters, then add topics and questions."
        }
        actions={
          <Button
            type="button"
            className="rounded-full bg-gradient-primary text-primary-foreground"
            onClick={openCreate}
            data-ocid="subject_detail.create_chapter_button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New chapter
          </Button>
        }
      />

      {chaptersQuery.isLoading ? (
        <LoadingState variant="cards" rows={3} label="Loading chapters…" />
      ) : chaptersQuery.isError ? (
        <ErrorState
          title="Couldn't load chapters"
          description="Something went wrong while fetching this subject's chapters."
          onRetry={() => void chaptersQuery.refetch()}
        />
      ) : chapters.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No chapters yet"
          description="Chapters are the teaching units inside a subject. Add one to start organising topics."
          action={
            <Button
              type="button"
              className="rounded-full"
              onClick={openCreate}
              data-ocid="subject_detail.empty_state.create_chapter_button"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create a chapter
            </Button>
          }
        />
      ) : (
        <div
          className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-ocid="chapters.list"
        >
          {chapters.map((chapter, index) => (
            <ChapterCard
              key={chapter.id.toString()}
              chapter={chapter}
              index={index}
              onRename={openRename}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <EntityFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        marker="chapter"
        title={editing ? "Rename chapter" : "New chapter"}
        description={
          editing
            ? "Update the chapter name and description."
            : "Give the chapter a clear name so it's easy to find later."
        }
        submitLabel={editing ? "Save changes" : "Create chapter"}
        initialValues={
          editing
            ? { name: editing.name, description: editing.description ?? "" }
            : undefined
        }
        pending={createChapter.isPending || renameChapter.isPending}
        errorMessage={
          createChapter.isError || renameChapter.isError
            ? "Couldn't save the chapter. Please try again."
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
        description="This permanently removes the chapter and every topic and question inside it. This cannot be undone."
        confirmLabel="Delete chapter"
        destructive
        onConfirm={handleDelete}
      />

      <p className="text-sm text-muted-foreground">
        Looking for the class?{" "}
        <Link
          to="/classes/$classId"
          params={{ classId: subject.classId.toString() }}
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Back to the class
        </Link>
      </p>
    </div>
  );
}
