import type { AnswerData, QuestionType, backendInterface } from "@/backend";
import { parseWithBigints } from "@/lib/bigintJson";

/**
 * Moving an archive into a backend by calling that backend.
 *
 * The alternative — a SQL function that takes the whole document — would put the
 * one operation every user of this app needs behind a database that has to be
 * reachable to change it. Here the importer speaks the same 77-method contract
 * the pages do, so it runs against Postgres, against the canister, or against the
 * localStorage store, and each id it gets back is whatever that backend chose to
 * mint. Rows are created in dependency order and every child is looked up through
 * a map from the archive's id to the new one, so nothing references a row that no
 * longer exists.
 *
 * Re-running is safe: a row whose name already exists under the same parent is
 * counted as skipped instead of duplicated, which is what a user who closed the
 * tab halfway through a 900-question import needs. One entity is the exception —
 * a published link is addressed only by the secret edit token that an export
 * never carries, so there is nothing to compare a stored URL against and a repeat
 * run publishes it again.
 */

/** Thrown for a file the importer can read but cannot use — never for a row. */
export class ArchiveFormatError extends Error {}

/** One row of an archive, in whichever shape the exporting backend wrote it. */
interface ArchiveRow {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  classId?: unknown;
  subjectId?: unknown;
  chapterId?: unknown;
  topicId?: unknown;
  prompt?: unknown;
  questionType?: QuestionType;
  answer?: AnswerData;
  explanation?: unknown;
  title?: unknown;
  documentJson?: unknown;
  searchText?: unknown;
  subjectLabel?: unknown;
  chapterLabel?: unknown;
  topicLabel?: unknown;
  targetUrl?: unknown;
}

interface ArchiveSettings {
  displayName?: unknown;
  studyGoal?: unknown;
  dailyTarget?: unknown;
  appearance?: unknown;
}

/** The document `exportMyData` returns, once parsed. */
export interface ArchiveDocument {
  exportedAt: string | null;
  classes: ArchiveRow[];
  subjects: ArchiveRow[];
  chapters: ArchiveRow[];
  topics: ArchiveRow[];
  questions: ArchiveRow[];
  notes: ArchiveRow[];
  links: ArchiveRow[];
  settings: ArchiveSettings | null;
  /** Not replayed — see `notRestored` on the report for why. */
  sessions: unknown[];
  results: unknown[];
  activity: unknown[];
  shares: unknown[];
  noteShares: unknown[];
}

export type ImportEntity =
  | "classes"
  | "subjects"
  | "chapters"
  | "topics"
  | "questions"
  | "notes"
  | "links"
  | "settings";

/** Rows per entity, plus whether the profile was carried over. */
export type ImportCounts = Record<ImportEntity, number>;

export interface ImportFailure {
  entity: ImportEntity;
  label: string;
  reason: string;
}

export interface ImportReport {
  created: ImportCounts;
  /** Already present under the same parent, so left alone. */
  skipped: ImportCounts;
  /**
   * Counts of what the importer deliberately did not replay, and why.
   *
   * `start_session` and `submit_answer` stamp the server clock, so a replay would
   * report last month's practice as today's and bend the streak, the accuracy trend
   * and the daily target around a false date. A wrong number is worse than an empty
   * chart, so these are named rather than quietly rewritten.
   */
  notRestored: {
    sessions: number;
    results: number;
    activity: number;
    shares: number;
    noteShares: number;
  };
  failures: ImportFailure[];
}

export type ImportProgress = (done: number, total: number) => void;

function label(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fallback;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/** Archive ids are bigint in an export and number in a stored mock row. */
function idKey(value: unknown): string | null {
  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function rows(value: unknown, field: string): ArchiveRow[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ArchiveFormatError(`"${field}" is not a list of rows.`);
  }
  return value as ArchiveRow[];
}

/**
 * Read a file a person chose, or a string straight out of localStorage.
 *
 * Only the shape is checked here. A file with no rows in it is a valid empty
 * archive — refusing it would block the one import that has nothing to undo.
 */
export function parseArchive(text: string): ArchiveDocument {
  let raw: unknown;
  try {
    raw = parseWithBigints(text);
  } catch (cause) {
    throw new ArchiveFormatError(
      `This is not a readable JSON file (${
        cause instanceof Error ? cause.message : "unknown parse error"
      }).`,
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ArchiveFormatError("The file does not hold an export document.");
  }
  const doc = raw as Record<string, unknown>;
  const known = [
    "classes",
    "subjects",
    "chapters",
    "topics",
    "questions",
    "notes",
    "links",
    "sessions",
    "results",
    "activity",
    "shares",
    "noteShares",
  ];
  if (!known.some((field) => Array.isArray(doc[field]))) {
    throw new ArchiveFormatError(
      "No study data found. Expected a file downloaded by 'Download my data'.",
    );
  }
  const settings = doc.settings;
  return {
    exportedAt: optionalText(doc.exportedAt),
    classes: rows(doc.classes, "classes"),
    subjects: rows(doc.subjects, "subjects"),
    chapters: rows(doc.chapters, "chapters"),
    topics: rows(doc.topics, "topics"),
    questions: rows(doc.questions, "questions"),
    notes: rows(doc.notes, "notes"),
    links: rows(doc.links, "links"),
    settings:
      settings !== null && typeof settings === "object"
        ? (settings as ArchiveSettings)
        : null,
    sessions: rows(doc.sessions, "sessions"),
    results: rows(doc.results, "results"),
    activity: rows(doc.activity, "activity"),
    shares: rows(doc.shares, "shares"),
    noteShares: rows(doc.noteShares, "noteShares"),
  };
}

function emptyCounts(): ImportCounts {
  return {
    classes: 0,
    subjects: 0,
    chapters: 0,
    topics: 0,
    questions: 0,
    notes: 0,
    links: 0,
    settings: 0,
  };
}

function totalRows(doc: ArchiveDocument): number {
  return (
    doc.classes.length +
    doc.subjects.length +
    doc.chapters.length +
    doc.topics.length +
    doc.questions.length +
    doc.notes.length +
    doc.links.length +
    (doc.settings ? 1 : 0)
  );
}

/**
 * Replay an archive into `target`.
 *
 * A row that fails is recorded and the import continues: one bad question should
 * not cost the 400 that came after it. Nothing here deletes what the target
 * already holds, so the worst outcome of a mistaken run is rows the report names
 * and the user removes by hand.
 */
export async function importArchive(
  target: backendInterface,
  doc: ArchiveDocument,
  onProgress?: ImportProgress,
): Promise<ImportReport> {
  const created = emptyCounts();
  const skipped = emptyCounts();
  const failures: ImportFailure[] = [];
  const classIds = new Map<string, bigint>();
  const subjectIds = new Map<string, bigint>();
  const chapterIds = new Map<string, bigint>();
  const topicIds = new Map<string, bigint>();

  let done = 0;
  const total = totalRows(doc);
  const step = () => {
    done += 1;
    onProgress?.(Math.min(done, total), total);
  };
  const fail = (
    entity: ImportEntity,
    row: ArchiveRow,
    cause: unknown,
  ): void => {
    failures.push({
      entity,
      label: label(row.name ?? row.title ?? row.prompt, "Untitled"),
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  };
  /** Record a skipped row without a second read: the caller already listed it. */
  const skipExisting = (
    entity: ImportEntity,
    map: Map<string, bigint>,
    key: string,
    id: bigint,
  ) => {
    skipped[entity] += 1;
    map.set(key, id);
  };

  const knownClasses = await target.listClasses();
  for (const row of doc.classes) {
    step();
    const key = idKey(row.id);
    const name = optionalText(row.name);
    if (!key || !name) {
      fail("classes", row, "A class needs an id and a name.");
      continue;
    }
    const existing = knownClasses.find((item) => item.name === name);
    if (existing) {
      skipExisting("classes", classIds, key, existing.id);
      continue;
    }
    try {
      const made = await target.createClass(
        name,
        optionalText(row.description),
      );
      knownClasses.push(made);
      classIds.set(key, made.id);
      created.classes += 1;
    } catch (cause) {
      fail("classes", row, cause);
    }
  }

  const knownSubjects = new Map<bigint, Array<{ id: bigint; name: string }>>();
  for (const row of doc.subjects) {
    step();
    const key = idKey(row.id);
    const name = optionalText(row.name);
    const classId = classIds.get(idKey(row.classId) ?? "");
    if (!key || !name) {
      fail("subjects", row, "A subject needs an id and a name.");
      continue;
    }
    if (classId === undefined) {
      fail("subjects", row, "Its class is not in this archive.");
      continue;
    }
    const siblings =
      knownSubjects.get(classId) ??
      (await target.listSubjects(classId)).map((item) => ({
        id: item.id,
        name: item.name,
      }));
    const existing = siblings.find((item) => item.name === name);
    if (existing) {
      skipExisting("subjects", subjectIds, key, existing.id);
      continue;
    }
    try {
      const made = await target.createSubject(
        classId,
        name,
        optionalText(row.description),
      );
      if (!made) {
        fail("subjects", row, "The class no longer exists.");
        continue;
      }
      knownSubjects.set(
        classId,
        siblings.concat([{ id: made.id, name: made.name }]),
      );
      subjectIds.set(key, made.id);
      created.subjects += 1;
    } catch (cause) {
      fail("subjects", row, cause);
    }
  }

  const knownChapters = new Map<bigint, Array<{ id: bigint; name: string }>>();
  for (const row of doc.chapters) {
    step();
    const key = idKey(row.id);
    const name = optionalText(row.name);
    const subjectId = subjectIds.get(idKey(row.subjectId) ?? "");
    if (!key || !name) {
      fail("chapters", row, "A chapter needs an id and a name.");
      continue;
    }
    if (subjectId === undefined) {
      fail("chapters", row, "Its subject is not in this archive.");
      continue;
    }
    const siblings =
      knownChapters.get(subjectId) ??
      (await target.listChapters(subjectId)).map((item) => ({
        id: item.id,
        name: item.name,
      }));
    const existing = siblings.find((item) => item.name === name);
    if (existing) {
      skipExisting("chapters", chapterIds, key, existing.id);
      continue;
    }
    try {
      const made = await target.createChapter(
        subjectId,
        name,
        optionalText(row.description),
      );
      if (!made) {
        fail("chapters", row, "The subject no longer exists.");
        continue;
      }
      knownChapters.set(
        subjectId,
        siblings.concat([{ id: made.id, name: made.name }]),
      );
      chapterIds.set(key, made.id);
      created.chapters += 1;
    } catch (cause) {
      fail("chapters", row, cause);
    }
  }

  const knownTopics = new Map<bigint, Array<{ id: bigint; name: string }>>();
  for (const row of doc.topics) {
    step();
    const key = idKey(row.id);
    const name = optionalText(row.name);
    const chapterId = chapterIds.get(idKey(row.chapterId) ?? "");
    if (!key || !name) {
      fail("topics", row, "A topic needs an id and a name.");
      continue;
    }
    if (chapterId === undefined) {
      fail("topics", row, "Its chapter is not in this archive.");
      continue;
    }
    const siblings =
      knownTopics.get(chapterId) ??
      (await target.listTopics(chapterId)).map((item) => ({
        id: item.id,
        name: item.name,
      }));
    const existing = siblings.find((item) => item.name === name);
    if (existing) {
      skipExisting("topics", topicIds, key, existing.id);
      continue;
    }
    try {
      const made = await target.createTopic(
        chapterId,
        name,
        optionalText(row.description),
      );
      if (!made) {
        fail("topics", row, "The chapter no longer exists.");
        continue;
      }
      knownTopics.set(
        chapterId,
        siblings.concat([{ id: made.id, name: made.name }]),
      );
      topicIds.set(key, made.id);
      created.topics += 1;
    } catch (cause) {
      fail("topics", row, cause);
    }
  }

  const knownPrompts = new Map<bigint, Set<string>>();
  for (const row of doc.questions) {
    step();
    const topicId = topicIds.get(idKey(row.topicId) ?? "");
    const prompt = optionalText(row.prompt);
    if (!prompt || !row.answer || !row.questionType) {
      fail(
        "questions",
        row,
        "A question needs a prompt, a type and an answer.",
      );
      continue;
    }
    if (topicId === undefined) {
      fail("questions", row, "Its topic is not in this archive.");
      continue;
    }
    const seen =
      knownPrompts.get(topicId) ??
      new Set((await target.listQuestions(topicId)).map((item) => item.prompt));
    if (seen.has(prompt)) {
      skipped.questions += 1;
      continue;
    }
    try {
      const made = await target.createQuestion(
        topicId,
        prompt,
        row.questionType,
        row.answer,
        optionalText(row.explanation),
      );
      if (!made) {
        fail("questions", row, "The topic no longer exists.");
        continue;
      }
      seen.add(prompt);
      knownPrompts.set(topicId, seen);
      created.questions += 1;
    } catch (cause) {
      fail("questions", row, cause);
    }
  }

  const knownNotes = new Set(
    (await target.listNotes(null)).map(
      (note) => `${note.title}::${note.documentJson}`,
    ),
  );
  for (const row of doc.notes) {
    step();
    const title = label(row.title, "Untitled");
    const documentJson = optionalText(row.documentJson);
    if (!documentJson) {
      fail("notes", row, "A note needs some text.");
      continue;
    }
    const marker = `${title}::${documentJson}`;
    if (knownNotes.has(marker)) {
      skipped.notes += 1;
      continue;
    }
    try {
      await target.createNote(
        title,
        optionalText(row.subjectLabel),
        optionalText(row.chapterLabel),
        optionalText(row.topicLabel),
        documentJson,
        label(row.searchText, title),
      );
      knownNotes.add(marker);
      created.notes += 1;
    } catch (cause) {
      fail("notes", row, cause);
    }
  }

  for (const row of doc.links) {
    step();
    const targetUrl = optionalText(row.targetUrl);
    if (!targetUrl) {
      fail("links", row, "A link needs a URL.");
      continue;
    }
    try {
      const result = await target.createLink(targetUrl);
      if (result.__kind__ === "err") {
        fail("links", row, "The backend refused this URL.");
        continue;
      }
      created.links += 1;
    } catch (cause) {
      fail("links", row, cause);
    }
  }

  if (doc.settings) {
    step();
    const current = await target.getMySettings();
    const displayName = label(doc.settings.displayName, "");
    const studyGoal = label(doc.settings.studyGoal, "");
    const appearance = label(doc.settings.appearance, "system");
    const dailyTarget = toBigInt(doc.settings.dailyTarget);
    if (
      current &&
      current.displayName === displayName &&
      current.studyGoal === studyGoal &&
      current.appearance === appearance &&
      current.dailyTarget === dailyTarget
    ) {
      skipped.settings += 1;
    } else {
      try {
        const result = await target.saveMySettings(
          displayName,
          studyGoal,
          dailyTarget,
          appearance,
        );
        if (result.__kind__ === "err") {
          failures.push({
            entity: "settings",
            label: "Profile and appearance",
            reason: "The backend refused these settings.",
          });
        } else {
          created.settings += 1;
        }
      } catch (cause) {
        failures.push({
          entity: "settings",
          label: "Profile and appearance",
          reason: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  }

  return {
    created,
    skipped,
    notRestored: {
      sessions: doc.sessions.length,
      results: doc.results.length,
      activity: doc.activity.length,
      shares: doc.shares.length,
      noteShares: doc.noteShares.length,
    },
    failures,
  };
}

/** A daily target that survived a JSON round trip as a number or a string. */
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? BigInt(Math.floor(parsed))
    : 0n;
}
