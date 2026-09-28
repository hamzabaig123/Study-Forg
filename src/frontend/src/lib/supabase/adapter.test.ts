/**
 * The adapter's unit tests, run against a fake transport.
 *
 * There is no Postgres on this machine and no Supabase project the tests can
 * write to, which is precisely why the transport is a seam: every assumption the
 * adapter makes about a row shape, an RPC envelope or a `null`-versus-`undefined`
 * column is checked here against a stand-in that honours the same contract.
 *
 * What this cannot prove is the SQL. It proves the TypeScript half of the
 * migration — that `0001_init.sql`'s documented shapes are what the six slices
 * expect. Running the migration against the real project is task #38, and the
 * contract replay that exercises both halves together is task #36.
 */
import { webcrypto } from "node:crypto";
import type {
  AnswerData,
  DeviceType,
  ExportFormat,
  ShareTarget,
} from "@/backend";
import { QuestionType, SessionMode } from "@/backend";
import { beforeEach, describe, expect, it } from "vitest";
import { stringifyWithBigints } from "../bigintJson";
import { createSupabaseBackend } from "./supabaseBackend";
import { tokenHash } from "./tokens";
import type {
  ReadOptions,
  Row,
  SupabaseTransport,
  WriteOptions,
} from "./transport";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const iso = (ms: number): string => new Date(ms).toISOString();

interface FakeOptions {
  userId?: string | null;
  tables?: Record<string, Row[]>;
  rpcs?: Record<string, (args: Row) => unknown>;
}

/** A transport that behaves like the subset of PostgREST the adapter uses. */
class FakeTransport implements SupabaseTransport {
  readonly tables: Record<string, Row[]>;
  readonly rpcs: Record<string, (args: Row) => unknown>;
  readonly calls: { reads: string[]; writes: string[]; rpcs: string[] } = {
    reads: [],
    writes: [],
    rpcs: [],
  };
  private nextId = 1;
  /**
   * A clock that only moves forward, one millisecond per write.
   *
   * The activity list sorts by `at desc`, and a mock that stamps every write
   * with `Date.now()` produces ties the sort resolves by insertion order — so a
   * test about "most recent first" would pass or fail on the host's speed.
   */
  private clock = 1_700_000_000_000;
  private readonly user: string | null;

  constructor(options: FakeOptions = {}) {
    this.user = options.userId === undefined ? OWNER : options.userId;
    this.tables = {
      class: [],
      subject: [],
      chapter: [],
      topic: [],
      question: [],
      session: [],
      session_item: [],
      result: [],
      result_item: [],
      note: [],
      note_share: [],
      content_share: [],
      link: [],
      link_scan: [],
      activity: [],
      user_settings: [],
      ...structuredClone(options.tables ?? {}),
    };
    this.rpcs = options.rpcs ?? {};
  }

  /**
   * Add rows as the account under test owns them.
   *
   * Every seeded row gets the current `owner_id` unless the test names one, so
   * `owner_id: OTHER` is how a test puts a row in someone else's account and
   * checks that nothing here can read it.
   */
  seed(table: string, rows: Row[]): void {
    this.tables[table] = rows.map((row) => ({
      owner_id: this.user,
      ...structuredClone(row),
    }));
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  /**
   * What `owner_id = auth.uid()` leaves: this account's rows, and nothing at all
   * for a signed-out caller.
   *
   * Row level security is the database's problem, not the adapter's, but the
   * adapter is written as though every query already came back scoped — it filters
   * by id alone and never by owner. So the fake has to enforce the same rule or a
   * test could pass against an adapter that was quietly over-broad.
   */
  visible(table: string): Row[] {
    if (!this.user) {
      return [];
    }
    return this.rows(table).filter((row) => row.owner_id === this.user);
  }

  async userId(): Promise<string | null> {
    return this.user;
  }

  async read(table: string, options: ReadOptions = {}): Promise<Row[]> {
    this.calls.reads.push(table);
    let matched = this.visible(table).filter((row) => matches(row, options));
    if (options.order) {
      const column = options.order.column;
      const ascending = options.order.ascending ?? true;
      matched = matched.slice().sort((a, b) => {
        const left = a[column];
        const right = b[column];
        const delta =
          typeof left === "number" && typeof right === "number"
            ? left - right
            : String(left ?? "").localeCompare(String(right ?? ""));
        return ascending ? delta : -delta;
      });
    }
    if (options.limit !== undefined) {
      matched = matched.slice(0, options.limit);
    }
    const lookup = (foreign: string): Row[] => this.visible(foreign);
    return structuredClone(
      matched.map((row) => project(table, row, options.select ?? "*", lookup)),
    );
  }

  async write(table: string, options: WriteOptions): Promise<Row[]> {
    this.calls.writes.push(table);
    const list = this.tables[table] ?? [];
    this.tables[table] = list;
    if (options.insert !== undefined) {
      const row = this.stamp(table, { ...options.insert });
      list.push(row);
      return [structuredClone(row)];
    }
    if (options.upsert !== undefined) {
      const key = options.onConflict ?? "id";
      const existing = this.visible(table).find(
        (row) => String(row[key]) === String(options.upsert?.[key]),
      );
      if (existing) {
        Object.assign(existing, options.upsert, { updated_at: this.tick() });
        return [structuredClone(existing)];
      }
      const row = this.stamp(table, { ...options.upsert });
      list.push(row);
      return [structuredClone(row)];
    }
    const affected: Row[] = [];
    for (const row of this.visible(table)) {
      if (!matches(row, { eq: options.eq })) {
        continue;
      }
      if (options.update) {
        Object.assign(row, options.update, { updated_at: this.tick() });
        affected.push(row);
      } else if (options.remove) {
        affected.push(row);
      }
    }
    if (options.remove) {
      this.tables[table] = list.filter((row) => !affected.includes(row));
    }
    return structuredClone(affected);
  }

  async rpc(name: string, args: Row): Promise<unknown> {
    this.calls.rpcs.push(name);
    const scripted = this.rpcs[name];
    const payload = scripted ? scripted(args) : await this.simulate(name, args);
    return structuredClone(payload ?? null);
  }

  /**
   * The Postgres functions, emulated from `0001_init.sql`.
   *
   * A test that scripted every reply would only prove the adapter can read a
   * reply it wrote for itself, so the functions with real logic behind them —
   * the child counts, the revision precondition, create-or-reuse sharing, the
   * token-addressed readers — are simulated here from the SQL's own rules,
   * including its argument names and its snake_case output. A test overrides one
   * by assigning `transport.rpcs[name]`, which is how a refusal the emulation
   * cannot reach (a session that expired server-side) still gets asserted.
   */
  private async simulate(name: string, args: Row): Promise<unknown> {
    switch (name) {
      case "class_rows":
        return this.level(
          "class",
          args,
          undefined,
          "subject",
          "class_id",
          "subject_count",
        );
      case "subject_rows":
        return this.level(
          "subject",
          args,
          "class_id",
          "chapter",
          "subject_id",
          "chapter_count",
        );
      case "chapter_rows":
        return this.level(
          "chapter",
          args,
          "subject_id",
          "topic",
          "chapter_id",
          "topic_count",
        );
      case "topic_rows":
        return this.level(
          "topic",
          args,
          "chapter_id",
          "question",
          "topic_id",
          "question_count",
        );

      case "dashboard_stats":
        return {
          classCount: this.visible("class").length,
          subjectCount: this.visible("subject").length,
          chapterCount: this.visible("chapter").length,
          topicCount: this.visible("topic").length,
          questionCount: this.visible("question").length,
        };

      case "create_share":
        return this.createShare(args);

      case "create_note_share":
        return this.createNoteShare(args);
      case "shared_content":
        return this.sharedContent(String(args.p_token_hash));

      case "shared_note":
        return this.sharedNote(String(args.p_token_hash));

      case "update_note":
        return this.updateNote(args);

      case "rename_note":
        return this.renameNote(args);

      case "set_note_status":
        return this.setNoteStatus(args);

      case "attempt_history":
        return this.attemptHistory();

      case "link_detail_for_token":
      case "link_scan_stats_for_token":
      case "resolve_link":
      case "create_link":
      case "start_session":
      case "submit_answer":
      case "complete_session":
      case "analytics_breakdown":
        throw new Error(`${name} needs a scripted reply in this test`);

      default:
        throw new Error(`No fake handler for ${name}`);
    }
  }

  /**
   * `*_rows`: this account's rows at one level, plus the child count.
   *
   * `parentColumn` is the argument the SQL filters on (`p_class_id` for
   * subjects, and so on); `p_id` narrows to a single row, which is what
   * create/rename read back after a plain insert.
   */
  private level(
    table: string,
    args: Row,
    parentColumn: string | undefined,
    childTable: string,
    childForeignKey: string,
    countColumn: string,
  ): Row[] {
    const onlyId =
      args.p_id === null || args.p_id === undefined
        ? undefined
        : String(args.p_id);
    const parent =
      parentColumn === undefined ||
      args[`p_${parentColumn}`] === null ||
      args[`p_${parentColumn}`] === undefined
        ? undefined
        : String(args[`p_${parentColumn}`]);
    return this.visible(table)
      .filter((row) => onlyId === undefined || String(row.id) === onlyId)
      .filter(
        (row) =>
          parent === undefined || String(row[parentColumn ?? ""]) === parent,
      )
      .slice()
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((row) => ({
        ...row,
        [countColumn]: this.visible(childTable).filter(
          (child) => String(child[childForeignKey]) === String(row.id),
        ).length,
      }));
  }

  private async createShare(args: Row): Promise<unknown> {
    const token = String(args.p_token ?? "");
    if (!/^share_[a-z0-9]{24}$/u.test(token)) {
      throw new Error("share token does not match the expected shape");
    }
    const kind = String(args.p_scope_kind);
    const scopeId = String(args.p_scope_id);
    const table =
      kind === "topic" ? "topic" : kind === "chapter" ? "chapter" : null;
    if (
      !table ||
      !this.visible(table).some((row) => String(row.id) === scopeId)
    ) {
      return { err: "notFound" };
    }
    // `on conflict (owner_id, scope_kind, scope_id) do nothing`, then re-read.
    const existing = this.visible("content_share").find(
      (row) => row.scope_kind === kind && String(row.scope_id) === scopeId,
    );
    if (existing) {
      return { ok: existing };
    }
    const row = this.stamp("content_share", {
      scope_kind: kind,
      scope_id: Number(scopeId),
      token,
      token_hash: await tokenHash(token),
    });
    this.tables.content_share.push(row);
    return { ok: row };
  }

  private async createNoteShare(args: Row): Promise<unknown> {
    const note = this.visible("note").find(
      (row) => String(row.id) === String(args.p_note_id),
    );
    if (!note) {
      return { err: "notAuthorized" };
    }
    if (note.status !== "active") {
      return { err: "notFound" };
    }
    const token = String(args.p_token ?? "");
    if (!/^note_[a-z0-9]{24}$/u.test(token)) {
      throw new Error("share token does not match the expected shape");
    }
    const row = this.stamp("note_share", {
      note_id: Number(note.id),
      token,
      token_hash: await tokenHash(token),
    });
    this.tables.note_share.push(row);
    return { ok: row };
  }

  /** The definer readers bypass RLS, so they search by digest across accounts. */
  private sharedContent(tokenHash: string): unknown {
    const share = this.rows("content_share").find(
      (row) => row.token_hash === tokenHash,
    );
    if (!share) {
      return null;
    }
    const scopeId = String(share.scope_id);
    const questions =
      share.scope_kind === "topic"
        ? this.rows("question").filter((q) => String(q.topic_id) === scopeId)
        : this.rows("question").filter((q) => {
            const topic = this.rows("topic").find(
              (t) => String(t.id) === String(q.topic_id),
            );
            return String(topic?.chapter_id) === scopeId;
          });
    const label =
      share.scope_kind === "topic"
        ? this.rows("topic").find((row) => String(row.id) === scopeId)
        : this.rows("chapter").find((row) => String(row.id) === scopeId);
    if (!label) {
      this.tables.content_share = this.rows("content_share").filter(
        (row) => row !== share,
      );
      return null;
    }
    return {
      title: label.name,
      breadcrumb: [],
      questions: questions
        .slice()
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((row) => ({
          id: row.id,
          questionType: row.question_type,
          prompt: row.prompt,
          options:
            (row.answer as { multipleChoice?: { options?: unknown } })
              ?.multipleChoice?.options ?? [],
        })),
    };
  }

  private sharedNote(tokenHash: string): unknown {
    const share = this.rows("note_share").find(
      (row) => row.token_hash === tokenHash,
    );
    if (!share) {
      return null;
    }
    const note = this.rows("note").find(
      (row) =>
        String(row.id) === String(share.note_id) && row.status === "active",
    );
    if (!note) {
      this.tables.note_share = this.rows("note_share").filter(
        (row) => row !== share,
      );
      return null;
    }
    return {
      title: note.title,
      documentJson: note.document_json,
      revision: note.revision,
      updatedAt: note.updated_at,
    };
  }

  private findNote(noteId: unknown): Row | undefined {
    return this.visible("note").find(
      (row) => String(row.id) === String(noteId),
    );
  }

  private updateNote(args: Row): unknown {
    const note = this.findNote(args.p_id);
    if (!note) {
      return { err: "notFound" };
    }
    const expected = Number(args.p_expected_revision);
    if (Number(note.revision) !== expected) {
      return {
        err: { staleRevision: { expected, actual: Number(note.revision) } },
      };
    }
    Object.assign(note, {
      title: args.p_title,
      subject_label: trimOrNull(args.p_subject_label),
      chapter_label: trimOrNull(args.p_chapter_label),
      topic_label: trimOrNull(args.p_topic_label),
      document_json: args.p_document_json,
      search_text: args.p_search_text ?? "",
      revision: Number(note.revision) + 1,
      updated_at: this.tick(),
    });
    this.recordActivity("note", `Updated the note ${String(args.p_title)}`);
    return { ok: note };
  }

  private renameNote(args: Row): unknown {
    const note = this.findNote(args.p_id);
    if (!note) {
      return { err: "notFound" };
    }
    Object.assign(note, {
      title: args.p_title,
      revision: Number(note.revision) + 1,
      updated_at: this.tick(),
    });
    this.recordActivity("note", `Renamed a note to ${String(args.p_title)}`);
    return { ok: note };
  }

  private setNoteStatus(args: Row): unknown {
    const status = String(args.p_status);
    if (status !== "active" && status !== "trashed") {
      return { err: { invalidInput: "Unknown note status." } };
    }
    const note = this.findNote(args.p_id);
    if (!note) {
      return { err: "notFound" };
    }
    Object.assign(note, {
      status,
      deleted_at: status === "trashed" ? this.tick() : null,
      revision: Number(note.revision) + 1,
      updated_at: this.tick(),
    });
    return { ok: note };
  }

  /**
   * `attempt_history()`: one entry per recorded result, newest first, and only
   * while its scope still exists — the same lateral join the SQL does, with the
   * live row's name so a rename shows up in old attempts.
   */
  private attemptHistory(): Row[] {
    const rows: Row[] = [];
    for (const result of this.visible("result")) {
      const table = result.scope_kind === "topic" ? "topic" : "chapter";
      const live = this.visible(table).find(
        (row) => String(row.id) === String(result.scope_id),
      );
      if (!live) {
        continue;
      }
      rows.push({
        id: result.session_id,
        mode: result.mode,
        scopeKind: result.scope_kind,
        scopeId: result.scope_id,
        scopeLabel: live.name ?? result.scope_label,
        completedAt: result.completed_at,
        score: result.score,
        total: result.total,
      });
    }
    return rows.sort(
      (a, b) =>
        Date.parse(String(b.completedAt)) - Date.parse(String(a.completedAt)),
    );
  }

  private recordActivity(kind: string, title: string): void {
    const row = this.stamp("activity", { kind, title });
    this.tables.activity.unshift(row);
  }

  private tick(): string {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }

  /** Identity, ownership and the two timestamp defaults the schema carries. */
  private stamp(table: string, row: Row): Row {
    const at = this.tick();
    const stored: Row = { ...(DEFAULTS[table] ?? {}), ...row };
    if (table !== "user_settings") {
      if (stored.id === undefined) {
        stored.id = this.nextId;
        this.nextId += 1;
      }
    }
    if (
      this.user &&
      stored.owner_id === undefined &&
      table !== "abuse_report"
    ) {
      stored.owner_id = this.user;
    }
    for (const column of AUTO_TIMESTAMPS[table] ?? []) {
      if (stored[column] === undefined) {
        stored[column] = at;
      }
    }
    return stored;
  }
}

/**
 * The `default now()` columns of each table, read off the migration.
 *
 * Worth spelling out because the adapter treats a missing timestamp as a bug
 * rather than a null: `toStamp` throws on `undefined`, and a row that reached the
 * app without `updated_at` is a row the app cannot render.
 */
const AUTO_TIMESTAMPS: Record<string, string[]> = {
  class: ["created_at", "updated_at"],
  subject: ["created_at", "updated_at"],
  chapter: ["created_at", "updated_at"],
  topic: ["created_at", "updated_at"],
  question: ["created_at", "updated_at"],
  session: ["started_at"],
  session_item: [],
  result: ["started_at", "completed_at"],
  result_item: [],
  note: ["created_at", "updated_at"],
  note_share: ["created_at"],
  content_share: ["created_at"],
  link: ["created_at", "updated_at"],
  link_scan: ["at"],
  activity: ["at"],
  user_settings: ["updated_at"],
};

/** The `not null default` value columns, likewise. */
const DEFAULTS: Record<string, Row> = {
  note: { status: "active", search_text: "", revision: 1, deleted_at: null },
  link: { status: "active", abuse_count: 0 },
  session_item: { options: [], submitted: null, correct: null },
  user_settings: { study_goal: "", daily_target: 1, appearance: "light" },
};

/**
 * Foreign keys the fake follows for an embedded `select`.
 *
 * PostgREST reads these off the schema; here the three one-to-one hops the
 * adapter actually asks for are listed, because an invented general resolver
 * would be more code than the four paths that use it.
 */
const EMBEDS: Record<string, Record<string, string>> = {
  topic: { chapter: "chapter_id" },
  chapter: { subject: "subject_id" },
  subject: { class: "class_id" },
};

/**
 * Apply a `select` to a row, following `alias:table(cols)` embeds.
 *
 * The default `*` returns the row whole, which is what every other read in the
 * adapter wants; only `getTopicPath` asks for a projection, and it asks for one
 * precisely so that the breadcrumb costs a single round trip.
 */
function project(
  table: string,
  row: Row,
  select: string,
  lookup: (foreign: string) => Row[],
): Row {
  if (select === "*") {
    return row;
  }
  const out: Row = {};
  for (const item of splitTopLevel(select)) {
    const embed = /^(\w+):(\w+)\((.+)\)$/u.exec(item);
    if (!embed) {
      if (row[item] !== undefined) {
        out[item] = row[item];
      }
      continue;
    }
    const [, alias, foreign, inner] = embed;
    const key = EMBEDS[table]?.[alias];
    const parentValue = key === undefined ? undefined : row[key];
    const target =
      parentValue === undefined
        ? undefined
        : lookup(foreign).find(
            (candidate) => String(candidate.id) === String(parentValue),
          );
    out[alias] = target ? project(foreign, target, inner, lookup) : null;
  }
  return out;
}

/** Column names at depth zero, so a nested `chapter(...)` stays one item. */ function splitTopLevel(
  select: string,
): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of select) {
    if (char === "(") {
      depth += 1;
    }
    if (char === ")") {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    items.push(current.trim());
  }
  return items;
}

function matches(row: Row, options: ReadOptions): boolean {
  for (const [column, value] of Object.entries(options.eq ?? {})) {
    if (String(row[column]) !== String(value)) {
      return false;
    }
  }
  for (const column of options.isNull ?? []) {
    if (row[column] !== null && row[column] !== undefined) {
      return false;
    }
  }
  for (const column of options.notNull ?? []) {
    if (row[column] === null || row[column] === undefined) {
      return false;
    }
  }
  const contains = options.contains;
  if (contains && contains.columns.length > 0) {
    // Same rule as `literal()` in the transport: the term is matched as text,
    // case-insensitively, and PostgREST's two accidental wildcards are dropped.
    const needle = contains.term.replace(/[%_]/gu, "").toLowerCase();
    const hit = contains.columns.some((column) =>
      String(row[column] ?? "")
        .toLowerCase()
        .includes(needle),
    );
    if (!hit) {
      return false;
    }
  }
  return true;
}

/** `nullif(btrim(coalesce(x, '')), '')`, which is how the SQL stores a label. */
function trimOrNull(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function mcq(correctIndex = 0): AnswerData {
  return {
    __kind__: "multipleChoice",
    multipleChoice: {
      options: [
        { id: 1n, text: "Alpha" },
        { id: 2n, text: "Beta" },
      ],
      correctOptionId: BigInt(correctIndex + 1),
    },
  };
}

let transport: FakeTransport;
let backend: ReturnType<typeof createSupabaseBackend>;

beforeEach(() => {
  transport = new FakeTransport();
  backend = createSupabaseBackend(transport);
});

describe("hierarchy", () => {
  it("creates through the count-carrying row functions, not a bare insert", async () => {
    const created = await backend.createClass("Physics", "  Year 11  ");
    expect(created).toMatchObject({
      name: "Physics",
      description: "Year 11",
      subjectCount: 0n,
    });
    expect(created.id).toBeTypeOf("bigint");
    expect(created.createdAt).toBeTypeOf("bigint");
    expect(String(created.createdAt)).toHaveLength(19); // nanoseconds, as the canister had it

    const subject = await backend.createSubject(created.id, "Mechanics", null);
    expect(subject?.chapterCount).toBe(0n);
    expect((await backend.getClass(created.id))?.subjects).toHaveLength(1);
    // the parent's count came back from `class_rows`, not from the insert reply
    expect((await backend.listClasses())[0].subjectCount).toBe(1n);
    expect(transport.calls.rpcs).toContain("class_rows");
  });

  it("answers null for a parent the caller cannot see", async () => {
    expect(await backend.createSubject(999n, "Orphan", null)).toBeNull();
    expect(await backend.createTopic(999n, "Orphan", null)).toBeNull();
    expect(
      await backend.createQuestion(
        999n,
        "Why?",
        QuestionType.shortAnswer,
        {
          __kind__: "shortAnswer",
          shortAnswer: { expected: "because" },
        },
        null,
      ),
    ).toBeNull();
  });

  it("records who did what", async () => {
    const created = await backend.createClass("Chemistry", null);
    await backend.createSubject(created.id, "Bonding", null);
    const activity = await backend.getRecentActivity(10n);
    expect(activity.map((item) => item.title)).toEqual([
      'Created subject "Bonding"',
      'Created class "Chemistry"',
    ]);
    expect(await backend.getRecentActivity(0n)).toEqual([]);
    expect(activity[0].at).toBeTypeOf("bigint");
  });

  it("walks the breadcrumb through the nested embed", async () => {
    const classRow = await backend.createClass("Physics", null);
    const subject = (await backend.createSubject(
      classRow.id,
      "Mechanics",
      null,
    ))!;
    const chapter = (await backend.createChapter(
      subject.id,
      "Kinematics",
      null,
    ))!;
    const topic = (await backend.createTopic(chapter.id, "Projectiles", null))!;

    const path = await backend.getTopicPath(topic.id);
    // One read for four levels: the embed is the whole point of `getTopicPath`.
    expect(
      transport.calls.reads.filter((table) => table === "topic"),
    ).toHaveLength(1);
    expect(path).toEqual({
      class: { id: classRow.id, name: "Physics" },
      subject: { id: subject.id, name: "Mechanics" },
      chapter: { id: chapter.id, name: "Kinematics" },
      topic: { id: topic.id, name: "Projectiles" },
    });
    expect(await backend.getTopicPath(9999n)).toBeNull();
  });

  it("deletes the share links that pointed at deleted content", async () => {
    transport.seed("content_share", [
      {
        id: 1,
        scope_kind: "topic",
        scope_id: 7,
        token: "share_a",
        created_at: iso(1),
      },
      {
        id: 2,
        scope_kind: "chapter",
        scope_id: 3,
        token: "share_b",
        created_at: iso(2),
      },
    ]);
    transport.seed("topic", [
      {
        id: 7,
        chapter_id: 3,
        name: "Gone",
        created_at: iso(1),
        updated_at: iso(1),
      },
    ]);
    transport.seed("chapter", [
      {
        id: 3,
        subject_id: 2,
        name: "Chapter",
        created_at: iso(1),
        updated_at: iso(1),
      },
    ]);
    expect(await backend.deleteTopic(7n)).toBe(true);
    expect(transport.rows("content_share").map((row) => row.token)).toEqual([
      "share_b",
    ]);
    expect(await backend.deleteTopic(7n)).toBe(false);
  });
});

describe("sessions", () => {
  it("turns start_session's id reply back into a full session view", async () => {
    transport.seed("session", [
      {
        id: 41,
        mode: "practice",
        scope_kind: "topic",
        scope_id: 7,
        scope_label: "Projectiles",
        started_at: iso(1_700_000_000_000),
        expires_at: null,
        duration_seconds: null,
      },
    ]);
    transport.seed("session_item", [
      {
        id: 1,
        session_id: 41,
        position: 1,
        question_id: 5,
        prompt: "Second",
        question_type: "trueFalse",
        options: [],
        answer: { __kind__: "trueFalse", trueFalse: { correct: true } },
      },
      {
        id: 2,
        session_id: 41,
        position: 0,
        question_id: 4,
        prompt: "First",
        question_type: "multipleChoice",
        options: [{ id: 1n, text: "Alpha" }],
        answer: mcq(),
      },
    ]);
    transport.rpcs.start_session = () => ({ ok: 41 });

    const started = await backend.startSession({
      mode: SessionMode.practice,
      scope: { __kind__: "topic", topic: 7n },
    });
    expect(started.__kind__).toBe("ok");
    if (started.__kind__ !== "ok") return;
    expect(started.ok.id).toBe(41n);
    expect(started.ok.scopeLabel).toBe("Projectiles");
    expect(started.ok.durationSeconds).toBeUndefined();
    expect(started.ok.expiresAt).toBeUndefined();
    // assembled by getSession, in position order, so the two can never drift
    expect(started.ok.questions.map((question) => question.prompt)).toEqual([
      "First",
      "Second",
    ]);
    expect(
      transport.calls.reads.filter((table) => table === "session_item"),
    ).toHaveLength(1);
  });

  it("passes start_session's refusals through as the matching error case", async () => {
    transport.rpcs.start_session = () => ({ err: { noQuestions: null } });
    expect(
      await backend.startSession({
        mode: SessionMode.practice,
        scope: { __kind__: "topic", topic: 7n },
      }),
    ).toEqual({
      __kind__: "err",
      err: { __kind__: "noQuestions", noQuestions: null },
    });

    transport.rpcs.start_session = () => ({
      err: { invalidInput: "durationSeconds is required for a timed test" },
    });
    expect(
      await backend.startSession({
        mode: SessionMode.timedTest,
        scope: { __kind__: "chapter", chapter: 3n },
      }),
    ).toEqual({
      __kind__: "err",
      err: {
        __kind__: "invalidInput",
        invalidInput: "durationSeconds is required for a timed test",
      },
    });
  });

  it("sends a bigint duration as a string, never as a JSON bigint", async () => {
    let seen: Row = {};
    transport.rpcs.start_session = (args) => {
      seen = args;
      return { err: { notFound: null } };
    };
    await backend.startSession({
      mode: SessionMode.timedTest,
      scope: { __kind__: "topic", topic: 7n },
      durationSeconds: 600n,
      questionCount: 10n,
    });
    expect(seen).toMatchObject({
      p_duration_seconds: "600",
      p_question_count: "10",
    });
    expect(() => JSON.stringify(seen)).not.toThrow();
  });

  it("grades through submit_answer and hands back the feedback", async () => {
    transport.rpcs.submit_answer = () => ({
      ok: { correct: true, correctAnswer: mcq(), explanation: "Because." },
    });
    const feedback = await backend.submitAnswer({
      sessionId: 41n,
      questionId: 5n,
      answer: {
        __kind__: "multipleChoice",
        multipleChoice: { optionId: 1n },
      },
    });
    expect(feedback).toMatchObject({
      __kind__: "ok",
      ok: { correct: true, explanation: "Because." },
    });
  });

  it("completes by id and then reads the result it just wrote", async () => {
    transport.rpcs.complete_session = () => ({ ok: 41 });
    transport.seed("result", [
      {
        id: 61,
        session_id: 41,
        mode: "timedTest",
        scope_kind: "topic",
        scope_id: 7,
        scope_label: "Projectiles",
        started_at: iso(1),
        completed_at: iso(2),
        score: 1,
        total: 2,
      },
    ]);
    transport.seed("result_item", [
      {
        id: 1,
        result_id: 61,
        position: 0,
        question_id: 4,
        prompt: "First",
        question_type: "trueFalse",
        correct_answer: {
          __kind__: "trueFalse",
          trueFalse: { correct: false },
        },
        submitted: { __kind__: "trueFalse", trueFalse: { value: true } },
        correct: false,
      },
      {
        id: 2,
        result_id: 61,
        position: 1,
        question_id: 5,
        prompt: "Second",
        question_type: "shortAnswer",
        correct_answer: {
          __kind__: "shortAnswer",
          shortAnswer: { expected: "42" },
        },
        submitted: null,
        correct: true,
      },
    ]);
    transport.seed("topic", [{ id: 7, chapter_id: 3, name: "Projectiles" }]);

    const completed = await backend.completeSession(41n);
    expect(completed.__kind__).toBe("ok");
    if (completed.__kind__ !== "ok") return;
    expect(completed.ok).toMatchObject({ id: 41n, score: 1n, total: 2n });
    expect(completed.ok.results.map((row) => row.questionId)).toEqual([4n, 5n]);
    // an unanswered item keeps its place in the total with no `submitted` key
    expect(completed.ok.results[1].submitted).toBeUndefined();
    expect(completed.ok.results[0].submitted?.__kind__).toBe("trueFalse");
  });

  it("reports notFound when the session row is already gone", async () => {
    transport.rpcs.complete_session = () => ({ err: { notFound: null } });
    expect(await backend.completeSession(41n)).toEqual({
      __kind__: "err",
      err: { __kind__: "notFound", notFound: null },
    });
  });

  it("hides a result whose scope was deleted", async () => {
    transport.seed("result", [
      {
        id: 61,
        session_id: 41,
        mode: "practice",
        scope_kind: "chapter",
        scope_id: 3,
        scope_label: "Gone",
        started_at: iso(1),
        completed_at: iso(2),
        score: 0,
        total: 1,
      },
    ]);
    expect(await backend.getSessionResult(41n)).toBeNull();
    expect(await backend.getAttemptHistory()).toEqual([]);
  });
});

describe("analytics", () => {
  it("passes the dashboard counters straight through", async () => {
    transport.rpcs.dashboard_stats = () => ({
      classCount: 2,
      subjectCount: 3,
      chapterCount: 4,
      topicCount: 5,
      questionCount: 6,
    });
    expect(await backend.getDashboardStats()).toEqual({
      classCount: 2n,
      subjectCount: 3n,
      chapterCount: 4n,
      topicCount: 5n,
      questionCount: 6n,
    });
  });

  it("keeps the three accuracy breakdowns separate", async () => {
    transport.rpcs.analytics_breakdown = () => ({
      byClass: [
        { bucketLabel: "Physics", total: 4, correct: 3, accuracyPercent: 75 },
      ],
      bySubject: [],
      byQuestionType: [
        {
          bucketLabel: "Multiple choice",
          total: 2,
          correct: 1,
          accuracyPercent: 50,
        },
      ],
    });
    const breakdown = await backend.getAnalyticsBreakdown();
    expect(breakdown.byClass[0]).toMatchObject({
      bucketLabel: "Physics",
      total: 4n,
      accuracyPercent: 75,
    });
    expect(breakdown.bySubject).toEqual([]);
    expect(breakdown.byQuestionType[0]?.correct).toBe(1n);
  });

  it("reads attempt history in the RPC's own camelCase", async () => {
    transport.rpcs.attempt_history = () => [
      {
        id: 61,
        mode: "timedTest",
        scopeKind: "topic",
        scopeId: 7,
        scopeLabel: "Projectiles",
        completedAt: iso(1_700_000_000_000),
        score: 3,
        total: 5,
      },
    ];
    expect(await backend.getAttemptHistory()).toEqual([
      {
        id: 61n,
        completedAt: 1_700_000_000_000_000_000n,
        total: 5n,
        mode: SessionMode.timedTest,
        scopeLabel: "Projectiles",
        score: 3n,
      },
    ]);
  });
});

describe("notes", () => {
  it("stores the document as text and reports a stale revision", async () => {
    const created = await backend.createNote(
      "Scalars",
      " Physics ",
      null,
      "",
      '{"v":1}',
      "dot product",
    );
    expect(created.subjectLabel).toBe("Physics");
    expect(created.chapterLabel).toBeUndefined();
    expect(created.revision).toBe(1n);
    expect(transport.rows("note")[0].document_json).toBe('{"v":1}');

    transport.rpcs.update_note = () => ({
      err: { staleRevision: { expected: 4, actual: 9 } },
    });
    const stale = await backend.updateNote(
      created.id,
      "Scalars",
      null,
      null,
      null,
      '{"v":2}',
      "x",
      4n,
    );
    expect(stale).toEqual({
      __kind__: "err",
      err: {
        __kind__: "staleRevision",
        staleRevision: { expected: 4n, actual: 9n },
      },
    });
  });

  it("searches title and body with one filtered read", async () => {
    transport.seed("note", [
      {
        id: 1,
        title: "Vectors",
        search_text: "dot product",
        status: "active",
        revision: 1,
        document_json: "{}",
        deleted_at: null,
        created_at: iso(1),
        updated_at: iso(5),
      },
      {
        id: 2,
        title: "Optics",
        search_text: "refraction",
        status: "active",
        revision: 1,
        document_json: "{}",
        deleted_at: null,
        created_at: iso(1),
        updated_at: iso(9),
      },
      {
        id: 3,
        title: "Vectors old",
        search_text: "cross",
        status: "trashed",
        revision: 4,
        document_json: "{}",
        deleted_at: iso(3),
        created_at: iso(1),
        updated_at: iso(3),
      },
    ]);
    const spy = transport.read.bind(transport);
    let seen: ReadOptions | undefined;
    transport.read = async (table, options) => {
      if (table === "note") seen = options;
      return spy(table, options);
    };

    const hits = await backend.listNotes("  DOT  ");
    // One read, filtered server-side: the trim survives, the term reaches both columns.
    expect(seen).toMatchObject({
      eq: { status: "active" },
      contains: { columns: ["title", "search_text"], term: "DOT" },
      order: { column: "updated_at", ascending: false },
    });
    expect(hits.map((note) => note.id)).toEqual([1n]);

    const everything = await backend.listNotes(null);
    expect(everything.map((note) => note.id)).toEqual([2n, 1n]);
    expect(seen).not.toHaveProperty("contains");
    // a trashed note is not in either list, and appears only in its own
    expect(await backend.listTrashedNotes()).toEqual([
      expect.objectContaining({ id: 3n, status: "trashed", revision: 4n }),
    ]);
  });

  it("moves notes to the bin and back through the status function", async () => {
    transport.seed("note", [
      {
        id: 1,
        title: "Vectors",
        status: "active",
        revision: 2,
        document_json: "{}",
        deleted_at: null,
        created_at: iso(1),
        updated_at: iso(1),
      },
    ]);
    const trashed = await backend.softDeleteNote(1n);
    expect(trashed).toMatchObject({
      __kind__: "ok",
      ok: { status: "trashed", revision: 3n },
    });
    expect((trashed as { ok: { deletedAt: bigint } }).ok.deletedAt).toBeTypeOf(
      "bigint",
    );
    // the row itself moved, so a second reader sees the bin, not the note
    expect(transport.rows("note")[0]).toMatchObject({
      status: "trashed",
      revision: 3,
    });
    expect(await backend.listNotes(null)).toEqual([]);
    expect(await backend.listTrashedNotes()).toHaveLength(1);

    const restored = await backend.restoreNote(1n);
    expect(restored).toMatchObject({
      __kind__: "ok",
      ok: { status: "active", revision: 4n },
    });
    expect(
      (restored as { ok: { deletedAt?: bigint } }).ok.deletedAt,
    ).toBeUndefined();
  });

  it("purges a note and lets the foreign key take its shares", async () => {
    transport.seed("note", [
      {
        id: 1,
        title: "Vectors",
        status: "active",
        revision: 1,
        document_json: "{}",
      },
    ]);
    expect(await backend.permanentlyDeleteNote(1n)).toEqual({
      __kind__: "ok",
      ok: null,
    });
    expect(await backend.permanentlyDeleteNote(1n)).toEqual({
      __kind__: "err",
      err: { __kind__: "notFound", notFound: null },
    });
  });
});

describe("sharing and links", () => {
  const target: ShareTarget = { __kind__: "topic", topic: 7n };

  beforeEach(() => {
    // `createShare` resolves the scope before it mints a token, so the activity
    // line names the right topic and a foreign id is refused with `notFound`.
    transport.seed("topic", [
      {
        id: 7,
        chapter_id: 3,
        name: "Projectiles",
        created_at: iso(1),
        updated_at: iso(1),
      },
    ]);
  });

  it("reuses the owner's share for the same scope", async () => {
    transport.rpcs.create_share = () => ({
      ok: {
        id: 1,
        scope_kind: "topic",
        scope_id: 7,
        token: "share_abc",
        created_at: iso(4),
      },
    });
    const share = await backend.createShare(target);
    expect(share).toEqual({
      __kind__: "ok",
      ok: {
        token: "share_abc",
        createdAt: 4_000_000n,
        target: { __kind__: "topic", topic: 7n },
      },
    });
  });

  it("asks create_share for a token in the shape the column checks", async () => {
    let token = "";
    transport.rpcs.create_share = (args) => {
      token = String(args.p_token);
      return {
        ok: { scope_kind: "topic", scope_id: 7, token, created_at: iso(4) },
      };
    };
    await backend.createShare(target);
    expect(token).toMatch(/^share_[a-z0-9]{24}$/u);
  });

  it("names the note share's two refusals differently", async () => {
    transport.rpcs.create_note_share = () => ({ err: "notAuthorized" });
    expect(await backend.createNoteShare(1n)).toEqual({
      __kind__: "err",
      err: "notAuthorized",
    });
    transport.rpcs.create_note_share = () => ({ err: "notFound" });
    expect(await backend.createNoteShare(1n)).toEqual({
      __kind__: "err",
      err: "notFound",
    });
  });

  it("looks a shared document up by digest, never by plaintext", async () => {
    let hashed = "";
    transport.rpcs.shared_note = (args) => {
      hashed = String(args.p_token_hash);
      return {
        title: "Vectors",
        documentJson: "{}",
        revision: 3,
        updatedAt: iso(9),
      };
    };
    const note = await backend.getSharedNote("note_abcdefghijklmnopqrstuvwx");
    expect(hashed).toMatch(/^[a-f0-9]{64}$/u);
    expect(note).toEqual({
      title: "Vectors",
      documentJson: "{}",
      revision: 3n,
      updatedAt: 9_000_000n,
    });
  });

  it("resolves a share the owner created, by digest all the way through", async () => {
    const note = await backend.createNote(
      "Vectors",
      "Physics",
      null,
      null,
      '{"v":1}',
      "dot",
    );
    const share = await backend.createNoteShare(note.id);
    if (share.__kind__ !== "ok") throw new Error("should share the note");
    // The plaintext is what the owner gets back once, and what the row stores
    // alongside its digest — the reader is asked for the digest.
    expect(transport.rows("note_share")[0].token).toBe(share.ok.token);
    expect(transport.rows("note_share")[0].token_hash).toBe(
      await tokenHash(share.ok.token),
    );
    expect(await backend.getSharedNote(share.ok.token)).toEqual({
      documentJson: '{"v":1}',
      title: "Vectors",
      revision: 1n,
      updatedAt: note.updatedAt,
    });

    // Trash stops the share, and `shared_note()` deletes the dead row rather
    // than serving an empty shell — the mock's rule, in the function.
    await backend.softDeleteNote(note.id);
    expect(await backend.getSharedNote(share.ok.token)).toBeNull();
    expect(transport.rows("note_share")).toEqual([]);
    expect(
      await backend.getSharedNote("note_abcdefghijklmnopqrstuvwx"),
    ).toBeNull();
  });

  it("returns a question sheet with no answers on it", async () => {
    transport.rpcs.shared_content = () => ({
      title: "Projectiles",
      breadcrumb: [{ id: 1, name: "Physics" }],
      questions: [
        {
          id: 4,
          questionType: "multipleChoice",
          prompt: "Which one?",
          options: [{ id: 1n, text: "Alpha" }],
        },
      ],
    });
    const content = await backend.getSharedContent(
      "share_abcdefghijklmnopqrstuvwx",
    );
    expect(content).toEqual({
      title: "Projectiles",
      breadcrumb: [{ id: 1n, name: "Physics" }],
      questions: [
        {
          id: 4n,
          questionType: QuestionType.multipleChoice,
          prompt: "Which one?",
          options: [{ id: 1n, text: "Alpha" }],
        },
      ],
    });
    // The share is a question sheet, not a mark scheme: `shared_content()` has no
    // answer or explanation column to leak, and neither may the adapter.
    expect(stringifyWithBigints(content)).not.toMatch(/correct|explanation/iu);
  });

  it("creates a link by generated code and token, retrying a taken code", async () => {
    let attempts = 0;
    transport.rpcs.create_link = () => {
      attempts += 1;
      if (attempts === 1) return { err: "codeTaken" };
      return {
        ok: {
          id: 8,
          status: "active",
          code: "abc2345",
          targetUrl: "https://example.com/notes",
          shortUrl: "/r/abc2345",
          manageUrl: "/manage/xyz",
          editToken: "xyz",
          createdAt: iso(5),
          updatedAt: iso(5),
        },
      };
    };
    const created = await backend.createLink("https://example.com/notes");
    expect(attempts).toBe(2);
    expect(created).toMatchObject({
      __kind__: "ok",
      ok: { code: "abc2345", editToken: "xyz", shortUrl: "/r/abc2345" },
    });
    expect((created as { ok: { createdAt: bigint } }).ok.createdAt).toBeTypeOf(
      "bigint",
    );
  });

  it("gives up with rateLimited after three collisions", async () => {
    transport.rpcs.create_link = () => ({ err: "codeTaken" });
    expect(await backend.createLink("https://example.com")).toEqual({
      __kind__: "err",
      err: { __kind__: "rateLimited", rateLimited: null },
    });
    expect(
      transport.calls.rpcs.filter((name) => name === "create_link"),
    ).toHaveLength(3);
  });

  it("keeps an invalid URL as an invalid URL", async () => {
    transport.rpcs.create_link = () => ({
      err: { invalidUrl: "Only http and https links are allowed." },
    });
    expect(await backend.createLink("ftp://example.com")).toEqual({
      __kind__: "err",
      err: {
        __kind__: "invalidUrl",
        invalidUrl: "Only http and https links are allowed.",
      },
    });
    expect(
      transport.calls.rpcs.filter((name) => name === "create_link"),
    ).toHaveLength(1);
  });

  it("maps a resolve failure onto the reason the link is unavailable", async () => {
    transport.rpcs.resolve_link = () => ({ unavailable: "paused" });
    expect(
      await backend.resolveCode("abc2345", "mobile" as DeviceType, null),
    ).toEqual({ __kind__: "unavailable", unavailable: "paused" });
    transport.rpcs.resolve_link = () => ({
      targetUrl: "https://example.com/x",
    });
    expect(
      await backend.resolveCode("abc2345", "mobile" as DeviceType, "PK"),
    ).toEqual({
      __kind__: "redirect",
      redirect: { targetUrl: "https://example.com/x" },
    });
  });

  it("manages a link with the token digest in every call", async () => {
    const seen: string[] = [];
    const reply = {
      id: 8,
      status: "paused",
      code: "abc2345",
      targetUrl: "https://example.com",
      shortUrl: "/r/abc2345",
      createdAt: iso(5),
      updatedAt: iso(6),
    };
    transport.rpcs.link_set_paused = (args) => {
      seen.push(String(args.p_token_hash));
      return { ok: reply };
    };
    transport.rpcs.link_detail_for_token = () => reply;
    const paused = await backend.setPaused("secret-token", true);
    expect(paused).toMatchObject({ __kind__: "ok", ok: { status: "paused" } });
    expect(seen[0]).toMatch(/^[a-f0-9]{64}$/u);
    expect(seen[0]).not.toContain("secret");
    expect(await backend.getLinkByToken("secret-token")).toMatchObject({
      code: "abc2345",
    });
  });
});

describe("export and settings", () => {
  it("produces the same CSV bytes the mock produces", async () => {
    transport.rpcs.topic_rows = () => [
      {
        id: 7,
        chapter_id: 3,
        name: "Projectiles",
        created_at: iso(1),
        updated_at: iso(1),
      },
    ];
    transport.seed("question", [
      {
        id: 4,
        topic_id: 7,
        prompt: 'He said "hi", then left',
        question_type: "multipleChoice",
        answer: mcq(1),
        explanation: "Because.\nSecond line",
        created_at: iso(1),
        updated_at: iso(1),
      },
    ]);
    const result = await backend.exportContent(
      { __kind__: "topic", topic: 7n },
      "csv" as ExportFormat,
    );
    expect(result.__kind__).toBe("ok");
    if (result.__kind__ !== "ok") return;
    expect(result.ok.mimeType).toBe("text/csv");
    expect(result.ok.filename).toBe("Projectiles.csv");
    expect(result.ok.content.split("\r\n")[1]).toBe(
      '"He said ""hi"", then left","multipleChoice","A) Alpha | B) Beta","B) Beta","Because. Second line"',
    );
  });

  it("refuses an empty or missing export target", async () => {
    transport.rpcs.topic_rows = () => [];
    expect(
      await backend.exportContent(
        { __kind__: "topic", topic: 7n },
        "csv" as ExportFormat,
      ),
    ).toEqual({
      __kind__: "err",
      err: "notFound",
    });
    transport.rpcs.topic_rows = () => [{ id: 7, name: "Projectiles" }];
    expect(
      await backend.exportContent(
        { __kind__: "topic", topic: 7n },
        "pdf" as ExportFormat,
      ),
    ).toEqual({
      __kind__: "err",
      err: "empty",
    });
  });

  it("validates a profile before the constraint has to", async () => {
    const cases: [string, string, bigint, string, string][] = [
      ["   ", "goal", 5n, "light", "Display name is required"],
      ["x".repeat(81), "goal", 5n, "light", "at most 80"],
      ["name", "y".repeat(281), 5n, "light", "at most 280"],
      ["name", "goal", 0n, "light", "at least 1"],
      ["name", "goal", 1001n, "light", "at most 1000"],
      ["name", "goal", 5n, "system", "light, dark, frosted, maroon"],
    ];
    for (const [
      displayName,
      studyGoal,
      dailyTarget,
      appearance,
      message,
    ] of cases) {
      const saved = await backend.saveMySettings(
        displayName,
        studyGoal,
        dailyTarget,
        appearance,
      );
      expect(saved.__kind__).toBe("err");
      if (saved.__kind__ === "err") {
        expect(saved.err).toMatchObject({ __kind__: "invalidInput" });
        if (saved.err.__kind__ === "invalidInput") {
          expect(saved.err.invalidInput).toContain(message);
        }
      }
    }
    expect(transport.rows("user_settings")).toEqual([]);
  });

  it("upserts settings so the first save and the tenth are the same call", async () => {
    const first = await backend.saveMySettings(
      "Hamza",
      "Pass the exam",
      25n,
      "Frosted",
    );
    expect(first).toMatchObject({
      __kind__: "ok",
      ok: { displayName: "Hamza", dailyTarget: 25n, appearance: "frosted" },
    });
    const second = await backend.saveMySettings("Hamza B", "", 30n, "dark");
    expect(second.__kind__).toBe("ok");
    expect(transport.rows("user_settings")).toHaveLength(1);
    expect((await backend.getMySettings())?.displayName).toBe("Hamza B");
  });

  it("exports the account through the view shapes, not the tables", async () => {
    const classRow = await backend.createClass("Physics", null);
    const note = await backend.createNote(
      "Vectors",
      "Physics",
      null,
      null,
      '{"v":1}',
      "dot",
    );
    const share = await backend.createNoteShare(note.id);
    if (share.__kind__ !== "ok") throw new Error("should share the note");
    const dump = await backend.exportMyData();
    expect(dump).toMatchObject({
      mimeType: "application/json",
      filename: "studydesk-export.json",
    });
    const parsed = JSON.parse(dump.content) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([
      "exportedAt",
      "classes",
      "subjects",
      "chapters",
      "topics",
      "questions",
      "notes",
      "noteShares",
      "shares",
      "links",
      "sessions",
      "results",
      "settings",
      "activity",
    ]);
    expect(parsed.classes).toHaveLength(1);
    // The archive is domain-shaped and bigint-safe: an id is tagged, not a
    // number that would lose precision on the way back in, and not a string
    // that a restore could not tell from a label.
    expect(parsed.classes).toEqual([
      expect.objectContaining({
        id: { $bigint: classRow.id.toString() },
        name: "Physics",
        subjectCount: { $bigint: "0" },
      }),
    ]);
    expect(dump.content).not.toContain(
      (share as { ok: { token: string } }).ok.token,
    );
    expect(parsed.noteShares).toEqual([
      expect.objectContaining({ noteId: { $bigint: note.id.toString() } }),
    ]);
    expect(JSON.stringify(parsed.noteShares)).not.toMatch(/token/u);
  });
});

describe("another account's rows", () => {
  /**
   * The adapter never filters by owner — RLS does it for it.
   *
   * That is the right division of labour, and it is also a promise: if a policy
   * were missing, every query below would happily reach id 50 and edit a stranger's
   * note. So the fake enforces `owner_id = auth.uid()` the way the migration does,
   * and a row that is not the caller's has to be invisible *and* unwritable here,
   * not merely on the way to production.
   */
  beforeEach(() => {
    transport.seed("note", [
      {
        id: 50,
        owner_id: OTHER,
        title: "Theirs",
        status: "active",
        revision: 4,
        document_json: '{"v":9}',
        search_text: "dot",
        deleted_at: null,
        created_at: iso(1),
        updated_at: iso(2),
      },
    ]);
    transport.seed("topic", [
      {
        id: 60,
        owner_id: OTHER,
        chapter_id: 3,
        name: "Their topic",
        created_at: iso(1),
        updated_at: iso(1),
      },
    ]);
  });

  it("cannot be read, edited or deleted through an id", async () => {
    expect(await backend.getNote(50n)).toBeNull();
    expect(await backend.listNotes(null)).toEqual([]);
    expect(await backend.listTrashedNotes()).toEqual([]);
    expect(
      await backend.updateNote(50n, "Mine", null, null, null, "{}", "x", 4n),
    ).toEqual({
      __kind__: "err",
      err: { __kind__: "notFound", notFound: null },
    });
    expect(await backend.renameNote(50n, "Mine")).toEqual({
      __kind__: "err",
      err: { __kind__: "notFound", notFound: null },
    });
    expect(await backend.softDeleteNote(50n)).toEqual({
      __kind__: "err",
      err: { __kind__: "notFound", notFound: null },
    });
    expect(await backend.permanentlyDeleteNote(50n)).toEqual({
      __kind__: "err",
      err: { __kind__: "notFound", notFound: null },
    });
    expect(transport.rows("note")[0]).toMatchObject({
      title: "Theirs",
      revision: 4,
      status: "active",
      document_json: '{"v":9}',
    });
  });

  it("cannot be shared, counted or walked into", async () => {
    expect(await backend.createNoteShare(50n)).toEqual({
      __kind__: "err",
      err: "notAuthorized",
    });
    expect(
      await backend.createShare({ __kind__: "topic", topic: 60n }),
    ).toEqual({
      __kind__: "err",
      err: "notFound",
    });
    expect(await backend.getTopicPath(60n)).toBeNull();
    expect(
      await backend.exportContent(
        { __kind__: "topic", topic: 60n },
        "csv" as ExportFormat,
      ),
    ).toEqual({
      __kind__: "err",
      err: "notFound",
    });
    expect(await backend.getDashboardStats()).toMatchObject({
      topicCount: 0n,
      questionCount: 0n,
    });
  });
});

describe("callers with no session", () => {
  beforeEach(() => {
    transport = new FakeTransport({ userId: null });
    backend = createSupabaseBackend(transport);
  });

  it("refuses an owner call rather than answering with someone else's rows", async () => {
    await expect(backend.listClasses()).rejects.toThrow(/signed-in account/u);
    await expect(backend.getDashboardStats()).rejects.toThrow(
      /signed-in account/u,
    );
  });

  it("still reads a share link and still reports the guest role", async () => {
    transport.rpcs.shared_content = () => ({
      title: "Projectiles",
      breadcrumb: [],
      questions: [],
    });
    expect(
      await backend.getSharedContent("share_abcdefghijklmnopqrstuvwx"),
    ).toMatchObject({
      title: "Projectiles",
    });
    expect(await backend.getMySettings()).toBeNull();
    expect(await backend.getCallerUserRole()).toBe("guest");
    expect(await backend.isCallerAdmin()).toBe(false);
  });
});

describe("the parts of the interface this backend does not serve", () => {
  it("says so rather than pretending a key was stored", async () => {
    expect(await backend.getAiConfig()).toEqual({ hasPersonalKey: false });
    await expect(backend.saveAiKey("sk-live-secret")).rejects.toThrow(
      /device/u,
    );
    expect(await backend.removeAiKey()).toEqual({ hasPersonalKey: false });
    expect(
      await backend.generateDrafts({ topicId: 1n, count: 5n, prompt: "x" }),
    ).toEqual({
      __kind__: "err",
      err: { __kind__: "notConfigured", notConfigured: null },
    });
    await expect(backend.execute("select 1")).rejects.toThrow(/not available/u);
  });

  it("accepts a reviewed draft as a plain question", async () => {
    transport.rpcs.topic_rows = () => [
      { id: 7, chapter_id: 3, name: "Projectiles" },
    ];
    const question = await backend.acceptDraft(7n, {
      id: 1n,
      topicId: 7n,
      prompt: "Which one?",
      questionType: QuestionType.multipleChoice,
      answer: mcq(),
      explanation: "  ",
    });
    expect(question).toMatchObject({ prompt: "Which one?", topicId: 7n });
    expect(question?.explanation).toBeUndefined();
    expect(transport.rows("question")[0].explanation).toBeNull();
  });
});
