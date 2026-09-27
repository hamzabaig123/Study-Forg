/**
 * The review queue: drafts extracted from a document, each waiting to be
 * approved and saved into a topic.
 *
 * Drafts and the chosen target survive a reload because losing a reviewed
 * queue on a refresh is the fastest way to make this page unusable. The upload
 * itself is not kept — a document has to be read again, and storing its text
 * next to its questions would only bloat local storage.
 *
 * The queue is stored per account (`lib/deviceScope`): a draft is someone's
 * exam paper, and on a shared browser the next sign-in must not be handed it.
 */

import {
  type QuestionDraft,
  type QuestionKind,
  draftKey,
} from "@/lib/ai/questions";
import { adoptUnscoped, scopedKey, watchDeviceScope } from "@/lib/deviceScope";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

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
  /** Pages the last run could not read, so a partial queue can say so. */
  missing: number[];
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

/** The queue's storage name, before the account bucket is appended to it. */
const QUEUE_KEY = "studyforge.ai-studio.v2";

/**
 * The persist backend that keeps one queue per account.
 *
 * A read claims the unscoped key the first time an account signs in, so a queue
 * built before the queue was scoped is not orphaned in the browser; a write
 * always lands in the bucket the queue belongs to.
 */
const accountQueueStorage = {
  getItem: (name: string) => adoptUnscoped(name),
  setItem: (name: string, value: string) => {
    try {
      window.localStorage.setItem(scopedKey(name), value);
    } catch {
      // A store that refuses the write loses persistence, not the review: the
      // drafts stay on screen until this tab closes.
    }
  },
  removeItem: (name: string) => {
    try {
      window.localStorage.removeItem(scopedKey(name));
    } catch {
      // Nothing to do: the queue is on its way out either way.
    }
  },
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
      missing: number[];
    },
  ) => void;
  /**
   * Add what a retry found to the queue that is already there. A run that lost
   * sections is followed by "extract again", and replacing the queue then would
   * throw away the pages the first run did read.
   */
  mergeDrafts: (
    drafts: QuestionDraft[],
    source: {
      fileName: string;
      engine: "model" | "offline";
      providerName: string | null;
      missing: number[];
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

      mergeDrafts: (drafts, source) =>
        set((state) => {
          const seen = new Set(state.drafts.map((draft) => draftKey(draft)));
          const added = drafts
            .filter((draft) => {
              if (seen.has(draftKey(draft))) return false;
              seen.add(draftKey(draft));
              return true;
            })
            .map((draft) => ({
              ...draft,
              status: "pending" as const,
              savedQuestionId: null,
            }));
          // Page order survives the merge, so a retried page lands where the
          // reviewer expects rather than at the bottom of the queue.
          const merged = [...state.drafts, ...added].sort(
            (a, b) => (a.page ?? 0) - (b.page ?? 0),
          );
          return {
            drafts: merged,
            // Back to the unfiltered view: a queue left inside a "rejected" or
            // search filter would show the retried pages as if they were lost.
            filters: EMPTY_FILTERS,
            source: state.source
              ? { ...state.source, ...source, extractedAt: Date.now() }
              : { ...source, extractedAt: Date.now() },
            target: state.target,
          };
        }),

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
      name: QUEUE_KEY,
      storage: createJSONStorage(() => accountQueueStorage),
      partialize: (state) => ({
        drafts: state.drafts,
        source: state.source,
        target: state.target,
      }),
    },
  ),
);

/** The bucket the queue was last read from; `device` while nobody is signed in. */
let queueHydratedFor = scopedKey(QUEUE_KEY);

/**
 * Re-read the queue for the account that is signed in now.
 *
 * Called when the sign-in changes rather than on every mount: a queue the
 * reviewer is working through has to survive an unrelated re-render, and a
 * rehydrate that runs anyway would replace in-memory edits with whatever was
 * last written. Answers whether it did anything.
 */
export function retargetStudioQueue(): boolean {
  const next = scopedKey(QUEUE_KEY);
  if (next === queueHydratedFor) return false;
  queueHydratedFor = next;
  if (adoptUnscoped(QUEUE_KEY) === null) {
    // Nothing stored for this account. `rehydrate()` would be a no-op and leave
    // the previous account's drafts on screen, so the queue is emptied here.
    useStudioStore.setState({
      drafts: [],
      source: null,
      target: EMPTY_TARGET,
      filters: EMPTY_FILTERS,
    });
  } else {
    void useStudioStore.persist?.rehydrate();
  }
  return true;
}

// Registering here rather than in the page: whichever route reaches the queue
// gets the signed-in account's copy, and a sign-in that happens while the
// studio is on screen re-reads it instead of leaving the reviewer editing
// somebody else's drafts.
watchDeviceScope(() => retargetStudioQueue());

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
