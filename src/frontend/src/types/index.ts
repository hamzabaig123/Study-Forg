/**
 * Shared type surface for StudyForge.
 *
 * Everything here is re-exported from the generated backend bindings so pages
 * never import `@/backend` directly for types. Enums are re-exported as VALUES
 * (not `export type`) because they are used in comparisons and switches.
 */
export type {
  AbuseError,
  AccuracyBucket,
  ActivityItem,
  AiConfigStatus,
  AiError,
  AnalyticsBreakdown,
  AnswerData,
  AnswerFeedback,
  AttemptSummary,
  BreadcrumbItem,
  ChapterDetail,
  ChapterSummary,
  ClassDetail,
  ClassSummary,
  CreateLinkError,
  CreatedLink,
  DailyScanCount,
  DashboardStats,
  DraftQuestion,
  EditToken,
  ExportFile,
  GenerateRequest,
  GeneratedDraft,
  GenerateResult,
  Id,
  LinkDetail,
  LinkId,
  ManageLinkError,
  NoteError,
  NoteShareLink,
  NoteView,
  PublicQuestion,
  Question,
  QuestionResult,
  ResolveResult,
  Result,
  Result_1,
  Result_2,
  Result_3,
  Result_4,
  Result_5,
  ScanStats,
  SessionError,
  SessionQuestion,
  SessionResult,
  SessionScope,
  SessionView,
  SettingsError,
  ShareLink,
  ShareTarget,
  SharedContent,
  SharedNote,
  ShortCode,
  StartSessionRequest,
  SubjectDetail,
  SubjectSummary,
  SubmitAnswerRequest,
  SubmittedAnswer,
  Timestamp,
  TopicDetail,
  TopicPath,
  TopicSummary,
  UserDataExport,
  UserSettingsView,
} from "@/backend";

export {
  AiSource,
  DeviceType,
  ExportError,
  ExportFormat,
  LinkStatus,
  NoteShareError,
  QuestionType,
  SessionMode,
  ShareError,
  UnavailableReason,
  UserRole,
} from "@/backend";

/** The three themes StudyForge supports. */
export type ThemeName = "light" | "dark" | "frosted";

/** A single entry in the sidebar navigation tree. */
export interface NavItem {
  label: string;
  to: string;
  icon: string;
  exact?: boolean;
}
