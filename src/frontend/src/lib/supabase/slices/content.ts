/**
 * Adapter slice: the content hierarchy and its question bank.
 *
 * Twenty-five of the canister's methods are this — class > subject > chapter >
 * topic > question, each with a list, a detail, a rename and a cascade delete.
 * They are the least interesting part of the migration and the most
 * consequential: everything else in the app is read through one of these rows.
 *
 * Two rules run through the file:
 *
 *   - A create whose parent does not exist answers `null` rather than throwing,
 *     because that is what the canister does and every caller already branches
 *     on it. Row level security makes "not yours" and "not there" the same
 *     answer, which is the right privacy property even though the mock, with one
 *     owner, could afford to tell them apart.
 *   - The summaries carry child counts, so they come from the `*_rows()`
 *     functions rather than a bare table read. Those compute the count under the
 *     caller's own policies, which is why a count can never describe somebody
 *     else's rows.
 */
import type {
  AnswerData,
  ChapterDetail,
  ChapterSummary,
  ClassDetail,
  ClassSummary,
  Id,
  Question,
  QuestionType,
  SubjectDetail,
  SubjectSummary,
  TopicDetail,
  TopicPath,
  TopicSummary,
  backendInterface,
} from "@/backend";
import {
  firstOrNone,
  idArg,
  jsonArg,
  logActivity,
  nullableLabel,
  requireUserId,
  rpcRows,
} from "../common";
import {
  chapterSummary,
  classSummary,
  questionOf,
  subjectSummary,
  topicPathOf,
  topicSummary,
} from "../mapping";
import type { Row, SupabaseTransport } from "../transport";

/** One row out of a `*_rows()` reply, or null when the id is not theirs. */
async function oneRow(
  transport: SupabaseTransport,
  name: string,
  args: Row,
): Promise<Row | null> {
  const rows = await rpcRows(transport, name, args);
  return firstOrNone(rows);
}

/** The caller's share links pointing at content that is about to disappear. */
async function dropSharesFor(
  transport: SupabaseTransport,
  topicIds: Set<string>,
  chapterIds: Set<string>,
): Promise<void> {
  const shares = await transport.read("content_share");
  for (const share of shares) {
    const id = String(share.scope_id);
    const doomed =
      (share.scope_kind === "topic" && topicIds.has(id)) ||
      (share.scope_kind === "chapter" && chapterIds.has(id));
    if (doomed) {
      await transport.write("content_share", {
        eq: { token: String(share.token) },
        remove: true,
      });
    }
  }
}

/** Ids of every topic and chapter under one level of the hierarchy. */
async function descendantsOf(
  transport: SupabaseTransport,
  level: "class" | "subject" | "chapter" | "topic",
  id: string,
): Promise<{ topicIds: Set<string>; chapterIds: Set<string> }> {
  const read = async (table: string, column: string, parent: string) =>
    (await transport.read(table, { eq: { [column]: parent } })).map((row) =>
      String(row.id),
    );

  const subjectIds =
    level === "class" ? await read("subject", "class_id", id) : [];
  const chapterLevelIds =
    level === "class"
      ? (
          await Promise.all(
            subjectIds.map((sid) => read("chapter", "subject_id", sid)),
          )
        ).flat()
      : level === "subject"
        ? await read("chapter", "subject_id", id)
        : level === "chapter"
          ? [id]
          : [];
  const topicIds = new Set(
    (
      await Promise.all(
        chapterLevelIds.map((cid) => read("topic", "chapter_id", cid)),
      )
    ).flat(),
  );
  const chapterIds = new Set(chapterLevelIds);
  if (level === "topic") {
    topicIds.add(id);
  }
  return { topicIds, chapterIds };
}

export function createContentSlice(
  transport: SupabaseTransport,
): Pick<
  backendInterface,
  | "createClass"
  | "listClasses"
  | "getClass"
  | "renameClass"
  | "deleteClass"
  | "createSubject"
  | "listSubjects"
  | "getSubject"
  | "renameSubject"
  | "deleteSubject"
  | "createChapter"
  | "listChapters"
  | "getChapter"
  | "renameChapter"
  | "deleteChapter"
  | "createTopic"
  | "listTopics"
  | "getTopic"
  | "getTopicPath"
  | "renameTopic"
  | "deleteTopic"
  | "createQuestion"
  | "listQuestions"
  | "updateQuestion"
  | "deleteQuestion"
> {
  return {
    /* ---------------------------------- classes --------------------------------- */

    async createClass(
      name: string,
      description: string | null,
    ): Promise<ClassSummary> {
      await requireUserId(transport);
      const [row] = await transport.write("class", {
        insert: { name, description: nullableLabel(description) },
      });
      await logActivity(transport, "class", `Created class "${name}"`);
      return classSummary(
        await oneRowOrThrow(transport, "class_rows", { p_id: String(row.id) }),
      );
    },

    async listClasses(): Promise<ClassSummary[]> {
      await requireUserId(transport);
      const rows = await rpcRows(transport, "class_rows");
      return rows.map(classSummary);
    },

    async getClass(classId: Id): Promise<ClassDetail | null> {
      await requireUserId(transport);
      const row = await oneRow(transport, "class_rows", {
        p_id: idArg(classId),
      });
      if (!row) {
        return null;
      }
      const subjects = await rpcRows(transport, "subject_rows", {
        p_class_id: idArg(classId),
      });
      return {
        class: classSummary(row),
        subjects: subjects.map(subjectSummary),
      };
    },

    async renameClass(
      classId: Id,
      name: string,
      description: string | null,
    ): Promise<ClassSummary | null> {
      await requireUserId(transport);
      const written = await transport.write("class", {
        eq: { id: idArg(classId) },
        update: { name, description: nullableLabel(description) },
      });
      if (written.length === 0) {
        return null;
      }
      const row = await oneRow(transport, "class_rows", {
        p_id: idArg(classId),
      });
      return row ? classSummary(row) : null;
    },

    async deleteClass(classId: Id): Promise<boolean> {
      await requireUserId(transport);
      const { topicIds, chapterIds } = await descendantsOf(
        transport,
        "class",
        idArg(classId),
      );
      const written = await transport.write("class", {
        eq: { id: idArg(classId) },
        remove: true,
      });
      if (written.length === 0) {
        return false;
      }
      await dropSharesFor(transport, topicIds, chapterIds);
      return true;
    },

    /* --------------------------------- subjects --------------------------------- */

    async createSubject(
      classId: Id,
      name: string,
      description: string | null,
    ): Promise<SubjectSummary | null> {
      await requireUserId(transport);
      if (!(await oneRow(transport, "class_rows", { p_id: idArg(classId) }))) {
        return null;
      }
      const [row] = await transport.write("subject", {
        insert: {
          class_id: idArg(classId),
          name,
          description: nullableLabel(description),
        },
      });
      await logActivity(transport, "subject", `Created subject "${name}"`);
      return subjectSummary(
        await oneRowOrThrow(transport, "subject_rows", {
          p_id: String(row.id),
        }),
      );
    },

    async listSubjects(classId: Id): Promise<SubjectSummary[]> {
      await requireUserId(transport);
      const rows = await rpcRows(transport, "subject_rows", {
        p_class_id: idArg(classId),
      });
      return rows.map(subjectSummary);
    },

    async getSubject(subjectId: Id): Promise<SubjectDetail | null> {
      await requireUserId(transport);
      const row = await oneRow(transport, "subject_rows", {
        p_id: idArg(subjectId),
      });
      if (!row) {
        return null;
      }
      const chapters = await rpcRows(transport, "chapter_rows", {
        p_subject_id: idArg(subjectId),
      });
      return {
        subject: subjectSummary(row),
        chapters: chapters.map(chapterSummary),
      };
    },

    async renameSubject(
      subjectId: Id,
      name: string,
      description: string | null,
    ): Promise<SubjectSummary | null> {
      await requireUserId(transport);
      const written = await transport.write("subject", {
        eq: { id: idArg(subjectId) },
        update: { name, description: nullableLabel(description) },
      });
      if (written.length === 0) {
        return null;
      }
      const row = await oneRow(transport, "subject_rows", {
        p_id: idArg(subjectId),
      });
      return row ? subjectSummary(row) : null;
    },

    async deleteSubject(subjectId: Id): Promise<boolean> {
      await requireUserId(transport);
      const { topicIds, chapterIds } = await descendantsOf(
        transport,
        "subject",
        idArg(subjectId),
      );
      const written = await transport.write("subject", {
        eq: { id: idArg(subjectId) },
        remove: true,
      });
      if (written.length === 0) {
        return false;
      }
      await dropSharesFor(transport, topicIds, chapterIds);
      return true;
    },

    /* --------------------------------- chapters --------------------------------- */

    async createChapter(
      subjectId: Id,
      name: string,
      description: string | null,
    ): Promise<ChapterSummary | null> {
      await requireUserId(transport);
      if (
        !(await oneRow(transport, "subject_rows", { p_id: idArg(subjectId) }))
      ) {
        return null;
      }
      const [row] = await transport.write("chapter", {
        insert: {
          subject_id: idArg(subjectId),
          name,
          description: nullableLabel(description),
        },
      });
      await logActivity(transport, "chapter", `Created chapter "${name}"`);
      return chapterSummary(
        await oneRowOrThrow(transport, "chapter_rows", {
          p_id: String(row.id),
        }),
      );
    },

    async listChapters(subjectId: Id): Promise<ChapterSummary[]> {
      await requireUserId(transport);
      const rows = await rpcRows(transport, "chapter_rows", {
        p_subject_id: idArg(subjectId),
      });
      return rows.map(chapterSummary);
    },

    async getChapter(chapterId: Id): Promise<ChapterDetail | null> {
      await requireUserId(transport);
      const row = await oneRow(transport, "chapter_rows", {
        p_id: idArg(chapterId),
      });
      if (!row) {
        return null;
      }
      const topics = await rpcRows(transport, "topic_rows", {
        p_chapter_id: idArg(chapterId),
      });
      return { chapter: chapterSummary(row), topics: topics.map(topicSummary) };
    },

    async renameChapter(
      chapterId: Id,
      name: string,
      description: string | null,
    ): Promise<ChapterSummary | null> {
      await requireUserId(transport);
      const written = await transport.write("chapter", {
        eq: { id: idArg(chapterId) },
        update: { name, description: nullableLabel(description) },
      });
      if (written.length === 0) {
        return null;
      }
      const row = await oneRow(transport, "chapter_rows", {
        p_id: idArg(chapterId),
      });
      return row ? chapterSummary(row) : null;
    },

    async deleteChapter(chapterId: Id): Promise<boolean> {
      await requireUserId(transport);
      const { topicIds, chapterIds } = await descendantsOf(
        transport,
        "chapter",
        idArg(chapterId),
      );
      const written = await transport.write("chapter", {
        eq: { id: idArg(chapterId) },
        remove: true,
      });
      if (written.length === 0) {
        return false;
      }
      await dropSharesFor(transport, topicIds, chapterIds);
      return true;
    },

    /* ---------------------------------- topics ---------------------------------- */

    async createTopic(
      chapterId: Id,
      name: string,
      description: string | null,
    ): Promise<TopicSummary | null> {
      await requireUserId(transport);
      if (
        !(await oneRow(transport, "chapter_rows", { p_id: idArg(chapterId) }))
      ) {
        return null;
      }
      const [row] = await transport.write("topic", {
        insert: {
          chapter_id: idArg(chapterId),
          name,
          description: nullableLabel(description),
        },
      });
      await logActivity(transport, "topic", `Created topic "${name}"`);
      return topicSummary(
        await oneRowOrThrow(transport, "topic_rows", { p_id: String(row.id) }),
      );
    },

    async listTopics(chapterId: Id): Promise<TopicSummary[]> {
      await requireUserId(transport);
      const rows = await rpcRows(transport, "topic_rows", {
        p_chapter_id: idArg(chapterId),
      });
      return rows.map(topicSummary);
    },

    async getTopic(topicId: Id): Promise<TopicDetail | null> {
      await requireUserId(transport);
      const row = await oneRow(transport, "topic_rows", {
        p_id: idArg(topicId),
      });
      if (!row) {
        return null;
      }
      const questions = await transport.read("question", {
        eq: { topic_id: idArg(topicId) },
        order: { column: "id" },
      });
      return { topic: topicSummary(row), questions: questions.map(questionOf) };
    },

    async getTopicPath(topicId: Id): Promise<TopicPath | null> {
      await requireUserId(transport);
      const [row] = await transport.read("topic", {
        select:
          "id,name,chapter:chapter(id,name,subject:subject(id,name,class:class(id,name)))",
        eq: { id: idArg(topicId) },
      });
      return row ? topicPathOf(row) : null;
    },

    async renameTopic(
      topicId: Id,
      name: string,
      description: string | null,
    ): Promise<TopicSummary | null> {
      await requireUserId(transport);
      const written = await transport.write("topic", {
        eq: { id: idArg(topicId) },
        update: { name, description: nullableLabel(description) },
      });
      if (written.length === 0) {
        return null;
      }
      const row = await oneRow(transport, "topic_rows", {
        p_id: idArg(topicId),
      });
      return row ? topicSummary(row) : null;
    },

    async deleteTopic(topicId: Id): Promise<boolean> {
      await requireUserId(transport);
      const written = await transport.write("topic", {
        eq: { id: idArg(topicId) },
        remove: true,
      });
      if (written.length === 0) {
        return false;
      }
      await dropSharesFor(transport, new Set([idArg(topicId)]), new Set());
      return true;
    },

    /* --------------------------------- questions -------------------------------- */

    async createQuestion(
      topicId: Id,
      prompt: string,
      questionType: QuestionType,
      answer: AnswerData,
      explanation: string | null,
    ): Promise<Question | null> {
      await requireUserId(transport);
      const topic = await oneRow(transport, "topic_rows", {
        p_id: idArg(topicId),
      });
      if (!topic) {
        return null;
      }
      const [row] = await transport.write("question", {
        insert: {
          topic_id: idArg(topicId),
          prompt,
          question_type: questionType,
          answer: jsonArg(answer),
          explanation: nullableLabel(explanation),
        },
      });
      await logActivity(
        transport,
        "question",
        `Added a question to "${String(topic.name ?? "this topic")}"`,
      );
      return questionOf(row);
    },

    async listQuestions(topicId: Id): Promise<Question[]> {
      await requireUserId(transport);
      const rows = await transport.read("question", {
        eq: { topic_id: idArg(topicId) },
        order: { column: "id" },
      });
      return rows.map(questionOf);
    },

    async updateQuestion(
      questionId: Id,
      prompt: string,
      questionType: QuestionType,
      answer: AnswerData,
      explanation: string | null,
    ): Promise<Question | null> {
      await requireUserId(transport);
      const [row] = await transport.write("question", {
        eq: { id: idArg(questionId) },
        update: {
          prompt,
          question_type: questionType,
          answer: jsonArg(answer),
          explanation: nullableLabel(explanation),
        },
      });
      return row ? questionOf(row) : null;
    },

    async deleteQuestion(questionId: Id): Promise<boolean> {
      await requireUserId(transport);
      const written = await transport.write("question", {
        eq: { id: idArg(questionId) },
        remove: true,
      });
      return written.length > 0;
    },
  };
}

/**
 * A row the caller just created or renamed.
 *
 * Throwing rather than returning null here is deliberate: the write already
 * succeeded, so an absent summary means the replica the read landed on was behind
 * the one the write committed to — a real Postgres failure mode that must not be
 * reported to the user as "your class was not created" after it was.
 */
async function oneRowOrThrow(
  transport: SupabaseTransport,
  name: string,
  args: Row,
): Promise<Row> {
  const row = await oneRow(transport, name, args);
  if (!row) {
    throw new Error(`${name} lost a row that was just written`);
  }
  return row;
}
