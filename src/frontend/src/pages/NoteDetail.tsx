import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { NoteRenderer } from "@/components/notes/NoteRenderer";
import { QrCode } from "@/components/qr/QrCode";
import { Badge } from "@/components/ui/badge";
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
import { Separator } from "@/components/ui/separator";
import {
  useCreateNoteShare,
  useNote,
  useNoteShares,
  useRevokeNoteShare,
  useUpdateNote,
} from "@/hooks/useNotes";
import { formatRelativeTime } from "@/lib/format";
import {
  BLOCK_KIND_LABELS,
  type NoteBlock,
  type NoteBlockKind,
  type NoteDocument,
  createBlock,
  createEmptyDocument,
  extractPlainText,
  parseNoteDocument,
  serializeNoteDocument,
} from "@/lib/noteDocument";
import { cn } from "@/lib/utils";
import { Link, useBlocker, useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CloudOff,
  Eye,
  Link2,
  Loader2,
  Plus,
  RotateCw,
  Share2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

/* -------------------------------------------------------------------------- */
/* Local draft persistence                                                     */
/* -------------------------------------------------------------------------- */

interface LocalDraft {
  title: string;
  subjectLabel: string;
  chapterLabel: string;
  topicLabel: string;
  document: NoteDocument;
  /** The server revision this draft was based on. */
  baseRevision: string;
  savedAt: number;
}

function draftKey(noteId: string): string {
  return `studyforge.note-draft.${noteId}`;
}

function readDraft(noteId: string): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(noteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraft>;
    if (
      typeof parsed.title !== "string" ||
      typeof parsed.baseRevision !== "string" ||
      typeof parsed.savedAt !== "number" ||
      typeof parsed.document !== "object" ||
      parsed.document === null
    ) {
      return null;
    }
    return {
      title: parsed.title,
      subjectLabel:
        typeof parsed.subjectLabel === "string" ? parsed.subjectLabel : "",
      chapterLabel:
        typeof parsed.chapterLabel === "string" ? parsed.chapterLabel : "",
      topicLabel:
        typeof parsed.topicLabel === "string" ? parsed.topicLabel : "",
      document: parseNoteDocument(JSON.stringify(parsed.document)),
      baseRevision: parsed.baseRevision,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeDraft(noteId: string, draft: LocalDraft): void {
  try {
    window.localStorage.setItem(draftKey(noteId), JSON.stringify(draft));
  } catch {
    // Storage may be unavailable (private mode, quota). Autosave still works.
  }
}

function clearDraft(noteId: string): void {
  try {
    window.localStorage.removeItem(draftKey(noteId));
  } catch {
    // Nothing to do — the draft simply stays until the next successful save.
  }
}

/* -------------------------------------------------------------------------- */
/* Editor state                                                                */
/* -------------------------------------------------------------------------- */

interface EditorState {
  title: string;
  subjectLabel: string;
  chapterLabel: string;
  topicLabel: string;
  document: NoteDocument;
}

type SaveStatus = "idle" | "saving" | "saved" | "failed";

const AUTOSAVE_DELAY_MS = 1000;

function editorStateFromNote(note: {
  title: string;
  subjectLabel?: string;
  chapterLabel?: string;
  topicLabel?: string;
  documentJson: string;
}): EditorState {
  return {
    title: note.title,
    subjectLabel: note.subjectLabel ?? "",
    chapterLabel: note.chapterLabel ?? "",
    topicLabel: note.topicLabel ?? "",
    document: parseNoteDocument(note.documentJson),
  };
}

function editorStateFromDraft(draft: LocalDraft): EditorState {
  return {
    title: draft.title,
    subjectLabel: draft.subjectLabel,
    chapterLabel: draft.chapterLabel,
    topicLabel: draft.topicLabel,
    document: draft.document,
  };
}

function labelOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/* -------------------------------------------------------------------------- */
/* Block editor                                                                */
/* -------------------------------------------------------------------------- */

const BLOCK_KINDS: NoteBlockKind[] = [
  "heading",
  "paragraph",
  "bulletList",
  "callout",
  "formula",
  "divider",
];

interface BlockEditorProps {
  block: NoteBlock;
  index: number;
  total: number;
  disabled: boolean;
  onChange: (block: NoteBlock) => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}

function BlockEditor({
  block,
  index,
  total,
  disabled,
  onChange,
  onRemove,
  onMove,
}: BlockEditorProps) {
  const position = index + 1;

  function changeKind(kind: NoteBlockKind) {
    if (kind === block.kind) return;
    const replacement = createBlock(kind);
    onChange({ ...replacement, id: block.id });
  }

  return (
    <div
      className="group relative rounded-lg border border-border/70 bg-card/60 p-3 transition-smooth focus-within:border-primary/50 focus-within:bg-card"
      data-ocid={`note.block.${position}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select
          value={block.kind}
          onValueChange={(value) => changeKind(value as NoteBlockKind)}
          disabled={disabled}
        >
          <SelectTrigger
            size="sm"
            className="w-[9.5rem] rounded-full text-xs"
            aria-label={`Block ${position} type`}
            data-ocid={`note.block_type.${position}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLOCK_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {BLOCK_KIND_LABELS[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="numeric text-[11px] uppercase tracking-wider text-muted-foreground">
          {position} / {total}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
            aria-label={`Move block ${position} up`}
            data-ocid={`note.block_move_up.${position}`}
          >
            <ArrowUp className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
            aria-label={`Move block ${position} down`}
            data-ocid={`note.block_move_down.${position}`}
          >
            <ArrowDown className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 rounded-full text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            disabled={disabled}
            aria-label={`Remove block ${position}`}
            data-ocid={`note.block_remove.${position}`}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {block.kind === "divider" ? (
        <div className="py-2">
          <Separator />
          <p className="mt-2 text-xs text-muted-foreground">
            A divider separates sections. It has no text.
          </p>
        </div>
      ) : block.kind === "bulletList" ? (
        <div className="space-y-2">
          {block.items.map((item, itemIndex) => (
            <div
              key={`${block.id}-item-${itemIndex}`}
              className="flex items-center gap-2"
            >
              <span
                className="size-1.5 shrink-0 rounded-full bg-primary/70"
                aria-hidden="true"
              />
              <Input
                value={item}
                disabled={disabled}
                placeholder="List item"
                aria-label={`Block ${position} item ${itemIndex + 1}`}
                onChange={(event) => {
                  const items = block.items.map((current, i) =>
                    i === itemIndex ? event.target.value : current,
                  );
                  onChange({ ...block, items });
                }}
                data-ocid={`note.bullet_item.${position}.${itemIndex + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                disabled={disabled || block.items.length <= 1}
                onClick={() =>
                  onChange({
                    ...block,
                    items: block.items.filter((_, i) => i !== itemIndex),
                  })
                }
                aria-label={`Remove item ${itemIndex + 1} from block ${position}`}
                data-ocid={`note.bullet_remove.${position}.${itemIndex + 1}`}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={disabled}
            onClick={() => onChange({ ...block, items: [...block.items, ""] })}
            data-ocid={`note.bullet_add.${position}`}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add item
          </Button>
        </div>
      ) : (
        <textarea
          value={block.text}
          disabled={disabled}
          rows={block.kind === "heading" ? 1 : 3}
          placeholder={
            block.kind === "heading"
              ? "Section heading"
              : block.kind === "callout"
                ? "Something worth remembering"
                : block.kind === "formula"
                  ? "e.g. E = mc^2"
                  : "Write your notes…"
          }
          aria-label={`Block ${position} text`}
          onChange={(event) =>
            onChange({ ...block, text: event.target.value } as NoteBlock)
          }
          className={cn(
            "w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60",
            block.kind === "heading" &&
              "font-display text-lg font-semibold tracking-tight",
            block.kind === "formula" && "surface-code",
          )}
          data-ocid={`note.block_text.${position}`}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export default function NoteDetail() {
  const { noteId } = useParams({ from: "/app/notes/$noteId" });
  const id = useMemo(() => {
    try {
      return BigInt(noteId);
    } catch {
      return null;
    }
  }, [noteId]);

  const noteQuery = useNote(id);
  const updateNote = useUpdateNote();
  const sharesQuery = useNoteShares();
  const createShare = useCreateNoteShare();
  const revokeShare = useRevokeNoteShare();

  const note = noteQuery.data ?? null;

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [revision, setRevision] = useState<bigint | null>(null);
  const [stale, setStale] = useState<{
    expected: bigint;
    actual: bigint;
  } | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const initializedRef = useRef(false);
  const editorRef = useRef<EditorState | null>(null);
  const revisionRef = useRef<bigint | null>(null);
  const staleRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);

  editorRef.current = editor;
  revisionRef.current = revision;
  staleRef.current = stale !== null;

  /* --- One-time initialization from the server note + local draft -------- */

  useEffect(() => {
    if (initializedRef.current || !note) return;
    initializedRef.current = true;

    const serverState = editorStateFromNote(note);
    const draft = readDraft(noteId);
    const draftIsNewer =
      draft !== null && BigInt(draft.baseRevision) < note.revision;

    if (draftIsNewer) {
      setEditor(editorStateFromDraft(draft));
      setRecovered(true);
      setStatus("idle");
    } else {
      setEditor(serverState);
      setStatus("saved");
    }
    setRevision(note.revision);
  }, [note, noteId]);

  /* --- Autosave ---------------------------------------------------------- */

  const runSave = useCallback(async () => {
    const current = editorRef.current;
    const expected = revisionRef.current;
    if (!current || expected === null || id === null) return;
    if (staleRef.current || inFlightRef.current) return;

    inFlightRef.current = true;
    dirtyRef.current = false;
    setStatus("saving");

    try {
      const result = await updateNote.mutateAsync({
        noteId: id,
        title: current.title.trim() || "Untitled note",
        subjectLabel: labelOrNull(current.subjectLabel),
        chapterLabel: labelOrNull(current.chapterLabel),
        topicLabel: labelOrNull(current.topicLabel),
        documentJson: serializeNoteDocument(current.document),
        searchText: extractPlainText(current.document),
        expectedRevision: expected,
      });

      if (result.__kind__ === "err") {
        if (result.err.__kind__ === "staleRevision") {
          setStale({
            expected: result.err.staleRevision.expected,
            actual: result.err.staleRevision.actual,
          });
          setStatus("failed");
          return;
        }
        setStatus("failed");
        return;
      }

      setRevision(result.ok.revision);
      setStatus("saved");
      clearDraft(noteId);
    } catch {
      setStatus("failed");
    } finally {
      inFlightRef.current = false;
      if (dirtyRef.current && !staleRef.current) {
        timerRef.current = window.setTimeout(() => {
          void runSave();
        }, AUTOSAVE_DELAY_MS);
      }
    }
  }, [id, noteId, updateNote]);

  const scheduleSave = useCallback(() => {
    if (staleRef.current) return;
    dirtyRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void runSave();
    }, AUTOSAVE_DELAY_MS);
  }, [runSave]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  /* --- Draft persistence on every edit ----------------------------------- */

  useEffect(() => {
    if (!editor || revision === null || stale !== null) return;
    writeDraft(noteId, {
      title: editor.title,
      subjectLabel: editor.subjectLabel,
      chapterLabel: editor.chapterLabel,
      topicLabel: editor.topicLabel,
      document: editor.document,
      baseRevision: revision.toString(),
      savedAt: Date.now(),
    });
  }, [editor, noteId, revision, stale]);

  /* --- Leave guard while a save is pending ------------------------------- */

  const shouldBlock = useCallback(
    () => dirtyRef.current || inFlightRef.current,
    [],
  );
  useBlocker({ shouldBlockFn: shouldBlock, enableBeforeUnload: shouldBlock });

  /* --- Editor mutations -------------------------------------------------- */

  function updateEditor(patch: Partial<EditorState>) {
    setEditor((current) => (current ? { ...current, ...patch } : current));
    scheduleSave();
  }

  function updateBlock(index: number, block: NoteBlock) {
    setEditor((current) => {
      if (!current) return current;
      const blocks = current.document.blocks.map((existing, i) =>
        i === index ? block : existing,
      );
      return { ...current, document: { ...current.document, blocks } };
    });
    scheduleSave();
  }

  function addBlock(kind: NoteBlockKind) {
    setEditor((current) => {
      if (!current) return current;
      return {
        ...current,
        document: {
          ...current.document,
          blocks: [...current.document.blocks, createBlock(kind)],
        },
      };
    });
    scheduleSave();
  }

  function removeBlock(index: number) {
    setEditor((current) => {
      if (!current) return current;
      const remaining = current.document.blocks.filter((_, i) => i !== index);
      return {
        ...current,
        document: {
          ...current.document,
          blocks:
            remaining.length > 0 ? remaining : createEmptyDocument().blocks,
        },
      };
    });
    scheduleSave();
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setEditor((current) => {
      if (!current) return current;
      const target = index + direction;
      const blocks = [...current.document.blocks];
      if (target < 0 || target >= blocks.length) return current;
      const [moved] = blocks.splice(index, 1);
      blocks.splice(target, 0, moved);
      return { ...current, document: { ...current.document, blocks } };
    });
    scheduleSave();
  }

  function retrySave() {
    if (stale) return;
    void runSave();
  }

  function reloadServerVersion() {
    if (!note) return;
    setEditor(editorStateFromNote(note));
    setRevision(note.revision);
    setStale(null);
    setRecovered(false);
    setStatus("saved");
    clearDraft(noteId);
    toast.success("Loaded the latest version from the server.");
  }

  function overwriteServerVersion() {
    if (!note) return;
    setRevision(note.revision);
    setStale(null);
    setStatus("idle");
    void runSave();
  }

  /* --- Sharing ----------------------------------------------------------- */

  const shares = (sharesQuery.data ?? []).filter(
    (share) => share.noteId === id && share.status === "active",
  );

  function createShareLink() {
    if (id === null) return;
    createShare.mutate(id, {
      onSuccess: (result) => {
        if (result.__kind__ === "err") {
          toast.error("Couldn't create a share link for this note.");
          return;
        }
        toast.success("Share link created.");
      },
      onError: () => toast.error("Couldn't create a share link."),
    });
  }

  function confirmRevoke() {
    if (!pendingRevoke) return;
    revokeShare.mutate(pendingRevoke, {
      onSuccess: () => {
        setPendingRevoke(null);
        toast.success("Share link revoked.");
      },
      onError: () => toast.error("Couldn't revoke the share link."),
    });
  }

  async function copyShareUrl(url: string, token: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      window.setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      toast.error("Couldn't copy the link. Select it and copy manually.");
    }
  }

  /* --- Render ------------------------------------------------------------ */

  if (noteQuery.isLoading) {
    return <LoadingState label="Opening note…" />;
  }

  if (noteQuery.isError || !note || !editor) {
    return (
      <ErrorState
        title="Note not found"
        description="This note may have been deleted, or it belongs to another account."
        onRetry={() => void noteQuery.refetch()}
      />
    );
  }

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "failed"
          ? "Failed"
          : "All changes saved";

  return (
    <div className="space-y-6" data-ocid="note_detail.page">
      <Breadcrumbs
        items={[{ label: "Notes", to: "/notes" }, { label: editor.title }]}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" className="rounded-full">
          <Link to="/notes" data-ocid="note_detail.back_link">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All notes
          </Link>
        </Button>

        <div
          className="flex items-center gap-2 text-sm"
          aria-live="polite"
          data-ocid="note_detail.save_status"
        >
          {status === "saving" ? (
            <Loader2
              className="size-4 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : status === "saved" ? (
            <Check className="size-4 text-success" aria-hidden="true" />
          ) : status === "failed" ? (
            <CloudOff className="size-4 text-destructive" aria-hidden="true" />
          ) : (
            <Check
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
          )}
          <span
            className={cn(
              "font-medium",
              status === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {statusLabel}
          </span>
          {status === "failed" && !stale ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={retrySave}
              data-ocid="note_detail.retry_button"
            >
              <RotateCw className="size-3.5" aria-hidden="true" />
              Retry
            </Button>
          ) : null}
        </div>
      </div>

      {recovered ? (
        <div
          className="contrast-warning flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm"
          data-ocid="note_detail.recovered_banner"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            We restored unsaved changes from this device. They will be saved to
            your account automatically.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-full"
            onClick={() => {
              setEditor(editorStateFromNote(note));
              setRecovered(false);
              setStatus("saved");
              clearDraft(noteId);
            }}
            data-ocid="note_detail.discard_draft_button"
          >
            Discard draft
          </Button>
        </div>
      ) : null}

      {stale ? (
        <div
          className="danger-zone flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm"
          data-ocid="note_detail.stale_banner"
        >
          <AlertTriangle
            className="size-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1">
            A newer version of this note exists (revision{" "}
            {stale.actual.toString()}
            ). Autosave is paused so you don't overwrite it.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={reloadServerVersion}
              data-ocid="note_detail.reload_button"
            >
              Reload server version
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-full"
              onClick={overwriteServerVersion}
              data-ocid="note_detail.overwrite_button"
            >
              Overwrite with mine
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* --- Editor column ------------------------------------------------ */}
        <div className="min-w-0 space-y-6">
          <Card className="rounded-lg border-border/70 shadow-none">
            <CardContent className="space-y-4 p-5">
              <div className="space-y-2">
                <Label htmlFor="note-title">Title</Label>
                <Input
                  id="note-title"
                  value={editor.title}
                  disabled={stale !== null}
                  placeholder="Untitled note"
                  onChange={(event) =>
                    updateEditor({ title: event.target.value })
                  }
                  data-ocid="note_detail.title_input"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="note-subject">Subject</Label>
                  <Input
                    id="note-subject"
                    value={editor.subjectLabel}
                    disabled={stale !== null}
                    placeholder="e.g. Biology"
                    onChange={(event) =>
                      updateEditor({ subjectLabel: event.target.value })
                    }
                    data-ocid="note_detail.subject_input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-chapter">Chapter</Label>
                  <Input
                    id="note-chapter"
                    value={editor.chapterLabel}
                    disabled={stale !== null}
                    placeholder="e.g. Cell Division"
                    onChange={(event) =>
                      updateEditor({ chapterLabel: event.target.value })
                    }
                    data-ocid="note_detail.chapter_input"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="note-topic">Topic</Label>
                  <Input
                    id="note-topic"
                    value={editor.topicLabel}
                    disabled={stale !== null}
                    placeholder="e.g. Mitosis"
                    onChange={(event) =>
                      updateEditor({ topicLabel: event.target.value })
                    }
                    data-ocid="note_detail.topic_input"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <section className="space-y-3" data-ocid="note_detail.editor">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Blocks
              </h2>
              <p className="text-xs text-muted-foreground">
                Changes save automatically about a second after you stop typing.
              </p>
            </div>

            <div className="space-y-3">
              {editor.document.blocks.map((block, index) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  index={index}
                  total={editor.document.blocks.length}
                  disabled={stale !== null}
                  onChange={(next) => updateBlock(index, next)}
                  onRemove={() => removeBlock(index)}
                  onMove={(direction) => moveBlock(index, direction)}
                />
              ))}
            </div>

            <div
              className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3"
              data-ocid="note_detail.block_toolbar"
            >
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Add block
              </span>
              {BLOCK_KINDS.map((kind) => (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  disabled={stale !== null}
                  onClick={() => addBlock(kind)}
                  data-ocid={`note_detail.add_${kind}_button`}
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  {BLOCK_KIND_LABELS[kind]}
                </Button>
              ))}
            </div>
          </section>
        </div>

        {/* --- Preview + share column --------------------------------------- */}
        <div className="min-w-0 space-y-6">
          <Card className="rounded-lg border-border/70 shadow-none">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Eye className="size-4 text-primary" aria-hidden="true" />
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div
                className="max-h-[28rem] overflow-y-auto rounded-md border border-border/60 bg-background/60 p-4"
                data-ocid="note_detail.preview"
              >
                <h3 className="mb-3 font-display text-lg font-semibold text-foreground">
                  {editor.title.trim() || "Untitled note"}
                </h3>
                <NoteRenderer document={editor.document} />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-border/70 shadow-none">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Share2 className="size-4 text-primary" aria-hidden="true" />
                Share
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                Anyone with the link can read this note. Revoking a link or
                deleting the note stops it from resolving.
              </p>

              <Button
                type="button"
                className="w-full rounded-full bg-gradient-primary text-primary-foreground"
                onClick={createShareLink}
                disabled={createShare.isPending || stale !== null}
                data-ocid="note_detail.create_share_button"
              >
                {createShare.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="size-4" aria-hidden="true" />
                )}
                Create share link
              </Button>

              {sharesQuery.isLoading ? (
                <LoadingState label="Loading share links…" />
              ) : shares.length === 0 ? (
                <p
                  className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground"
                  data-ocid="note_detail.shares_empty_state"
                >
                  No share links yet.
                </p>
              ) : (
                <ul className="space-y-3" data-ocid="note_detail.shares_list">
                  {shares.map((share, index) => {
                    const url = `${window.location.origin}/shared/note/${share.token}`;
                    return (
                      <li
                        key={share.token}
                        className="space-y-3 rounded-lg border border-border/70 bg-card/60 p-3"
                        data-ocid={`note_detail.share.${index + 1}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary" className="rounded-full">
                            Read-only
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatRelativeTime(share.createdAt)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <Input
                            readOnly
                            value={url}
                            aria-label="Public share URL"
                            className="text-xs"
                            data-ocid={`note_detail.share_url.${index + 1}`}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 rounded-full"
                            onClick={() => void copyShareUrl(url, share.token)}
                            data-ocid={`note_detail.copy_share.${index + 1}`}
                          >
                            {copiedToken === share.token ? "Copied" : "Copy"}
                          </Button>
                        </div>

                        <div className="qr-well mx-auto w-40">
                          <QrCode
                            value={url}
                            label={`QR code for the shared note link ${index + 1}`}
                          />
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full rounded-full text-destructive hover:text-destructive"
                          onClick={() => setPendingRevoke(share.token)}
                          disabled={revokeShare.isPending}
                          data-ocid={`note_detail.revoke_share.${index + 1}`}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          Revoke link
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null);
        }}
        trigger={<span className="hidden" aria-hidden="true" />}
        title="Revoke this share link?"
        description="The public link and its QR code will stop working immediately. You can create a new link at any time."
        confirmLabel="Revoke link"
        destructive
        onConfirm={confirmRevoke}
      />
    </div>
  );
}
