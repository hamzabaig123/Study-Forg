/**
 * Client-side test engine.
 *
 * The backend session API is scoped to a single topic or chapter and always
 * hands questions back in creation order. Custom tests — any mix of subjects,
 * chapters, and topics, a chosen question count, a chosen duration, and
 * shuffled order — are assembled and graded here instead, so they work the
 * same against every backend (canister, Supabase, or the localStorage mock).
 *
 * Grading mirrors the backend's semantics exactly (`trueFalse` boolean
 * equality, `multipleChoice` option-id equality, `shortAnswer`
 * trim-and-lowercase equality) so a local result means the same thing as a
 * canister-recorded one.
 */
import type { Option as QuestionOption } from "@/declarations/backend.did";
import type {
  AnswerData,
  Id,
  Question,
  QuestionType,
  SessionMode,
  SubmittedAnswer,
  TopicSummary,
} from "@/types";

/** Where a pooled question sits in the content tree, captured at build time. */
export interface TopicLabels {
  className: string;
  subjectName: string;
  chapterName: string;
  topicName: string;
}

export interface PoolEntry {
  question: Question;
  labels: TopicLabels;
}

/** One selection made in the test builder. */
export interface TestSelection {
  key: string;
  kind: "chapter" | "topic";
  id: Id;
  /** The chapter the selection lives under (a chapter's own id for chapters). */
  chapterId: Id;
  label: string;
  labels: Omit<TopicLabels, "topicName">;
  /** Question count when the picker knew it; used only for display estimates. */
  questionCount?: number;
}

export interface TestConfig {
  mode: SessionMode;
  /** `null` means "all questions in the pool". */
  questionCount: number | null;
  /** Seconds; `null` for practice runs. */
  durationSeconds: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  scopeLabel: string;
}

/** Fisher–Yates shuffle on a copy; the input array is never mutated. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

/** Same verdict the backend's `submitAnswer` would give for this pair. */
export function isCorrectAnswer(
  answer: AnswerData,
  submitted: SubmittedAnswer,
): boolean {
  if (answer.__kind__ !== submitted.__kind__) return false;
  switch (answer.__kind__) {
    case "multipleChoice":
      return (
        submitted.__kind__ === "multipleChoice" &&
        answer.multipleChoice.correctOptionId ===
          submitted.multipleChoice.optionId
      );
    case "trueFalse":
      return (
        submitted.__kind__ === "trueFalse" &&
        answer.trueFalse.correct === submitted.trueFalse.value
      );
    case "shortAnswer":
      return (
        submitted.__kind__ === "shortAnswer" &&
        normalizeText(answer.shortAnswer.expected) ===
          normalizeText(submitted.shortAnswer.text)
      );
    default:
      return false;
  }
}

/** The correct answer as a readable line, e.g. `A) Mitochondria`. */
export function describeCorrectAnswer(answer: AnswerData): string {
  switch (answer.__kind__) {
    case "trueFalse":
      return answer.trueFalse.correct ? "True" : "False";
    case "shortAnswer":
      return answer.shortAnswer.expected;
    case "multipleChoice": {
      const options = answer.multipleChoice.options;
      const index = options.findIndex(
        (option) => option.id === answer.multipleChoice.correctOptionId,
      );
      if (index < 0) return "—";
      return `${String.fromCharCode(65 + (index % 26))}) ${options[index].text}`;
    }
    default:
      return "—";
  }
}

/** Display options for one question, optionally shuffled. Safe because answers
 * are graded by option id, not by position. */
export function displayOptions(
  question: Question,
  shuffleThem: boolean,
): QuestionOption[] {
  if (question.answer.__kind__ !== "multipleChoice") return [];
  const options = question.answer.multipleChoice.options;
  return shuffleThem ? shuffle(options) : [...options];
}

/** Fetch every question behind the selections, in parallel, with labels. */
export async function gatherPool(
  actor: {
    listQuestions: (topicId: Id) => Promise<Question[]>;
    listTopics: (chapterId: Id) => Promise<TopicSummary[]>;
  },
  selections: readonly TestSelection[],
): Promise<PoolEntry[]> {
  const topics: Array<{ id: Id; labels: TopicLabels }> = [];
  for (const selection of selections) {
    if (selection.kind === "topic") {
      topics.push({
        id: selection.id,
        labels: { ...selection.labels, topicName: selection.label },
      });
      continue;
    }
    for (const topic of await actor.listTopics(selection.id)) {
      topics.push({
        id: topic.id,
        labels: { ...selection.labels, topicName: topic.name },
      });
    }
  }

  const perTopic = await Promise.all(
    topics.map(async (topic) => {
      const questions = await actor.listQuestions(topic.id);
      return questions.map((question) => ({
        question,
        labels: topic.labels,
      }));
    }),
  );

  // A question can appear twice when the same topic sits behind both a
  // whole-chapter and an explicit topic selection; keep the first copy.
  const seen = new Set<string>();
  const pool: PoolEntry[] = [];
  for (const entry of perTopic.flat()) {
    const key = entry.question.id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push(entry);
  }
  return pool;
}

export interface AssembledQuestion {
  id: Id;
  prompt: string;
  questionType: QuestionType;
  options: QuestionOption[];
  correctAnswer: AnswerData;
  explanation: string | null;
  labels: TopicLabels;
}

export interface AssembledTest {
  questions: AssembledQuestion[];
  /** How many questions the pool held before the count was applied. */
  poolSize: number;
}

/** Order, cut, and dress the pool into the test the learner configured. */
export function assembleTest(
  pool: readonly PoolEntry[],
  config: TestConfig,
): AssembledTest {
  const ordered = config.shuffleQuestions ? shuffle(pool) : [...pool];
  const take =
    config.questionCount === null
      ? ordered.length
      : Math.max(1, Math.min(config.questionCount, ordered.length));
  const questions: AssembledQuestion[] = ordered
    .slice(0, take)
    .map((entry) => ({
      id: entry.question.id,
      prompt: entry.question.prompt,
      questionType: entry.question.questionType,
      options: displayOptions(entry.question, config.shuffleOptions),
      correctAnswer: entry.question.answer,
      explanation: entry.question.explanation ?? null,
      labels: entry.labels,
    }));
  return { questions, poolSize: pool.length };
}
