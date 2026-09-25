import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { ClassCard } from "@/components/content/ClassCard";
import {
  EntityFormDialog,
  type EntityFormValues,
} from "@/components/content/EntityFormDialog";
import { Button } from "@/components/ui/button";
import {
  useClasses,
  useCreateClass,
  useDeleteClass,
  useRenameClass,
} from "@/hooks/useContent";
import type { ClassSummary } from "@/types";
import { GraduationCap, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Classes() {
  const classesQuery = useClasses();
  const createClass = useCreateClass();
  const renameClass = useRenameClass();
  const deleteClass = useDeleteClass();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClassSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClassSummary | null>(null);

  const classes = classesQuery.data ?? [];

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openRename(target: ClassSummary) {
    setEditing(target);
    setFormOpen(true);
  }

  function handleSubmit(values: EntityFormValues) {
    const description =
      values.description.length > 0 ? values.description : null;
    if (editing) {
      renameClass.mutate(
        { classId: editing.id, name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Class updated");
          },
          onError: () =>
            toast.error("Couldn't update class. Please try again."),
        },
      );
    } else {
      createClass.mutate(
        { name: values.name, description },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Class created");
          },
          onError: () =>
            toast.error("Couldn't create class. Please try again."),
        },
      );
    }
  }

  function handleDelete() {
    if (!pendingDelete) return;
    deleteClass.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success("Class deleted");
      },
      onError: () => toast.error("Couldn't delete class. Please try again."),
    });
  }

  return (
    <div data-ocid="classes.page" className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Classes"
        description="Your top-level courses. Each class holds its own subjects, chapters, and topics."
        actions={
          <Button
            type="button"
            data-ocid="classes.create_button"
            onClick={openCreate}
          >
            <Plus className="size-4" aria-hidden="true" />
            New class
          </Button>
        }
      />

      {classesQuery.isLoading ? (
        <LoadingState label="Loading your classes…" variant="cards" />
      ) : classesQuery.isError ? (
        <ErrorState
          title="Couldn't load classes"
          description="Something went wrong while fetching your classes."
          onRetry={() => void classesQuery.refetch()}
        />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No classes yet"
          description="Create your first class to start organising subjects, chapters, and questions."
          action={
            <Button
              type="button"
              data-ocid="classes.empty_state.create_button"
              onClick={openCreate}
            >
              <Plus className="size-4" aria-hidden="true" />
              Create a class
            </Button>
          }
        />
      ) : (
        <div
          data-ocid="classes.list"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {classes.map((classSummary, index) => (
            <ClassCard
              key={classSummary.id.toString()}
              classSummary={classSummary}
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
        marker="class"
        title={editing ? "Rename class" : "New class"}
        description={
          editing
            ? "Update the class name and description."
            : "Give your class a clear name so it's easy to find later."
        }
        submitLabel={editing ? "Save changes" : "Create class"}
        initialValues={
          editing
            ? { name: editing.name, description: editing.description ?? "" }
            : undefined
        }
        pending={createClass.isPending || renameClass.isPending}
        errorMessage={
          createClass.isError || renameClass.isError
            ? "Couldn't save the class. Please try again."
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
        description="This permanently removes the class and every subject, chapter, topic, and question inside it. This cannot be undone."
        confirmLabel="Delete class"
        destructive
        onConfirm={handleDelete}
      />
    </div>
  );
}
