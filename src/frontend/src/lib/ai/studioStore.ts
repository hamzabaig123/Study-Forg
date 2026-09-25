/**
 * The review queue: drafts extracted from a document, each waiting to be
 * approved and saved into a topic.
 *
 * Drafts and the chosen target survive a reload because losing a reviewed
 * queue on a refresh is the fastest way to make this page unusable. The upload
 * itself is not kept — a document has to be read again, and storing its text
 * next to its questions would only bloat local storage.
 */

import type { QuestionDraft, QuestionKind } from "@/lib/ai/questions";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DraftStatus = "pending" | "approved" | "imported" | "rejected";

export interface StudioDraft extends QuestionDraft {
  status: DraftStatus;
  /** Set once the draft has been written into the question bank. */
  savedQuestionId: string | null;
}

export interface QueueFilters {
  status: "all" | DraftStatus;
  kind: "all" | QuestionKind;
  query: string;
}

/** Where drafts get saved: the four levels that lead to a topic. */
export interface TargetPath {
  classId: string | null;
  subjectId: string | null;
  chapterId: string | null;
  topicId: string | null;
}

export interface QueueSource {
  fileName: string;
  engine: "model" | "offline";
  providerName: string | null;
  extractedAt: number;
}

const EMPTY_TARGET: TargetPath = {
  classId: null,
  subjectId: null,
  chapterId: null,
  topicId: null,
};

const EMPTY_FILTERS: QueueFilters = {
  status: "all",
  kind: "all",
  query: "",
};

interface StudioState {
  drafts: StudioDraft[];
  source: QueueSource | null;
  target: TargetPath;
  filters: QueueFilters;

  replaceQueue: (
    drafts: QuestionDraft[],
    source: {
      fileName: string;
      engine: "model" | "offline";
      providerName: string | null;
    },
  ) => void;
  addDraft: (draft: QuestionDraft) => void;
  patchDraft: (id: string, updates: Partial<QuestionDraft>) => void;
  setDraftStatus: (id: string, status: DraftStatus) => void;
  removeDraft: (id: string) => void;
  markSaved: (id: string, questionId: string) => void;
  approveAllPending: () => void;
  clearQueue: () => void;
  setTarget: (target: Partial<TargetPath>) => void;
  setFilters: (filters: Partial<QueueFilters>) => void;
}

export const useStudioStore = create<StudioState>()(
  persist(
    (set) => ({
      drafts: [],
      source: null,
      target: EMPTY_TARGET,
      filters: EMPTY_FILTERS,

      replaceQueue: (drafts, source) =>
        set((state) => ({
          drafts: drafts.map((draft) => ({
            ...draft,
            status: "pending" as const,
            savedQuestionId: null,
          })),
          source: { ...source, extractedAt: Date.now() },
          filters: EMPTY_FILTERS,
          // Keep the target the reviewer already chose; asking again after every
          // upload is the friction that makes a queue annoying to work through.
          target: state.target,
        })),

      addDraft: (draft) =>
        set((state) => ({
          drafts: [
            ...state.drafts,
            { ...draft, status: "pending", savedQuestionId: null },
          ],
        })),

      patchDraft: (id, updates) =>
        set((state) => ({
          drafts: state.drafts.map((draft) =>
            draft.id === id ? { ...draft, ...updates } : draft,
          ),
        })),

      setDraftStatus: (id, status) =>
        set((state) => ({
          drafts: state.drafts.map((draft) =>
            draft.id === id ? { ...draft, status } : draft,
          ),
        })),

      removeDraft: (id) =>
        set((state) => ({
          drafts: state.drafts.filter((draft) => draft.id !== id),
        })),

      markSaved: (id, questionId) =>
        set((state) => ({
          drafts: state.drafts.map((draft) =>
            draft.id === id
              ? { ...draft, status: "imported", savedQuestionId: questionId }
              : draft,
          ),
        })),

      approveAllPending: () =>
        set((state) => ({
          drafts: state.drafts.map((draft) =>
            draft.status === "pending"
              ? { ...draft, status: "approved" }
              : draft,
          ),
        })),

      clearQueue: () =>
        set({ drafts: [], source: null, filters: EMPTY_FILTERS }),

      setTarget: (target) =>
        set((state) => ({ target: { ...state.target, ...target } })),

      setFilters: (filters) =>
        set((state) => ({ filters: { ...state.filters, ...filters } })),
    }),
    {
      name: "studyforge.ai-studio.v2",
      partialize: (state) => ({
        drafts: state.drafts,
        source: state.source,
        target: state.target,
      }),
    },
  ),
);

export function filterDrafts(
  drafts: StudioDraft[],
  filters: QueueFilters,
): StudioDraft[] {
  const query = filters.query.trim().toLowerCase();
  return drafts.filter((draft) => {
    if (filters.status !== "all" && draft.status !== filters.status) {
      return false;
    }
    if (filters.kind !== "all" && draft.kind !== filters.kind) return false;
    if (!query) return true;
    const haystack = [
      draft.question,
      draft.answer,
      draft.explanation,
      ...draft.options,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function countByStatus(
  drafts: StudioDraft[],
): Record<DraftStatus, number> {
  const counts: Record<DraftStatus, number> = {
    pending: 0,
    approved: 0,
    imported: 0,
    rejected: 0,
  };
  for (const draft of drafts) counts[draft.status] += 1;
  return counts;
}
