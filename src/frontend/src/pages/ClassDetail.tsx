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
import { SubjectCard } from "@/components/content/SubjectCard";
import { Button } from "@/components/ui/button";
import {
  useClass,
  useCreateSubject,
  useDeleteSubject,
  useRenameSubject,
  useSubjects,
} from "@/hooks/useContent";
import type { SubjectSummary } from "@/types";
import { Link, useParams } from "@tanstack/react-router";
import { BookOpen, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ClassDetail() {
  const { classId } = useParams({ from: "/app/classes/$classId" });
  const id = BigInt(classId);

  const classQuery = useClass(id);
  const subjectsQuery = useSubjects(id);
  const createSubject = useCreateSubject();
  const renameSubject = useRenameSubject();
  const deleteSubject = useDeleteSubject();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SubjectSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SubjectSummary | null>(
    null,
  );

  const subjects = subjectsQuery.data ?? [];
  const classSummary = classQuery.data?.class;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openRename(target: SubjectSummary) {
    setEditing(target);
    setFormOpen(true);
  }

  function handleSubmit(values: EntityFormValues) {
    const description =
      values.description.length > 0 ? values.description : null;
    if (editing) {
      renameSubject.mutate(
        { subjectId: editing.id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Subject updated");
          },
          onError: () =>
            toast.error("Couldn't update subject. Please try again."),
        },
      );
    } else {
      createSubject.mutate(
        { classId: id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Subject created");
          },
          onError: () =>
            toast.error("Couldn't create subject. Please try again."),
        },
      );
    }
  }

  function handleDelete() {
    if (!pendingDelete) return;
    deleteSubject.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success("Subject deleted");
      },
      onError: () => toast.error("Couldn't delete subject. Please try again."),
    });
  }

  if (classQuery.isLoading) {
    return <LoadingState label="Loading class…" />;
  }

  if (classQuery.isError || !classSummary) {
    return (
      <ErrorState
        title="Class not found"
        description="This class may have been deleted, or the link is incorrect."
        onRetry={() => void classQuery.refetch()}
      />
    );
  }

  return (
    <div data-ocid="class_detail.page" className="space-y-8">
      <Breadcrumbs
        items={[
          { label: "Classes", to: "/classes" },
          { label: classSummary.name },
        ]}
      />

      <PageHeader
        eyebrow="Class"
        title={classSummary.name}
        description={
          classSummary.description?.trim() ||
          "Add subjects to organise this class into its disciplines."
        }
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/ai-studio" data-ocid="class_detail.ai_studio_link">
                <Sparkles className="size-4" aria-hidden="true" />
                AI Studio
              </Link>
            </Button>
            <Button
              type="button"
              className="rounded-full bg-gradient-primary text-primary-foreground"
              onClick={openCreate}
              data-ocid="class_detail.create_subject_button"
            >
              <Plus className="size-4" aria-hidden="true" />
              New subject
            </Button>
          </>
        }
      />

      {subjectsQuery.isLoading ? (
        <LoadingState variant="cards" rows={3} label="Loading subjects…" />
      ) : subjectsQuery.isError ? (
        <ErrorState
          title="Couldn't load subjects"
          description="Something went wrong while fetching this class's subjects."
          onRetry={() => void subjectsQuery.refetch()}
        />
      ) : subjects.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No subjects yet"
          description="Subjects split a class into its disciplines. Add your first one to keep building the hierarchy."
          action={
            <Button
              type="button"
              className="rounded-full"
              onClick={openCreate}
              data-ocid="class_detail.empty_state.create_subject_button"
            >
              <Plus className="size-4" aria-hidden="true" />
              Create a subject
            </Button>
          }
        />
      ) : (
        <div
          className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          data-ocid="subjects.list"
        >
          {subjects.map((subject, index) => (
            <SubjectCard
              key={subject.id.toString()}
              subject={subject}
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
        marker="subject"
        title={editing ? "Rename subject" : "New subject"}
        description={
          editing
            ? "Update the subject name and description."
            : "Give the subject a clear name so it's easy to find later."
        }
        submitLabel={editing ? "Save changes" : "Create subject"}
        initialValues={
          editing
            ? { name: editing.name, description: editing.description ?? "" }
            : undefined
        }
        pending={createSubject.isPending || renameSubject.isPending}
        errorMessage={
          createSubject.isError || renameSubject.isError
            ? "Couldn't save the subject. Please try again."
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
        description="This permanently removes the subject and every chapter, topic, and question inside it. This cannot be undone."
        confirmLabel="Delete subject"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
