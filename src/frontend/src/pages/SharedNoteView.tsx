import { PublicLayout } from "@/components/layout/AppLayout";
import { NoteRenderer } from "@/components/notes/NoteRenderer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSharedNote } from "@/hooks/useNotes";
import { formatDate } from "@/lib/format";
import { useParams } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Lock, Share2 } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

function SharedNoteSkeleton() {
  const ids = Array.from({ length: 4 }, (_, i) => `shared-note-skeleton-${i}`);
  return (
    <div
      data-ocid="shared_note.loading_state"
      className="mx-auto max-w-3xl px-6 py-16"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-6 h-10 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/3" />
      <div className="mt-10 flex flex-col gap-4">
        {ids.map((id) => (
          <Skeleton key={id} className="h-5 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading shared note…</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Unavailable                                                                 */
/* -------------------------------------------------------------------------- */

function SharedNoteUnavailable() {
  return (
    <div
      data-ocid="shared_note.unavailable_state"
      className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center animate-fade-up"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <h1 className="mt-6 text-balance text-3xl">This note isn't available</h1>
      <p className="mt-4 text-pretty text-muted-foreground">
        The share link may have been revoked by its owner, or the note may have
        been deleted. Ask the person who shared it for a fresh link.
      </p>
      <Button
        asChild
        className="mt-8 rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
      >
        <a href="/" data-ocid="shared_note.home_button">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to StudyForge
        </a>
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function SharedNoteView() {
  const { token } = useParams({ strict: false }) as { token: string };
  const { data: note, isLoading, isError } = useSharedNote(token);

  if (isLoading) {
    return (
      <PublicLayout>
        <SharedNoteSkeleton />
      </PublicLayout>
    );
  }

  if (isError || !note) {
    return (
      <PublicLayout>
        <SharedNoteUnavailable />
      </PublicLayout>
    );
  }

  const updatedAt = formatDate(note.updatedAt);

  return (
    <PublicLayout>
      <article
        data-ocid="shared_note.page"
        className="mx-auto max-w-3xl px-6 py-16 animate-fade-up"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Share2 className="size-3.5" aria-hidden="true" />
            Shared note
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            Read-only
          </span>
        </div>

        <h1 className="mt-4 text-balance text-3xl sm:text-4xl">
          {note.title || "Untitled note"}
        </h1>

        <p
          className="mt-3 text-sm text-muted-foreground"
          data-ocid="shared_note.updated_at"
        >
          Last updated {updatedAt}
        </p>

        <div className="mt-10 border-t border-border pt-8">
          <NoteRenderer document={note.documentJson} />
        </div>

        <p className="mt-12 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          This is a read-only view. Only the note's owner can edit it.
        </p>
      </article>
    </PublicLayout>
  );
}
