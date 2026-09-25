import type { Id } from "@/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ExtractionItem {
  id: string;
  type: "mcq" | "short_qa";
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation?: string;
  inferred: boolean;
  status: "pending" | "approved" | "rejected" | "imported";
  sourcePage?: number;
  targetClassId?: string | null;
  targetSubjectId?: string | null;
  targetChapterId?: string | null;
  targetTopicId?: string | null;
  isEditing?: boolean;
  savedQuestionId?: string | null;
}

export type ExtractionStatus =
  | "idle"
  | "reading"
  | "extracting"
  | "ready"
  | "error";

interface AiExtractionState {
  fileName: string | null;
  fileSize: number | null;
  fileType: string | null;
  rawText: string;
  imageDataUrl?: string;
  imageMimeType?: string;
  status: ExtractionStatus;
  errorMessage: string | null;
  items: ExtractionItem[];

  // Global default hierarchy assignment
  defaultClassId: string | null;
  defaultSubjectId: string | null;
  defaultChapterId: string | null;
  defaultTopicId: string | null;

  // Filter state
  searchQuery: string;
  statusFilter: "all" | "pending" | "approved" | "rejected" | "imported";
  typeFilter: "all" | "mcq" | "short_qa";

  // Actions
  setFileDetails: (
    file: { name: string; size: number; type: string } | null,
  ) => void;
  setRawText: (text: string) => void;
  setImageData: (dataUrl?: string, mimeType?: string) => void;
  setStatus: (status: ExtractionStatus, error?: string | null) => void;
  setItems: (items: ExtractionItem[]) => void;
  updateItem: (id: string, updates: Partial<ExtractionItem>) => void;
  approveItem: (id: string) => void;
  rejectItem: (id: string) => void;
  restoreItem: (id: string) => void;
  toggleEditItem: (id: string) => void;
  deleteItem: (id: string) => void;
  bulkApprove: () => void;
  bulkReject: () => void;
  bulkAssign: (hierarchy: {
    classId?: string | null;
    subjectId?: string | null;
    chapterId?: string | null;
    topicId?: string | null;
  }) => void;
  markImported: (id: string, questionId: string) => void;
  setDefaultHierarchy: (hierarchy: {
    classId?: string | null;
    subjectId?: string | null;
    chapterId?: string | null;
    topicId?: string | null;
  }) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (
    status: "all" | "pending" | "approved" | "rejected" | "imported",
  ) => void;
  setTypeFilter: (type: "all" | "mcq" | "short_qa") => void;
  clearQueue: () => void;
}

export const useAiExtractionStore = create<AiExtractionState>()(
  persist(
    (set) => ({
      fileName: null,
      fileSize: null,
      fileType: null,
      rawText: "",
      imageDataUrl: undefined,
      imageMimeType: undefined,
      status: "idle",
      errorMessage: null,
      items: [],

      defaultClassId: null,
      defaultSubjectId: null,
      defaultChapterId: null,
      defaultTopicId: null,

      searchQuery: "",
      statusFilter: "all",
      typeFilter: "all",

      setFileDetails: (file) =>
        set({
          fileName: file?.name ?? null,
          fileSize: file?.size ?? null,
          fileType: file?.type ?? null,
        }),

      setRawText: (rawText) => set({ rawText }),

      setImageData: (imageDataUrl, imageMimeType) =>
        set({ imageDataUrl, imageMimeType }),

      setStatus: (status, errorMessage = null) => set({ status, errorMessage }),

      setItems: (items) => set({ items }),

      updateItem: (id, updates) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...updates } : item,
          ),
        })),

      approveItem: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, status: "approved" } : item,
          ),
        })),

      rejectItem: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, status: "rejected" } : item,
          ),
        })),

      restoreItem: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, status: "pending" } : item,
          ),
        })),

      toggleEditItem: (id) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, isEditing: !item.isEditing } : item,
          ),
        })),

      deleteItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
        })),

      bulkApprove: () =>
        set((state) => ({
          items: state.items.map((item) =>
            item.status === "pending" ? { ...item, status: "approved" } : item,
          ),
        })),

      bulkReject: () =>
        set((state) => ({
          items: state.items.map((item) =>
            item.status === "pending" ? { ...item, status: "rejected" } : item,
          ),
        })),

      bulkAssign: ({ classId, subjectId, chapterId, topicId }) =>
        set((state) => ({
          items: state.items.map((item) => ({
            ...item,
            ...(classId !== undefined ? { targetClassId: classId } : {}),
            ...(subjectId !== undefined ? { targetSubjectId: subjectId } : {}),
            ...(chapterId !== undefined ? { targetChapterId: chapterId } : {}),
            ...(topicId !== undefined ? { targetTopicId: topicId } : {}),
          })),
        })),

      markImported: (id, questionId) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "imported",
                  savedQuestionId: questionId,
                  isEditing: false,
                }
              : item,
          ),
        })),

      setDefaultHierarchy: (hierarchy) =>
        set((state) => ({
          defaultClassId:
            hierarchy.classId !== undefined
              ? hierarchy.classId
              : state.defaultClassId,
          defaultSubjectId:
            hierarchy.subjectId !== undefined
              ? hierarchy.subjectId
              : state.defaultSubjectId,
          defaultChapterId:
            hierarchy.chapterId !== undefined
              ? hierarchy.chapterId
              : state.defaultChapterId,
          defaultTopicId:
            hierarchy.topicId !== undefined
              ? hierarchy.topicId
              : state.defaultTopicId,
        })),

      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setStatusFilter: (statusFilter) => set({ statusFilter }),
      setTypeFilter: (typeFilter) => set({ typeFilter }),

      clearQueue: () =>
        set({
          items: [],
          rawText: "",
          fileName: null,
          fileSize: null,
          fileType: null,
          imageDataUrl: undefined,
          imageMimeType: undefined,
          status: "idle",
          errorMessage: null,
        }),
    }),
    {
      name: "studyforge.ai.extraction_queue.v1",
      partialize: (state) => ({
        items: state.items,
        defaultClassId: state.defaultClassId,
        defaultSubjectId: state.defaultSubjectId,
        defaultChapterId: state.defaultChapterId,
        defaultTopicId: state.defaultTopicId,
      }),
    },
  ),
);
