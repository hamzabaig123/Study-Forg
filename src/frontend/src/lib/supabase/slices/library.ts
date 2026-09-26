/**
 * Adapter slice: notes.
 *
 * The note editor is the one place the app writes in a burst — autosave fires
 * while the user is still typing — so it is also the one place where the mock's
 * last-write-wins archive loses work. `updateNote` carries an `expectedRevision`
 * and the database refuses a stale one, which is the whole reason it is an RPC
 * and not an update.
 *
 * `renameNote`, `softDeleteNote` and `restoreNote` are functions too for a duller
 * reason: each advances the revision, and `revision = revision + 1` needs the
 * row's current value, which PostgREST cannot read.
 */
import type { Id, NoteView, backendInterface } from "@/backend";
import {
  idArg,
  logActivity,
  nullableLabel,
  requireUserId,
  rpcEnvelope,
} from "../common";
import { noteError, noteOf, rpcOk } from "../mapping";
import type { Row, SupabaseTransport } from "../transport";

export function createLibrarySlice(
  transport: SupabaseTransport,
): Pick<
  backendInterface,
  | "createNote"
  | "listNotes"
  | "listTrashedNotes"
  | "getNote"
  | "updateNote"
  | "renameNote"
  | "softDeleteNote"
  | "restoreNote"
  | "permanentlyDeleteNote"
> {
  /** Run a note RPC that answers `{ok: row}` or `{err: …}`. */
  const noteRpc = async (
    name: string,
    args: Row,
  ): Promise<Awaited<ReturnType<backendInterface["updateNote"]>>> => {
    const payload = await rpcEnvelope(transport, name, args);
    if ("err" in payload && payload.err !== undefined) {
      return { __kind__: "err", err: noteError(payload.err) };
    }
    return { __kind__: "ok", ok: noteOf(rpcOk<Row>(payload)) };
  };

  return {
    async createNote(
      title: string,
      subjectLabel: string | null,
      chapterLabel: string | null,
      topicLabel: string | null,
      documentJson: string,
      searchText: string,
    ): Promise<NoteView> {
      await requireUserId(transport);
      const [row] = await transport.write("note", {
        insert: {
          title,
          subject_label: nullableLabel(subjectLabel),
          chapter_label: nullableLabel(chapterLabel),
          topic_label: nullableLabel(topicLabel),
          document_json: documentJson,
          search_text: searchText,
        },
      });
      await logActivity(transport, "note", `Created the note "${title}"`);
      return noteOf(row);
    },

    async listNotes(searchQuery: string | null): Promise<NoteView[]> {
      await requireUserId(transport);
      const needle = (searchQuery ?? "").trim();
      const rows = await transport.read("note", {
        eq: { status: "active" },
        ...(needle.length > 0
          ? { contains: { columns: ["title", "search_text"], term: needle } }
          : {}),
        order: { column: "updated_at", ascending: false },
      });
      return rows.map(noteOf);
    },

    async listTrashedNotes(): Promise<NoteView[]> {
      await requireUserId(transport);
      const rows = await transport.read("note", {
        eq: { status: "trashed" },
        order: { column: "deleted_at", ascending: false },
      });
      return rows.map(noteOf);
    },

    async getNote(noteId: Id): Promise<NoteView | null> {
      await requireUserId(transport);
      const [row] = await transport.read("note", { eq: { id: idArg(noteId) } });
      return row ? noteOf(row) : null;
    },

    async updateNote(
      noteId: Id,
      title: string,
      subjectLabel: string | null,
      chapterLabel: string | null,
      topicLabel: string | null,
      documentJson: string,
      searchText: string,
      expectedRevision: Id,
    ): Promise<Awaited<ReturnType<backendInterface["updateNote"]>>> {
      await requireUserId(transport);
      return noteRpc("update_note", {
        p_id: idArg(noteId),
        p_title: title,
        p_subject_label: nullableLabel(subjectLabel),
        p_chapter_label: nullableLabel(chapterLabel),
        p_topic_label: nullableLabel(topicLabel),
        p_document_json: documentJson,
        p_search_text: searchText,
        p_expected_revision: idArg(expectedRevision),
      });
    },

    async renameNote(
      noteId: Id,
      title: string,
    ): Promise<Awaited<ReturnType<backendInterface["renameNote"]>>> {
      await requireUserId(transport);
      return noteRpc("rename_note", { p_id: idArg(noteId), p_title: title });
    },

    async softDeleteNote(
      noteId: Id,
    ): Promise<Awaited<ReturnType<backendInterface["softDeleteNote"]>>> {
      await requireUserId(transport);
      return noteRpc("set_note_status", {
        p_id: idArg(noteId),
        p_status: "trashed",
      });
    },

    async restoreNote(
      noteId: Id,
    ): Promise<Awaited<ReturnType<backendInterface["restoreNote"]>>> {
      await requireUserId(transport);
      return noteRpc("set_note_status", {
        p_id: idArg(noteId),
        p_status: "active",
      });
    },

    async permanentlyDeleteNote(
      noteId: Id,
    ): Promise<Awaited<ReturnType<backendInterface["permanentlyDeleteNote"]>>> {
      await requireUserId(transport);
      const written = await transport.write("note", {
        eq: { id: idArg(noteId) },
        remove: true,
      });
      if (written.length === 0) {
        return {
          __kind__: "err",
          err: { __kind__: "notFound", notFound: null },
        };
      }
      return { __kind__: "ok", ok: null };
    },
  };
}
