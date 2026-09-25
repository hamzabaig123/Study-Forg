import type { backendInterface } from "@/backend";
import { vi } from "vitest";

/**
 * A typed, fully-mocked backend actor.
 *
 * Every public method of the generated `backendInterface` is present so a test
 * can override only the calls it exercises. This is a local mock: it proves
 * nothing about the real canister, and the suite would pass identically against
 * a backend whose methods all trap at runtime.
 */
export type MockActor = {
  [K in keyof backendInterface]: ReturnType<typeof vi.fn>;
};

export function createMockActor(overrides: Partial<MockActor> = {}): MockActor {
  const base: MockActor = {
    _initialize_access_control: vi.fn(),
    _internet_identity_sign_in_finish: vi.fn(),
    _internet_identity_sign_in_start: vi.fn(),
    acceptDraft: vi.fn(),
    assignCallerUserRole: vi.fn(),
    completeSession: vi.fn(),
    createChapter: vi.fn(),
    createClass: vi.fn(),
    createLink: vi.fn(),
    createNote: vi.fn(),
    createNoteShare: vi.fn(),
    createQuestion: vi.fn(),
    createShare: vi.fn(),
    createSubject: vi.fn(),
    createTopic: vi.fn(),
    deleteChapter: vi.fn(),
    deleteClass: vi.fn(),
    deleteLink: vi.fn(),
    deleteQuestion: vi.fn(),
    deleteSubject: vi.fn(),
    deleteTopic: vi.fn(),
    execute: vi.fn(),
    exportContent: vi.fn(),
    exportMyData: vi.fn(),
    generateDrafts: vi.fn(),
    getAiConfig: vi.fn(),
    getAnalyticsBreakdown: vi.fn(),
    getApiDoc: vi.fn(),
    getAttemptHistory: vi.fn(),
    getCallerUserRole: vi.fn(),
    getChapter: vi.fn(),
    getClass: vi.fn(),
    getDashboardStats: vi.fn(),
    getLinkByToken: vi.fn(),
    getMySettings: vi.fn(),
    getNote: vi.fn(),
    getRecentActivity: vi.fn(),
    getScanStats: vi.fn(),
    getSession: vi.fn(),
    getSessionResult: vi.fn(),
    getSharedContent: vi.fn(),
    getSharedNote: vi.fn(),
    getSubject: vi.fn(),
    getTopic: vi.fn(),
    getTopicPath: vi.fn(),
    isCallerAdmin: vi.fn(),
    listChapters: vi.fn(),
    listClasses: vi.fn(),
    listNoteShares: vi.fn(),
    listNotes: vi.fn(),
    listQuestions: vi.fn(),
    listShares: vi.fn(),
    listSubjects: vi.fn(),
    listTopics: vi.fn(),
    listTrashedNotes: vi.fn(),
    permanentlyDeleteNote: vi.fn(),
    removeAiKey: vi.fn(),
    renameChapter: vi.fn(),
    renameClass: vi.fn(),
    renameNote: vi.fn(),
    renameSubject: vi.fn(),
    renameTopic: vi.fn(),
    reportAbuse: vi.fn(),
    resolveCode: vi.fn(),
    restoreNote: vi.fn(),
    revokeNoteShare: vi.fn(),
    revokeShare: vi.fn(),
    saveAiKey: vi.fn(),
    saveMySettings: vi.fn(),
    schema: vi.fn(),
    setPaused: vi.fn(),
    softDeleteNote: vi.fn(),
    startSession: vi.fn(),
    submitAnswer: vi.fn(),
    updateNote: vi.fn(),
    updateQuestion: vi.fn(),
    updateTarget: vi.fn(),
  };
  return { ...base, ...overrides };
}
