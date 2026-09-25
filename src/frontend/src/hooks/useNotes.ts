import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type { Id, NoteView } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/** The caller's live notes, optionally narrowed by a search query. */
export function useNotes(searchQuery = "") {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.notes.list(searchQuery),
    queryFn: async (): Promise<NoteView[]> => {
      if (!actor) return [];
      return actor.listNotes(searchQuery.trim() ? searchQuery.trim() : null);
    },
    enabled: !!actor && !isFetching,
  });
}

/** The caller's soft-deleted notes, recoverable from the trash view. */
export function useTrashedNotes() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.notes.trashed,
    queryFn: async (): Promise<NoteView[]> => {
      if (!actor) return [];
      return actor.listTrashedNotes();
    },
    enabled: !!actor && !isFetching,
  });
}

/** One note by id, scoped to the signed-in owner. */
export function useNote(noteId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.notes.detail(noteId ?? 0n),
    queryFn: async (): Promise<NoteView | null> => {
      if (!actor || noteId === null) return null;
      return actor.getNote(noteId);
    },
    enabled: !!actor && !isFetching && noteId !== null,
  });
}

/** The caller's note share tokens. */
export function useNoteShares() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.notes.shares,
    queryFn: async () => {
      if (!actor) return [];
      return actor.listNoteShares();
    },
    enabled: !!actor && !isFetching,
  });
}

/**
 * A public read-only note resolved from its share token. Anonymous callers are
 * allowed, so this runs without an identity.
 */
export function useSharedNote(token: string | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.notes.shared(token ?? ""),
    queryFn: async () => {
      if (!actor || !token) return null;
      return actor.getSharedNote(token);
    },
    enabled: !!actor && !isFetching && !!token,
    retry: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

function useInvalidateNotes() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["notes"] });
  };
}

export interface CreateNoteInput {
  title: string;
  subjectLabel: string | null;
  chapterLabel: string | null;
  topicLabel: string | null;
  documentJson: string;
  searchText: string;
}

export function useCreateNote() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: CreateNoteInput): Promise<NoteView> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.createNote(
        input.title,
        input.subjectLabel,
        input.chapterLabel,
        input.topicLabel,
        input.documentJson,
        input.searchText,
      );
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export interface UpdateNoteInput {
  noteId: Id;
  title: string;
  subjectLabel: string | null;
  chapterLabel: string | null;
  topicLabel: string | null;
  documentJson: string;
  searchText: string;
  /** The revision the editor loaded; a mismatch is rejected as stale. */
  expectedRevision: bigint;
}

export function useUpdateNote() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: UpdateNoteInput) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.updateNote(
        input.noteId,
        input.title,
        input.subjectLabel,
        input.chapterLabel,
        input.topicLabel,
        input.documentJson,
        input.searchText,
        input.expectedRevision,
      );
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRenameNote() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (input: { noteId: Id; title: string }) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.renameNote(input.noteId, input.title);
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useSoftDeleteNote() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (noteId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.softDeleteNote(noteId);
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRestoreNote() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (noteId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.restoreNote(noteId);
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function usePermanentlyDeleteNote() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (noteId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.permanentlyDeleteNote(noteId);
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

/** Create a read-only public share token for one of the caller's notes. */
export function useCreateNoteShare() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (noteId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.createNoteShare(noteId);
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

/** Revoke a note share token; the public link stops resolving. */
export function useRevokeNoteShare() {
  const { actor } = useBackend();
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: async (token: string) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.revokeNoteShare(token);
    },
    onSuccess: () => {
      invalidate();
    },
  });
}
