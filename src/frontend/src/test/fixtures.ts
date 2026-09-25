import {
  type AnswerData,
  type AnswerFeedback,
  type ChapterDetail,
  type ChapterSummary,
  type ClassDetail,
  type ClassSummary,
  type PublicQuestion,
  type Question,
  QuestionType,
  SessionMode,
  type SessionQuestion,
  type SessionView,
  type SharedContent,
  type SubjectDetail,
  type SubjectSummary,
  type TopicSummary,
} from "@/types";

/** Fixed timestamp so relative-time rendering is deterministic. */
export const NOW = 1_700_000_000_000_000_000n;

export function makeClass(overrides: Partial<ClassSummary> = {}): ClassSummary {
  return {
    id: 1n,
    name: "Biology 101",
    description: "Introductory biology",
    createdAt: NOW,
    updatedAt: NOW,
    subjectCount: 1n,
    ...overrides,
  };
}

export function makeSubject(
  overrides: Partial<SubjectSummary> = {},
): SubjectSummary {
  return {
    id: 2n,
    classId: 1n,
    name: "Cell Biology",
    description: "The cell and its organelles",
    createdAt: NOW,
    updatedAt: NOW,
    chapterCount: 1n,
    ...overrides,
  };
}

export function makeChapter(
  overrides: Partial<ChapterSummary> = {},
): ChapterSummary {
  return {
    id: 3n,
    subjectId: 2n,
    name: "Cell Structure",
    description: "Organelles and membranes",
    createdAt: NOW,
    updatedAt: NOW,
    topicCount: 1n,
    ...overrides,
  };
}

export function makeTopic(overrides: Partial<TopicSummary> = {}): TopicSummary {
  return {
    id: 4n,
    chapterId: 3n,
    name: "Mitochondria",
    description: "Powerhouse of the cell",
    createdAt: NOW,
    updatedAt: NOW,
    questionCount: 1n,
    ...overrides,
  };
}

export function makeMultipleChoiceAnswer(): AnswerData {
  return {
    __kind__: "multipleChoice",
    multipleChoice: {
      options: [
        { id: 1n, text: "Mitochondria" },
        { id: 2n, text: "Nucleus" },
      ],
      correctOptionId: 1n,
    },
  };
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 10n,
    topicId: 4n,
    prompt: "Which organelle produces ATP?",
    questionType: QuestionType.multipleChoice,
    answer: makeMultipleChoiceAnswer(),
    explanation: "ATP is produced during oxidative phosphorylation.",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeSessionQuestion(
  overrides: Partial<SessionQuestion> = {},
): SessionQuestion {
  return {
    id: 10n,
    questionType: QuestionType.multipleChoice,
    prompt: "Which organelle produces ATP?",
    options: [
      { id: 1n, text: "Mitochondria" },
      { id: 2n, text: "Nucleus" },
    ],
    ...overrides,
  };
}

export function makeSessionView(
  overrides: Partial<SessionView> = {},
): SessionView {
  return {
    id: 7n,
    startedAt: NOW,
    mode: SessionMode.practice,
    scopeLabel: "Mitochondria",
    scope: { __kind__: "topic", topic: 4n },
    questions: [makeSessionQuestion()],
    ...overrides,
  };
}

export function makeFeedback(
  overrides: Partial<AnswerFeedback> = {},
): AnswerFeedback {
  return {
    correct: true,
    correctAnswer: makeMultipleChoiceAnswer(),
    explanation: "ATP is produced during oxidative phosphorylation.",
    ...overrides,
  };
}

export function makeClassDetail(
  overrides: Partial<ClassDetail> = {},
): ClassDetail {
  return {
    class: makeClass(),
    subjects: [makeSubject()],
    ...overrides,
  };
}

export function makeSubjectDetail(
  overrides: Partial<SubjectDetail> = {},
): SubjectDetail {
  return {
    subject: makeSubject(),
    chapters: [makeChapter()],
    ...overrides,
  };
}

export function makeChapterDetail(
  overrides: Partial<ChapterDetail> = {},
): ChapterDetail {
  return {
    chapter: makeChapter(),
    topics: [makeTopic()],
    ...overrides,
  };
}

export function makePublicQuestion(
  overrides: Partial<PublicQuestion> = {},
): PublicQuestion {
  return {
    id: 10n,
    questionType: QuestionType.multipleChoice,
    prompt: "Which organelle produces ATP?",
    options: [
      { id: 1n, text: "Mitochondria" },
      { id: 2n, text: "Nucleus" },
    ],
    ...overrides,
  };
}

export function makeSharedContent(
  overrides: Partial<SharedContent> = {},
): SharedContent {
  return {
    title: "Mitochondria",
    breadcrumb: [
      { id: 1n, name: "Biology 101" },
      { id: 2n, name: "Cell Biology" },
      { id: 3n, name: "Cell Structure" },
      { id: 4n, name: "Mitochondria" },
    ],
    questions: [makePublicQuestion()],
    ...overrides,
  };
}
