import { safeGetItem } from "@/lib/localStore";

/**
 * The archive this browser holds from when it ran without a server.
 *
 * `src/mocks/backend.ts` writes the whole library under one key. That key is the
 * only copy a person has before the database is wired up, and the only way their
 * work reaches Postgres afterwards, so it is read here directly instead of
 * through the mock backend: a page that offers "move my data" must not pull the
 * 2 000-line localStorage implementation into the bundle of an app that is
 * already talking to a real server.
 *
 * It is also deliberately absent from `deviceCache.ts`, whose list is what
 * "Clear local data" erases. A button labelled *clear this device* must not
 * delete someone's only archive.
 */
const MOCK_ARCHIVE_KEY = "studyforge.mock-backend.v1";

export interface ArchiveTotals {
  classes: number;
  subjects: number;
  chapters: number;
  topics: number;
  questions: number;
  notes: number;
  links: number;
  sessions: number;
  results: number;
  activity: number;
}

export interface BrowserArchive {
  /** The stored document, ready for `parseArchive`. */
  text: string;
  exportedAt: string | null;
  totals: ArchiveTotals;
}

const COUNTED: Array<keyof ArchiveTotals> = [
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
];

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** A summary of the local archive, or null when this browser holds nothing. */
export function readBrowserArchive(): BrowserArchive | null {
  const text = safeGetItem(MOCK_ARCHIVE_KEY);
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // An unreadable store is `localStore`'s problem to report, not this reader's
    // to guess at: no summary, so the import offer simply does not appear.
    return null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return null;
  const doc = raw as Record<string, unknown>;
  const totals = {} as ArchiveTotals;
  for (const field of COUNTED) {
    totals[field] = count(doc[field]);
  }
  if (COUNTED.every((field) => totals[field] === 0)) return null;
  return {
    text,
    exportedAt: typeof doc.exportedAt === "string" ? doc.exportedAt : null,
    totals,
  };
}

/** Rows worth mentioning to a person deciding whether to press the button. */
export function archiveHeadline(totals: ArchiveTotals): string {
  const parts = [
    `${totals.questions} question${totals.questions === 1 ? "" : "s"}`,
    `${totals.notes} note${totals.notes === 1 ? "" : "s"}`,
    `${totals.sessions} practice session${totals.sessions === 1 ? "" : "s"}`,
  ];
  const hierarchy =
    totals.classes + totals.subjects + totals.chapters + totals.topics;
  parts.unshift(`${hierarchy} library entr${hierarchy === 1 ? "y" : "ies"}`);
  return parts.join(", ");
}
