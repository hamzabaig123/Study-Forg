import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export type AbuseError = {
    __kind__: "invalidInput";
    invalidInput: string;
} | {
    __kind__: "notFound";
    notFound: null;
};
export interface AccuracyBucket {
    total: bigint;
    correct: bigint;
    bucketLabel: string;
    accuracyPercent: number;
}
export interface ActivityItem {
    at: Timestamp;
    title: string;
    kind: string;
}
export interface AiConfigStatus {
    keyHint?: string;
    hasPersonalKey: boolean;
}
export type AiError = {
    __kind__: "invalidRequest";
    invalidRequest: string;
} | {
    __kind__: "notConfigured";
    notConfigured: null;
} | {
    __kind__: "generationFailed";
    generationFailed: string;
};
export interface AnalyticsBreakdown {
    byClass: Array<AccuracyBucket>;
    byQuestionType: Array<AccuracyBucket>;
    bySubject: Array<AccuracyBucket>;
}
export type AnswerData = {
    __kind__: "shortAnswer";
    shortAnswer: {
        expected: string;
    };
} | {
    __kind__: "multipleChoice";
    multipleChoice: {
        correctOptionId: Id;
        options: Array<Option>;
    };
} | {
    __kind__: "trueFalse";
    trueFalse: {
        correct: boolean;
    };
};
export interface AnswerFeedback {
    explanation?: string;
    correctAnswer: AnswerData;
    correct: boolean;
}
export interface AttemptSummary {
    id: Id;
    completedAt: Timestamp;
    total: bigint;
    mode: SessionMode;
    scopeLabel: string;
    score: bigint;
}
export interface BreadcrumbItem {
    id: Id;
    name: string;
}
export interface Cell {
    value: Value;
    name: string;
}
export interface ChapterDetail {
    topics: Array<TopicSummary>;
    chapter: ChapterSummary;
}
export interface ChapterSummary {
    id: Id;
    topicCount: bigint;
    name: string;
    createdAt: Timestamp;
    description?: string;
    updatedAt: Timestamp;
    subjectId: Id;
}
export interface ClassDetail {
    subjects: Array<SubjectSummary>;
    class: ClassSummary;
}
export interface ClassSummary {
    id: Id;
    subjectCount: bigint;
    name: string;
    createdAt: Timestamp;
    description?: string;
    updatedAt: Timestamp;
}
export type CreateLinkError = {
    __kind__: "invalidUrl";
    invalidUrl: string;
} | {
    __kind__: "rateLimited";
    rateLimited: null;
};
export interface CreatedLink {
    id: LinkId;
    status: LinkStatus;
    code: ShortCode;
    createdAt: Timestamp;
    targetUrl: string;
    editToken: EditToken;
    manageUrl: string;
    shortUrl: string;
}
export interface DailyScanCount {
    day: string;
    count: bigint;
}
export interface DashboardStats {
    topicCount: bigint;
    subjectCount: bigint;
    classCount: bigint;
    chapterCount: bigint;
    questionCount: bigint;
}
export interface DraftQuestion {
    id: Id;
    explanation?: string;
    answer: AnswerData;
    questionType: QuestionType;
    prompt: string;
    topicId: Id;
}
export type EditToken = string;
export type Error_ = {
    __kind__: "FrontendOriginsNotConfigured";
    FrontendOriginsNotConfigured: null;
} | {
    __kind__: "MixedSsoSources";
    MixedSsoSources: {
        otherKeys: Array<string>;
        ssoKeys: Array<string>;
    };
} | {
    __kind__: "Stale";
    Stale: {
        ageNs: bigint;
    };
} | {
    __kind__: "MalformedCandid";
    MalformedCandid: null;
} | {
    __kind__: "AmbiguousAttribute";
    AmbiguousAttribute: {
        field: string;
        sources: Array<string>;
    };
} | {
    __kind__: "NoAttributes";
    NoAttributes: null;
} | {
    __kind__: "UnknownNonce";
    UnknownNonce: null;
} | {
    __kind__: "UntrustedSsoSource";
    UntrustedSsoSource: {
        domain: string;
    };
} | {
    __kind__: "MissingField";
    MissingField: string;
} | {
    __kind__: "FrontendOriginMismatch";
    FrontendOriginMismatch: {
        got: string;
        expected: Array<string>;
    };
};
export interface ExportFile {
    content: string;
    mimeType: string;
    filename: string;
}
export interface GenerateRequest {
    count: bigint;
    sourceText?: string;
    prompt: string;
    topicId: Id;
}
export interface GenerateResult {
    source: AiSource;
    drafts: Array<GeneratedDraft>;
}
export interface GeneratedDraft {
    source: AiSource;
    draft: DraftQuestion;
}
export type Id = bigint;
export interface LinkDetail {
    id: LinkId;
    status: LinkStatus;
    code: ShortCode;
    createdAt: Timestamp;
    targetUrl: string;
    updatedAt: Timestamp;
    shortUrl: string;
}
export type LinkId = bigint;
export type ManageLinkError = {
    __kind__: "notAuthorized";
    notAuthorized: null;
} | {
    __kind__: "invalidUrl";
    invalidUrl: string;
} | {
    __kind__: "notFound";
    notFound: null;
};
export type NoteError = {
    __kind__: "notAuthorized";
    notAuthorized: null;
} | {
    __kind__: "invalidInput";
    invalidInput: string;
} | {
    __kind__: "notFound";
    notFound: null;
} | {
    __kind__: "staleRevision";
    staleRevision: {
        actual: bigint;
        expected: bigint;
    };
};
export interface NoteShareLink {
    status: string;
    token: string;
    noteId: Id;
    createdAt: Timestamp;
}
export interface NoteView {
    id: Id;
    status: string;
    documentJson: string;
    title: string;
    topicLabel?: string;
    createdAt: Timestamp;
    subjectLabel?: string;
    updatedAt: Timestamp;
    revision: bigint;
    chapterLabel?: string;
    deletedAt?: Timestamp;
}
export interface Option {
    id: Id;
    text: string;
}
export interface PublicQuestion {
    id: Id;
    questionType: QuestionType;
    prompt: string;
    options: Array<Option>;
}
export interface Question {
    id: Id;
    explanation?: string;
    createdAt: Timestamp;
    answer: AnswerData;
    questionType: QuestionType;
    updatedAt: Timestamp;
    prompt: string;
    topicId: Id;
}
export interface QuestionResult {
    submitted?: SubmittedAnswer;
    explanation?: string;
    correctAnswer: AnswerData;
    correct: boolean;
    questionType: QuestionType;
    questionId: Id;
    prompt: string;
}
export type ResolveResult = {
    __kind__: "redirect";
    redirect: {
        targetUrl: string;
    };
} | {
    __kind__: "unavailable";
    unavailable: UnavailableReason;
};
export type Result = {
    __kind__: "ok";
    ok: AnswerFeedback;
} | {
    __kind__: "err";
    err: SessionError;
};
export type Result_1 = {
    __kind__: "ok";
    ok: SessionView;
} | {
    __kind__: "err";
    err: SessionError;
};
export type Result_2 = {
    __kind__: "ok";
    ok: GenerateResult;
} | {
    __kind__: "err";
    err: AiError;
};
export type Result_3 = {
    __kind__: "ok";
    ok: ExportFile;
} | {
    __kind__: "err";
    err: ExportError;
};
export type Result_4 = {
    __kind__: "ok";
    ok: ShareLink;
} | {
    __kind__: "err";
    err: ShareError;
};
export type Result_5 = {
    __kind__: "ok";
    ok: SessionResult;
} | {
    __kind__: "err";
    err: SessionError;
};
export type Result_6 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: Error_;
};
export interface Result__1 {
    hasMore: boolean;
    rows: Array<Array<Cell>>;
}
export interface ScanStats {
    perDay: Array<DailyScanCount>;
    totalScans: bigint;
}
export type SessionError = {
    __kind__: "noQuestions";
    noQuestions: null;
} | {
    __kind__: "notAuthorized";
    notAuthorized: null;
} | {
    __kind__: "invalidInput";
    invalidInput: string;
} | {
    __kind__: "notFound";
    notFound: null;
};
export interface SessionQuestion {
    id: Id;
    questionType: QuestionType;
    prompt: string;
    options: Array<Option>;
}
export interface SessionResult {
    id: Id;
    completedAt: Timestamp;
    startedAt: Timestamp;
    total: bigint;
    mode: SessionMode;
    results: Array<QuestionResult>;
    scope: SessionScope;
    score: bigint;
}
export type SessionScope = {
    __kind__: "topic";
    topic: Id;
} | {
    __kind__: "chapter";
    chapter: Id;
};
export interface SessionView {
    id: Id;
    startedAt: Timestamp;
    expiresAt?: Timestamp;
    mode: SessionMode;
    scopeLabel: string;
    scope: SessionScope;
    durationSeconds?: bigint;
    questions: Array<SessionQuestion>;
}
export type SettingsError = {
    __kind__: "notAuthorized";
    notAuthorized: null;
} | {
    __kind__: "invalidInput";
    invalidInput: string;
};
export interface ShareLink {
    token: string;
    createdAt: Timestamp;
    target: ShareTarget;
}
export type ShareTarget = {
    __kind__: "topic";
    topic: Id;
} | {
    __kind__: "chapter";
    chapter: Id;
};
export interface SharedContent {
    title: string;
    breadcrumb: Array<BreadcrumbItem>;
    questions: Array<PublicQuestion>;
}
export interface SharedNote {
    documentJson: string;
    title: string;
    updatedAt: Timestamp;
    revision: bigint;
}
export type ShortCode = string;
export interface StartSessionRequest {
    mode: SessionMode;
    scope: SessionScope;
    durationSeconds?: bigint;
    questionCount?: bigint;
}
export interface SubjectDetail {
    subject: SubjectSummary;
    chapters: Array<ChapterSummary>;
}
export interface SubjectSummary {
    id: Id;
    name: string;
    createdAt: Timestamp;
    description?: string;
    classId: Id;
    updatedAt: Timestamp;
    chapterCount: bigint;
}
export interface SubmitAnswerRequest {
    answer: SubmittedAnswer;
    questionId: Id;
    sessionId: Id;
}
export type SubmittedAnswer = {
    __kind__: "shortAnswer";
    shortAnswer: {
        text: string;
    };
} | {
    __kind__: "multipleChoice";
    multipleChoice: {
        optionId: Id;
    };
} | {
    __kind__: "trueFalse";
    trueFalse: {
        value: boolean;
    };
};
export type Timestamp = bigint;
export interface TopicDetail {
    topic: TopicSummary;
    questions: Array<Question>;
}
export interface TopicPath {
    topic: BreadcrumbItem;
    subject: BreadcrumbItem;
    class: BreadcrumbItem;
    chapter: BreadcrumbItem;
}
export interface TopicSummary {
    id: Id;
    name: string;
    createdAt: Timestamp;
    description?: string;
    chapterId: Id;
    updatedAt: Timestamp;
    questionCount: bigint;
}
export interface UserDataExport {
    content: string;
    mimeType: string;
    filename: string;
}
export interface UserSettingsView {
    displayName: string;
    dailyTarget: bigint;
    appearance: string;
    updatedAt: Timestamp;
    studyGoal: string;
}
export type Value = {
    __kind__: "int";
    int: bigint;
} | {
    __kind__: "nat";
    nat: bigint;
} | {
    __kind__: "float";
    float: number;
} | {
    __kind__: "bool";
    bool: boolean;
} | {
    __kind__: "null";
    null: null;
} | {
    __kind__: "text";
    text: string;
};
export enum AiSource {
    personalKey = "personalKey",
    platform = "platform"
}
export enum DeviceType {
    desktop = "desktop",
    other = "other",
    tablet = "tablet",
    mobile = "mobile"
}
export enum ExportError {
    notAuthorized = "notAuthorized",
    empty = "empty",
    notFound = "notFound"
}
export enum ExportFormat {
    csv = "csv",
    pdf = "pdf"
}
export enum LinkStatus {
    deleted = "deleted",
    active = "active",
    paused = "paused"
}
export enum NoteShareError {
    notAuthorized = "notAuthorized",
    notFound = "notFound"
}
export enum QuestionType {
    shortAnswer = "shortAnswer",
    multipleChoice = "multipleChoice",
    trueFalse = "trueFalse"
}
export enum SessionMode {
    practice = "practice",
    timedTest = "timedTest"
}
export enum ShareError {
    notAuthorized = "notAuthorized",
    notFound = "notFound"
}
export enum UnavailableReason {
    deleted = "deleted",
    notFound = "notFound",
    rateLimited = "rateLimited",
    paused = "paused"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    /**
     * / Accept an AI-generated draft into a topic's question bank.
     */
    acceptDraft(topicId: Id, draft: DraftQuestion): Promise<Question | null>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    /**
     * / Finish a session (or let a timed test auto-submit) and record its result.
     */
    completeSession(sessionId: Id): Promise<Result_5>;
    /**
     * / Create a chapter inside a subject.
     */
    createChapter(subjectId: Id, name: string, description: string | null): Promise<ChapterSummary | null>;
    /**
     * / Create a class.
     */
    createClass(name: string, description: string | null): Promise<ClassSummary>;
    /**
     * / Create a short link for a target URL. Anonymous callers are allowed.
     * / Returns the short URL to encode in the QR code and the secret manage URL.
     */
    createLink(targetUrl: string): Promise<{
        __kind__: "ok";
        ok: CreatedLink;
    } | {
        __kind__: "err";
        err: CreateLinkError;
    }>;
    /**
     * / Create a note owned by the caller.
     */
    createNote(title: string, subjectLabel: string | null, chapterLabel: string | null, topicLabel: string | null, documentJson: string, searchText: string): Promise<NoteView>;
    /**
     * / Create a read-only share token for one of the caller's notes.
     */
    createNoteShare(noteId: Id): Promise<{
        __kind__: "ok";
        ok: NoteShareLink;
    } | {
        __kind__: "err";
        err: NoteShareError;
    }>;
    /**
     * / Create a question inside a topic.
     */
    createQuestion(topicId: Id, prompt: string, questionType: QuestionType, answer: AnswerData, explanation: string | null): Promise<Question | null>;
    /**
     * / Create (or return the existing) public read-only share link for a
     * / chapter or topic.
     */
    createShare(target: ShareTarget): Promise<Result_4>;
    /**
     * / Create a subject inside a class.
     */
    createSubject(classId: Id, name: string, description: string | null): Promise<SubjectSummary | null>;
    /**
     * / Create a topic inside a chapter.
     */
    createTopic(chapterId: Id, name: string, description: string | null): Promise<TopicSummary | null>;
    /**
     * / Delete a chapter and all of its descendants.
     */
    deleteChapter(chapterId: Id): Promise<boolean>;
    /**
     * / Delete a class and all of its descendants.
     */
    deleteClass(classId: Id): Promise<boolean>;
    /**
     * / Soft-delete a link by secret edit token.
     */
    deleteLink(editToken: EditToken): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: ManageLinkError;
    }>;
    /**
     * / Delete a question.
     */
    deleteQuestion(questionId: Id): Promise<boolean>;
    /**
     * / Delete a subject and all of its descendants.
     */
    deleteSubject(subjectId: Id): Promise<boolean>;
    /**
     * / Delete a topic and all of its questions.
     */
    deleteTopic(topicId: Id): Promise<boolean>;
    execute(qJson: string): Promise<Result__1>;
    /**
     * / Export a topic or chapter as a downloadable file.
     */
    exportContent(target: ShareTarget, format: ExportFormat): Promise<Result_3>;
    /**
     * / Export everything the caller stores as a downloadable JSON file.
     */
    exportMyData(): Promise<UserDataExport>;
    /**
     * / Generate draft questions for a topic.
     */
    generateDrafts(request: GenerateRequest): Promise<Result_2>;
    /**
     * / The caller's AI configuration state. Never returns the saved key.
     */
    getAiConfig(): Promise<AiConfigStatus>;
    /**
     * / Accuracy breakdowns by class, subject, and question type.
     */
    getAnalyticsBreakdown(): Promise<AnalyticsBreakdown>;
    /**
     * / Static Markdown documentation of this backend's public API.
     */
    getApiDoc(): Promise<string>;
    /**
     * / Practice and test attempt history, newest first.
     */
    getAttemptHistory(): Promise<Array<AttemptSummary>>;
    getCallerUserRole(): Promise<UserRole>;
    /**
     * / Detail view of a chapter with its topics.
     */
    getChapter(chapterId: Id): Promise<ChapterDetail | null>;
    /**
     * / Detail view of a class with its subjects.
     */
    getClass(classId: Id): Promise<ClassDetail | null>;
    /**
     * / Dashboard stat cards for the caller.
     */
    getDashboardStats(): Promise<DashboardStats>;
    /**
     * / Fetch link details by secret edit token. Anonymous, token-gated.
     */
    getLinkByToken(editToken: EditToken): Promise<LinkDetail | null>;
    /**
     * / Read the caller's settings.
     */
    getMySettings(): Promise<UserSettingsView | null>;
    /**
     * / Read one of the caller's notes.
     */
    getNote(noteId: Id): Promise<NoteView | null>;
    /**
     * / Recent activity feed for the caller, newest first.
     */
    getRecentActivity(limit: bigint): Promise<Array<ActivityItem>>;
    /**
     * / Scan statistics for a link by secret edit token.
     */
    getScanStats(editToken: EditToken): Promise<ScanStats | null>;
    /**
     * / Fetch a live session, including its questions (answers withheld).
     */
    getSession(sessionId: Id): Promise<SessionView | null>;
    /**
     * / Fetch a recorded session result.
     */
    getSessionResult(sessionId: Id): Promise<SessionResult | null>;
    /**
     * / Resolve a share token to its public read-only content. Anonymous callers
     * / are allowed; answers are never revealed.
     */
    getSharedContent(token: string): Promise<SharedContent | null>;
    /**
     * / Resolve a share token to its public read-only note payload.
     */
    getSharedNote(token: string): Promise<SharedNote | null>;
    /**
     * / Detail view of a subject with its chapters.
     */
    getSubject(subjectId: Id): Promise<SubjectDetail | null>;
    /**
     * / Detail view of a topic with its questions.
     */
    getTopic(topicId: Id): Promise<TopicDetail | null>;
    /**
     * / The class > subject > chapter > topic breadcrumb path for a topic.
     */
    getTopicPath(topicId: Id): Promise<TopicPath | null>;
    isCallerAdmin(): Promise<boolean>;
    /**
     * / List every chapter of a subject.
     */
    listChapters(subjectId: Id): Promise<Array<ChapterSummary>>;
    /**
     * / List every class owned by the caller.
     */
    listClasses(): Promise<Array<ClassSummary>>;
    /**
     * / List the caller's note share tokens.
     */
    listNoteShares(): Promise<Array<NoteShareLink>>;
    /**
     * / List the caller's live notes, optionally filtered by a search query.
     */
    listNotes(searchQuery: string | null): Promise<Array<NoteView>>;
    /**
     * / List every question in a topic.
     */
    listQuestions(topicId: Id): Promise<Array<Question>>;
    /**
     * / List the caller's share links.
     */
    listShares(): Promise<Array<ShareLink>>;
    /**
     * / List every subject of a class.
     */
    listSubjects(classId: Id): Promise<Array<SubjectSummary>>;
    /**
     * / List every topic of a chapter.
     */
    listTopics(chapterId: Id): Promise<Array<TopicSummary>>;
    /**
     * / List the caller's soft-deleted notes.
     */
    listTrashedNotes(): Promise<Array<NoteView>>;
    /**
     * / Permanently delete one of the caller's notes and its share tokens.
     */
    permanentlyDeleteNote(noteId: Id): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: NoteError;
    }>;
    /**
     * / Recompute both hot-path indexes from the primary maps.
     * /
     * / The indexes are maintained by the ordinary mutation points (questions in
     * / createQuestion/deleteQuestion/deleteQuestionsOfTopic, link codes in
     * / createLink), so this only ever needs to run once — after an upgrade that
     * / introduces an index onto a state that predates it. Admin-gated because
     * / a full rebuild is the one O(n) operation the indexes exist to avoid.
     */
    rebuildIndexes(): Promise<void>;
    /**
     * / Remove the caller's personal OpenAI key.
     */
    removeAiKey(): Promise<AiConfigStatus>;
    /**
     * / Rename (and optionally re-describe) a chapter.
     */
    renameChapter(chapterId: Id, name: string, description: string | null): Promise<ChapterSummary | null>;
    /**
     * / Rename (and optionally re-describe) a class.
     */
    renameClass(classId: Id, name: string, description: string | null): Promise<ClassSummary | null>;
    /**
     * / Rename one of the caller's notes.
     */
    renameNote(noteId: Id, title: string): Promise<{
        __kind__: "ok";
        ok: NoteView;
    } | {
        __kind__: "err";
        err: NoteError;
    }>;
    /**
     * / Rename (and optionally re-describe) a subject.
     */
    renameSubject(subjectId: Id, name: string, description: string | null): Promise<SubjectSummary | null>;
    /**
     * / Rename (and optionally re-describe) a topic.
     */
    renameTopic(topicId: Id, name: string, description: string | null): Promise<TopicSummary | null>;
    /**
     * / Report a short link as abusive. Anonymous callers are allowed; the
     * / report is rate limited per caller. The throttle rides `#invalidInput`
     * / because that is the only `AbuseError` variant that carries a sentence —
     * / the candid union is generated and gains no variants (the same rule the
     * / Postgres path follows).
     */
    reportAbuse(code: ShortCode, reason: string): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: AbuseError;
    }>;
    /**
     * / Resolve a short code for redirect. Anonymous callers are allowed.
     * / Returns the current target URL or the reason the link is unavailable.
     */
    resolveCode(code: ShortCode, device: DeviceType, country: string | null): Promise<ResolveResult>;
    /**
     * / Restore one of the caller's soft-deleted notes.
     */
    restoreNote(noteId: Id): Promise<{
        __kind__: "ok";
        ok: NoteView;
    } | {
        __kind__: "err";
        err: NoteError;
    }>;
    /**
     * / Revoke one of the caller's note share tokens.
     */
    revokeNoteShare(token: string): Promise<{
        __kind__: "ok";
        ok: null;
    } | {
        __kind__: "err";
        err: NoteShareError;
    }>;
    /**
     * / Revoke a share link; it no longer resolves afterwards.
     */
    revokeShare(token: string): Promise<boolean>;
    /**
     * / Save (or replace) the caller's personal OpenAI key.
     */
    saveAiKey(key: string): Promise<AiConfigStatus>;
    /**
     * / Save the caller's settings.
     */
    saveMySettings(displayName: string, studyGoal: string, dailyTarget: bigint, appearance: string): Promise<{
        __kind__: "ok";
        ok: UserSettingsView;
    } | {
        __kind__: "err";
        err: SettingsError;
    }>;
    schema(): Promise<string>;
    /**
     * / Pause or unpause a link by secret edit token.
     */
    setPaused(editToken: EditToken, paused: boolean): Promise<{
        __kind__: "ok";
        ok: LinkDetail;
    } | {
        __kind__: "err";
        err: ManageLinkError;
    }>;
    /**
     * / Soft-delete one of the caller's notes.
     */
    softDeleteNote(noteId: Id): Promise<{
        __kind__: "ok";
        ok: NoteView;
    } | {
        __kind__: "err";
        err: NoteError;
    }>;
    /**
     * / Start a practice session or timed test on a topic or chapter.
     */
    startSession(request: StartSessionRequest): Promise<Result_1>;
    /**
     * / Submit one answer and receive immediate feedback.
     */
    submitAnswer(request: SubmitAnswerRequest): Promise<Result>;
    /**
     * / Update one of the caller's notes, rejecting a stale `expectedRevision`.
     */
    updateNote(noteId: Id, title: string, subjectLabel: string | null, chapterLabel: string | null, topicLabel: string | null, documentJson: string, searchText: string, expectedRevision: bigint): Promise<{
        __kind__: "ok";
        ok: NoteView;
    } | {
        __kind__: "err";
        err: NoteError;
    }>;
    /**
     * / Edit an existing question.
     */
    updateQuestion(questionId: Id, prompt: string, questionType: QuestionType, answer: AnswerData, explanation: string | null): Promise<Question | null>;
    /**
     * / Change the target URL of a link by secret edit token.
     */
    updateTarget(editToken: EditToken, targetUrl: string): Promise<{
        __kind__: "ok";
        ok: LinkDetail;
    } | {
        __kind__: "err";
        err: ManageLinkError;
    }>;
}
