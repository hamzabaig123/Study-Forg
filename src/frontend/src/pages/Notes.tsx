import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useCreateNote,
  useNotes,
  usePermanentlyDeleteNote,
  useRenameNote,
  useRestoreNote,
  useSoftDeleteNote,
  useTrashedNotes,
} from "@/hooks/useNotes";
import { formatRelativeTime, truncate } from "@/lib/format";
import {
  createEmptyDocument,
  extractPlainText,
  parseNoteDocument,
} from "@/lib/noteDocument";
import { cn } from "@/lib/utils";
import type { NoteView } from "@/types";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type ViewMode = "active" | "trash";

/** A short, readable excerpt of a note's body for the list row. */
function noteExcerpt(note: NoteView): string {
  const text = extractPlainText(parseNoteDocument(note.documentJson));
  if (!text) return "Empty note";
  return truncate(text.replace(/\s+/g, " "), 140);
}

/** Subject / chapter / topic chips, shown only when a label is present. */
function NoteLabels({ note }: { note: NoteView }) {
  const labels = [note.subjectLabel, note.chapterLabel, note.topicLabel].filter(
    (label): label is string => Boolean(label?.trim()),
  );
  if (labels.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {labels.map((label) => (
        <Badge
          key={label}
          variant="secondary"
          className="max-w-[12rem] truncate rounded-full font-normal"
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}

interface NoteRowProps {
  note: NoteView;
  index: number;
  mode: ViewMode;
  onRename: (note: NoteView) => void;
  onSoftDelete: (note: NoteView) => void;
  onRestore: (note: NoteView) => void;
  onPermanentDelete: (note: NoteView) => void;
  busy: boolean;
}

function NoteRow({
  note,
  index,
  mode,
  onRename,
  onSoftDelete,
  onRestore,
  onPermanentDelete,
  busy,
}: NoteRowProps) {
  const position = index + 1;
  const title = note.title.trim() || "Untitled note";

  return (
    <li
      data-ocid={`notes.item.${position}`}
      className="group relative flex items-start gap-4 rounded-lg border border-border bg-card p-4 transition-smooth hover:border-primary/40 hover:shadow-sm"
    >
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <FileText className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        {mode === "active" ? (
          <Link
            to="/notes/$noteId"
            params={{ noteId: note.id.toString() }}
            data-ocid={`notes.open_link.${position}`}
            className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h3 className="truncate font-display text-base font-semibold text-foreground group-hover:text-primary">
              {title}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {noteExcerpt(note)}
            </p>
          </Link>
        ) : (
          <div>
            <h3 className="truncate font-display text-base font-semibold text-foreground">
              {title}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {noteExcerpt(note)}
            </p>
          </div>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <NoteLabels note={note} />
          <span className="text-xs text-muted-foreground">
            {mode === "active"
              ? `Updated ${formatRelativeTime(note.updatedAt)}`
              : `Deleted ${formatRelativeTime(note.deletedAt ?? note.updatedAt)}`}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {mode === "active" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full"
              aria-label={`Rename ${title}`}
              data-ocid={`notes.rename_button.${position}`}
              onClick={() => onRename(note)}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground hover:text-destructive"
              aria-label={`Move ${title} to trash`}
              data-ocid={`notes.delete_button.${position}`}
              onClick={() => onSoftDelete(note)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-full"
              disabled={busy}
              data-ocid={`notes.restore_button.${position}`}
              onClick={() => onRestore(note)}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Restore
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full text-muted-foreground hover:text-destructive"
              aria-label={`Permanently delete ${title}`}
              data-ocid={`notes.permanent_delete_button.${position}`}
              onClick={() => onPermanentDelete(note)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export default function Notes() {
  const navigate = useNavigate();

  const [view, setView] = useState<ViewMode>("active");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [renaming, setRenaming] = useState<NoteView | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [pendingSoftDelete, setPendingSoftDelete] = useState<NoteView | null>(
    null,
  );
  const [pendingPermanentDelete, setPendingPermanentDelete] =
    useState<NoteView | null>(null);

  // Debounce the search box so the backend is queried after typing settles.
  useEffect(() => {
    const handle = window.setTimeout(() => setSearchQuery(searchInput), 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  const notesQuery = useNotes(searchQuery);
  const trashedQuery = useTrashedNotes();

  const createNote = useCreateNote();
  const renameNote = useRenameNote();
  const softDeleteNote = useSoftDeleteNote();
  const restoreNote = useRestoreNote();
  const permanentlyDeleteNote = usePermanentlyDeleteNote();

  const notes = notesQuery.data ?? [];
  const trashed = trashedQuery.data ?? [];
  const isSearching = searchQuery.trim().length > 0;

  function handleCreate() {
    const document = createEmptyDocument();
    createNote.mutate(
      {
        title: "Untitled note",
        subjectLabel: null,
        chapterLabel: null,
        topicLabel: null,
        documentJson: JSON.stringify(document),
        searchText: extractPlainText(document),
      },
      {
        onSuccess: (note) => {
          void navigate({
            to: "/notes/$noteId",
            params: { noteId: note.id.toString() },
          });
        },
        onError: () => toast.error("Couldn't create the note."),
      },
    );
  }

  function openRename(note: NoteView) {
    setRenaming(note);
    setRenameDraft(note.title);
  }

  function submitRename() {
    if (!renaming) return;
    const title = renameDraft.trim();
    if (!title) {
      toast.error("Give the note a title first.");
      return;
    }
    renameNote.mutate(
      { noteId: renaming.id, title },
      {
        onSuccess: () => {
          setRenaming(null);
          toast.success("Note renamed.");
        },
        onError: () => toast.error("Couldn't rename the note."),
      },
    );
  }

  function confirmSoftDelete() {
    if (!pendingSoftDelete) return;
    softDeleteNote.mutate(pendingSoftDelete.id, {
      onSuccess: () => {
        setPendingSoftDelete(null);
        toast.success("Note moved to trash.");
      },
      onError: () => toast.error("Couldn't move the note to trash."),
    });
  }

  function handleRestore(note: NoteView) {
    restoreNote.mutate(note.id, {
      onSuccess: () => toast.success("Note restored."),
      onError: () => toast.error("Couldn't restore the note."),
    });
  }

  function confirmPermanentDelete() {
    if (!pendingPermanentDelete) return;
    permanentlyDeleteNote.mutate(pendingPermanentDelete.id, {
      onSuccess: () => {
        setPendingPermanentDelete(null);
        toast.success("Note permanently deleted.");
      },
      onError: () => toast.error("Couldn't delete the note."),
    });
  }

  const activeQuery = view === "active" ? notesQuery : trashedQuery;
  const rows = view === "active" ? notes : trashed;

  return (
    <div data-ocid="notes.page" className="mx-auto w-full max-w-4xl">
      <PageHeader
        eyebrow="Workspace"
        title="Notes"
        description="Your private study notes. Search across titles and note text, and recover anything you delete from the trash."
        actions={
          <Button
            type="button"
            className="rounded-full"
            data-ocid="notes.create_button"
            disabled={createNote.isPending}
            onClick={handleCreate}
          >
            {createNote.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            New note
          </Button>
        }
      />

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Note views"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "active"}
            data-ocid="notes.active.tab"
            onClick={() => setView("active")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === "active"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Notes
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "trash"}
            data-ocid="notes.trash.tab"
            onClick={() => setView("trash")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              view === "trash"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Trash
          </button>
        </div>

        {view === "active" ? (
          <div className="relative sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
              data-ocid="notes.search_input"
              className="rounded-full pl-9 pr-9"
            />
            {searchInput ? (
              <button
                type="button"
                aria-label="Clear search"
                data-ocid="notes.clear_search_button"
                onClick={() => setSearchInput("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground transition-smooth hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        {activeQuery.isLoading ? (
          <LoadingState
            label={view === "active" ? "Loading your notes…" : "Loading trash…"}
            variant="list"
          />
        ) : activeQuery.isError ? (
          <ErrorState
            title={
              view === "active" ? "Couldn't load notes" : "Couldn't load trash"
            }
            description="Something went wrong while fetching your notes."
            onRetry={() => void activeQuery.refetch()}
          />
        ) : rows.length === 0 ? (
          view === "active" ? (
            isSearching ? (
              <EmptyState
                icon={Search}
                title="No notes match your search"
                description={`Nothing matched “${searchQuery.trim()}”. Try a different word or clear the search.`}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    data-ocid="notes.no_results.clear_button"
                    onClick={() => setSearchInput("")}
                  >
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={FileText}
                title="No notes yet"
                description="Start your first note and it will appear here, private to your account."
                action={
                  <Button
                    type="button"
                    className="rounded-full"
                    data-ocid="notes.empty_state.create_button"
                    disabled={createNote.isPending}
                    onClick={handleCreate}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New note
                  </Button>
                }
              />
            )
          ) : (
            <EmptyState
              icon={Trash2}
              title="Trash is empty"
              description="Notes you delete land here, and you can restore them any time."
            />
          )
        ) : (
          <ul data-ocid="notes.list" className="space-y-3">
            {rows.map((note, index) => (
              <NoteRow
                key={note.id.toString()}
                note={note}
                index={index}
                mode={view}
                onRename={openRename}
                onSoftDelete={setPendingSoftDelete}
                onRestore={handleRestore}
                onPermanentDelete={setPendingPermanentDelete}
                busy={restoreNote.isPending}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
      >
        <DialogContent className="sm:max-w-md" data-ocid="notes.rename.dialog">
          <DialogHeader>
            <DialogTitle className="font-display">Rename note</DialogTitle>
            <DialogDescription>
              Give this note a clear title so it's easy to find later.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitRename();
            }}
            aria-label="Note title"
            data-ocid="notes.rename_input"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              data-ocid="notes.rename.cancel_button"
              onClick={() => setRenaming(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="rounded-full"
              data-ocid="notes.rename.save_button"
              disabled={renameNote.isPending}
              onClick={submitRename}
            >
              {renameNote.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save title
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingSoftDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSoftDelete(null);
        }}
        title={`Move “${pendingSoftDelete?.title.trim() || "Untitled note"}” to trash?`}
        description="The note is removed from your list but stays recoverable from the trash view."
        confirmLabel="Move to trash"
        destructive
        onConfirm={confirmSoftDelete}
      />

      <ConfirmDialog
        open={pendingPermanentDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPermanentDelete(null);
        }}
        title={`Permanently delete “${pendingPermanentDelete?.title.trim() || "Untitled note"}”?`}
        description="This erases the note and its content for good. This cannot be undone."
        confirmLabel="Delete forever"
        destructive
        onConfirm={confirmPermanentDelete}
      />
    </div>
  );
}
