import type { Id } from "@/types";

/**
 * Central query-key factory. Every hook imports from here so invalidation
 * stays consistent across pages.
 */
export const queryKeys = {
  dashboard: {
    stats: ["dashboard", "stats"] as const,
    activity: (limit: number) => ["dashboard", "activity", limit] as const,
  },
  classes: {
    all: ["classes"] as const,
    detail: (classId: Id) => ["classes", classId.toString()] as const,
  },
  subjects: {
    list: (classId: Id) => ["subjects", classId.toString()] as const,
    detail: (subjectId: Id) =>
      ["subjects", "detail", subjectId.toString()] as const,
  },
  chapters: {
    list: (subjectId: Id) => ["chapters", subjectId.toString()] as const,
    detail: (chapterId: Id) =>
      ["chapters", "detail", chapterId.toString()] as const,
  },
  topics: {
    list: (chapterId: Id) => ["topics", chapterId.toString()] as const,
    detail: (topicId: Id) => ["topics", "detail", topicId.toString()] as const,
    path: (topicId: Id) => ["topics", "path", topicId.toString()] as const,
  },
  questions: {
    list: (topicId: Id) => ["questions", topicId.toString()] as const,
  },
  sessions: {
    detail: (sessionId: Id) => ["sessions", sessionId.toString()] as const,
    result: (sessionId: Id) =>
      ["sessions", "result", sessionId.toString()] as const,
    history: ["sessions", "history"] as const,
  },
  analytics: {
    breakdown: ["analytics", "breakdown"] as const,
  },
  shares: {
    all: ["shares"] as const,
    public: (token: string) => ["shares", "public", token] as const,
  },
  ai: {
    config: ["ai", "config"] as const,
  },

  /* --- Dynamic QR links ------------------------------------------------ */

  links: {
    /** A resolved short code, keyed by code + the scan context. */
    resolve: (code: string, device: string, country: string | null) =>
      ["links", "resolve", code, device, country] as const,
    /** Link detail fetched with the secret edit token. */
    detail: (editToken: string) => ["links", "detail", editToken] as const,
    /** Scan statistics for one link, keyed by edit token. */
    stats: (editToken: string) => ["links", "stats", editToken] as const,
  },

  /* --- Notes workspace -------------------------------------------------- */

  notes: {
    /** The caller's live notes, optionally narrowed by a search query. */
    list: (searchQuery: string) => ["notes", "list", searchQuery] as const,
    /** The caller's soft-deleted notes. */
    trashed: ["notes", "trashed"] as const,
    /** One note by id. */
    detail: (noteId: Id) => ["notes", "detail", noteId.toString()] as const,
    /** The caller's note share tokens. */
    shares: ["notes", "shares"] as const,
    /** A public read-only note resolved from its share token. */
    shared: (token: string) => ["notes", "shared", token] as const,
  },

  /* --- Settings --------------------------------------------------------- */

  settings: {
    mine: ["settings", "mine"] as const,
  },
} as const;
