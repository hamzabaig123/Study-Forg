#!/usr/bin/env node
/**
 * StudyForge restore drill — put a `backup.mjs` snapshot back into a database.
 *
 * A backup that has never been restored is a hypothesis. `supabase/backup/
 * backup.mjs` writes a readable JSON snapshot of every public table; this file
 * answers the only question that matters about it: do those rows go back in, in
 * an order the constraints accept, with the same counts, into a database that
 * still enforces the policies? Nothing about `pg_dump` proves that, because
 * `pg_dump` also dumps the roles, the grants and the schema, and a restore of
 * the whole thing tells you nothing about whether *this app's* data survived.
 *
 * HOW TO RUN IT
 *
 *   # against a staging project, over HTTPS (no psql, no Docker):
 *   SUPABASE_ACCESS_TOKEN=<PAT> \
 *     node supabase/backup/restore.mjs --into <staging-ref> --confirm <staging-ref>
 *
 *   # or over a direct Postgres session, which is the route that works on a
 *   # machine where db.<ref>.supabase.co does not resolve (see AGENTS.md):
 *   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres' \
 *     node supabase/backup/restore.mjs --into <ref> --confirm <ref>
 *
 *   # read-only rehearsal — preflight, the missing accounts, the exact SQL, and
 *   # nothing written:
 *   ... --dry-run
 *
 * `--snapshot <file>` picks a specific dump; the newest one in
 * `supabase/backup/snapshots/` is the default. `--pg <dump-file>` is covered by
 * OPERATIONS.md instead: the CI workflow's artifact is a `pg_restore` input and
 * this script speaks JSON, not the custom binary format.
 *
 * WHY IT REFUSES THINGS
 *
 * - It will not write to the project a snapshot came *from* without
 *   `--force-into-source`. Restoring over the live database is how a drill
 *   becomes an outage: the TRUNCATE runs first, so a mistake is not caught by a
 *   later failure.
 * - It will not write to a database that already has app rows without
 *   `--allow-nonempty`. A staging project someone else seeded is not empty just
 *   because it is staging.
 * - `--confirm <ref>` has to repeat the target ref. The env var that selects a
 *   project is the same one that selected the project you were debugging ten
 *   minutes ago.
 * - Every owner uuid the snapshot names must exist in `auth.users`, or
 *   `--create-missing-users` must be given. public.owner_id references
 *   auth.users, so a snapshot restored into a fresh project fails its very
 *   first insert without this — the drill has to carry the accounts, not just
 *   the rows. The rows it creates have no password and no identity, so nobody
 *   can sign in as a restored account; the data lands under the right owner and
 *   RLS has somebody to scope to, which is what a drill proves.
 *
 * LIMITS, stated rather than discovered later
 *
 * - Ids are bigint. JSON numbers are exact only to 2^53, so a run stops when any
 *   snapshot id is past that (it would otherwise restore a *different* row).
 * - `rate_limit` is not in a snapshot, so the throttle state is not restored —
 *   by design, it is a minute of somebody's history.
 * - Over HTTPS the whole script is one request, because each Management API call
 *   gets a fresh pooled connection and a BEGIN in one request commits nothing in
 *   the next. A large dump can outgrow that request; the direct route batches
 *   inside one real transaction instead, and the script says which it used.
 *
 * Exit 0 = restored and every count matched. 1 = a restore or a check failed
 * (nothing is left half-written: the transaction rolled back). 2 = the
 * environment, the file, or one of the refusals above.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const DRY_RUN = flag("dry-run");
const ALLOW_NONEMPTY = flag("allow-nonempty");
const FORCE_INTO_SOURCE = flag("force-into-source");
const CREATE_USERS = flag("create-missing-users");
const REF = opt("into")?.trim();
const CONFIRM = opt("confirm")?.trim();
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const DB_URL = process.env.SUPABASE_DB_URL?.trim();

function stop(message, code) {
  console.error(`\nrestore stopped: ${message}`);
  // process.exit rather than an exitCode + return: every caller of this is a
  // refusal, and falling through one of them would mean doing the thing the
  // message just said it refuses to do. Nothing is connected yet at any call
  // site, so there is no socket to trip the Windows drain assertion.
  process.exit(code);
}

if (!REF) stop("give the target project with --into <ref>.", 2);
if (!CONFIRM)
  stop("repeat it with --confirm <ref>. This script truncates tables.", 2);
if (CONFIRM !== REF) {
  stop(
    `--confirm ${CONFIRM} does not match --into ${REF}. Refusing to guess which is meant.`,
    2,
  );
}
if (!TOKEN && !DB_URL) {
  stop(
    "set SUPABASE_ACCESS_TOKEN (Management API) or SUPABASE_DB_URL (direct Postgres).",
    2,
  );
}

// --- the snapshot ------------------------------------------------------------

function newestSnapshot() {
  try {
    const files = readdirSync(join(here, "snapshots"))
      .filter((f) => f.endsWith(".json"))
      .sort();
    return files.length === 0
      ? undefined
      : join(here, "snapshots", files[files.length - 1]);
  } catch {
    return undefined;
  }
}

const snapshotPath = opt("snapshot")
  ? resolve(opt("snapshot"))
  : newestSnapshot();
if (!snapshotPath) {
  stop(
    `no snapshot found in ${join(here, "snapshots")} — run backup.mjs first.`,
    2,
  );
}

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
} catch (err) {
  stop(`could not read ${snapshotPath}: ${err.message}`, 2);
}
if (!snapshot?.tables || typeof snapshot.tables !== "object") {
  stop(`${snapshotPath} is not a backup.mjs snapshot (no .tables object).`, 2);
}
const sourceRef = snapshot.project ?? "unknown";
console.log(`snapshot   : ${snapshotPath}`);
console.log(
  `taken      : ${snapshot.takenAt ?? "?"} from project ${sourceRef}`,
);
console.log(
  `tables     : ${Object.keys(snapshot.tables).length}, ` +
    `${Object.values(snapshot.tables).reduce((n, r) => n + r.length, 0)} rows total`,
);
if (!DRY_RUN && sourceRef === REF && !FORCE_INTO_SOURCE) {
  stop(
    `the target is the project this snapshot came from. Restoring truncates the ` +
      `live tables first. Point --into at a staging ref, or pass --force-into-source ` +
      `if you really mean it.`,
    2,
  );
}

// --- the transport -----------------------------------------------------------

/**
 * Two ways to reach the same database, and they differ in exactly one way that
 * matters: a direct session can hold a transaction open across many round
 * trips, an HTTPS call cannot (each request gets its own pooled connection, so a
 * `begin` in one request commits nothing in the next). The interface is
 * therefore `transaction(parts)` — the caller hands over an ordered list of
 * statements and the transport decides how to make them one unit.
 */
let query;
let transaction;
let close = async () => {};
let transport;

if (DB_URL) {
  const pg = await loadPg();
  const client = new pg.Client(DB_URL);
  await client.connect();
  transport =
    "direct Postgres session (one real transaction, rollback on any error)";
  query = async (sql) => (await client.query(sql)).rows ?? [];
  transaction = async (parts) => {
    await client.query("begin");
    try {
      for (const part of parts) await client.query(part);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    }
  };
  close = () => client.end();
} else {
  // Overridable so the route can be exercised against a stub server; a
  // self-hosted Supabase exposes the same API under its own host.
  const API = (
    process.env.SUPABASE_MANAGEMENT_API?.trim() || "https://api.supabase.com/v1"
  ).replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };
  transport = "Supabase Management API (the whole restore in a single request)";
  const post = async (sql) => {
    const res = await fetch(`${API}/projects/${REF}/database/query`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  };
  query = post;
  // One implicit transaction: Postgres runs a multi-statement simple query as a
  // unit, so a failure anywhere leaves nothing behind. That is also what bounds
  // how big a snapshot this route can carry — the script says so below.
  transaction = async (parts) => post(parts.join("\n"));
}

async function loadPg() {
  for (const specifier of [
    "pg",
    resolve(here, "..", "..", "src", "frontend", "node_modules", "pg"),
  ]) {
    try {
      return require(specifier);
    } catch {
      // try the next place
    }
  }
  stop(
    "`pg` is not a dependency of this project. Install it outside the repo and\n" +
      "point NODE_PATH at it:\n" +
      "  mkdir -p ../sf-scratch && cd ../sf-scratch && npm install pg\n" +
      "  NODE_PATH=../sf-scratch/node_modules node .../restore.mjs ...",
    2,
  );
  throw new Error("no pg driver");
}

// --- SQL text helpers --------------------------------------------------------

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function quoteString(text) {
  if (text.includes("\0"))
    throw new Error(
      "a snapshot value contains NUL, which no string literal can hold",
    );
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * A preflight refusal rather than a failed restore: nothing was written, and the
 * operator has a choice to make. Exit 2 says so, which is the code
 * apply-migration.mjs already uses for "your environment is wrong".
 */
class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

/**
 * One snapshot cell to one SQL literal, using the live column type rather than
 * the JS type: the API hands back a jsonb column as a parsed object, and a
 * timestamptz as a string that must not be quoted as a number.
 */
function literal(value, type) {
  if (value === null || value === undefined) return "null";
  if (type === "json" || type === "jsonb")
    return `${quoteString(JSON.stringify(value))}::${type}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(`non-finite number in the snapshot: ${value}`);
    return String(value);
  }
  if (typeof value === "string") return quoteString(value);
  throw new Error(
    `cannot write a ${type} column from ${JSON.stringify(value).slice(0, 80)}`,
  );
}

// --- preflight ---------------------------------------------------------------

/** @type {Map<string, Array<{name:string,type:string,idKind:string}>>} */
const schema = new Map();

async function preflight() {
  const found = await query(
    "select tablename from pg_tables where schemaname = 'public' order by 1;",
  );
  const target = new Set(found.map((r) => r.tablename));
  const wanted = Object.keys(snapshot.tables);
  const missing = wanted.filter((t) => !target.has(t));
  if (missing.length > 0) {
    refuse(
      `the target has no table(s): ${missing.join(", ")} — apply the migrations first ` +
        `(a snapshot is not a schema).`,
    );
  }
  const untouched = [...target].filter((t) => !wanted.includes(t));

  const cols = await query(`
    select table_name, column_name, data_type,
       (select coalesce(a.attidentity, '')
          from pg_attribute a
          join pg_class c on c.oid = a.attrelid
         where c.relnamespace = 'public'::regnamespace
           and c.relname = d.table_name
           and a.attname = d.column_name) as id_kind
      from information_schema.columns d
     where table_schema = 'public'
       and table_name in (${wanted.map(quoteString).join(", ")})
     order by table_name, ordinal_position;
  `);
  for (const row of cols) {
    if (!schema.has(row.table_name)) schema.set(row.table_name, []);
    schema.get(row.table_name).push({
      name: row.column_name,
      type: row.data_type,
      idKind: row.id_kind,
    });
  }
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (rows.length === 0) continue;
    const have = new Set((schema.get(table) ?? []).map((c) => c.name));
    const extra = Object.keys(rows[0]).filter((k) => !have.has(k));
    if (extra.length > 0) {
      refuse(
        `the snapshot's ${table} has column(s) the target lacks: ${extra.join(", ")} — ` +
          `the dump is from a newer schema than this database.`,
      );
    }
  }

  // Exact counts, not `pg_class.reltuples`: the estimate is -1 until the table
  // has been analysed, and a fresh staging project has never been analysed, so
  // an estimate would call a database full of rows empty.
  const before = await query(countScript(wanted));
  const live = Object.fromEntries(before.map((r) => [r.tbl, Number(r.n)]));
  const dirty = wanted.filter((t) => (live[t] ?? 0) > 0);
  console.log(
    dirty.length === 0
      ? "target     : every table in the restore set is empty"
      : `target     : ${dirty.length} table(s) already hold rows (${dirty.slice(0, 6).join(", ")}${dirty.length > 6 ? ", …" : ""})`,
  );
  if (dirty.length > 0 && !ALLOW_NONEMPTY && !DRY_RUN) {
    refuse(
      "refusing to truncate a database that has data of its own. Seed a fresh staging " +
        "project, or pass --allow-nonempty if these rows are yours to replace.",
    );
  }

  // Identity is a bigint in JSON: past 2^53 the number in the file is already a
  // different integer than the one that was in the column.
  const unsafe = [];
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    for (const row of rows) {
      if (typeof row.id === "number" && !Number.isSafeInteger(row.id))
        unsafe.push(`${table}.id=${row.id}`);
    }
  }
  if (unsafe.length > 0) {
    refuse(
      `${unsafe.length} id(s) exceed 2^53 and would restore as the wrong row: ${unsafe.slice(0, 5).join(", ")}`,
    );
  }

  // The FK every app row carries: public.owner_id -> auth.users.id.
  const owners = new Set();
  for (const rows of Object.values(snapshot.tables)) {
    for (const row of rows)
      if (typeof row.owner_id === "string") owners.add(row.owner_id);
  }
  let absent = [...owners];
  if (owners.size > 0) {
    const rows = await query(
      `select id::text as id from auth.users where id in (${[...owners].map(quoteString).join(", ")});`,
    );
    const present = new Set(rows.map((r) => r.id));
    absent = [...owners].filter((id) => !present.has(id));
  }
  console.log(
    owners.size === 0
      ? "accounts   : the snapshot holds no owner_id"
      : `accounts   : ${owners.size} owner(s), ${absent.length} missing from auth.users`,
  );
  if (absent.length > 0 && !CREATE_USERS && !DRY_RUN) {
    refuse(
      `${absent.length} account(s) the rows belong to do not exist in this project ` +
        `(${absent.slice(0, 3).join(", ")}${absent.length > 3 ? ", …" : ""}). owner_id references ` +
        `auth.users, so the first insert fails. Pass --create-missing-users to make them ` +
        `(rows only: no password, no identity, nobody can sign in as them).`,
    );
  }

  return { untouched, absent };
}

// --- the restore itself ------------------------------------------------------

/**
 * Insert order from the live foreign keys, not from a list in this file: a
 * hand-kept order is correct until someone adds a table.
 */
async function restoreOrder(tables) {
  const edges = await query(`
    select src.relname as child, tgt.relname as parent
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
     where con.contype = 'f'
       and src.relnamespace = 'public'::regnamespace
       and tgt.relnamespace = 'public'::regnamespace
       and src.relname <> tgt.relname;
  `);
  const parents = new Map();
  for (const e of edges) {
    if (!tables.includes(e.child) || !tables.includes(e.parent)) continue;
    if (!parents.has(e.child)) parents.set(e.child, new Set());
    parents.get(e.child).add(e.parent);
  }
  const order = [];
  const state = new Map();
  const visit = (table, path) => {
    if (state.get(table) === "done") return;
    if (state.get(table) === "open") {
      refuse(
        `circular foreign keys (${[...path, table].join(" -> ")}): this script would need ` +
          `deferred constraints. Break the cycle in the schema rather than here.`,
      );
    }
    state.set(table, "open");
    for (const parent of parents.get(table) ?? [])
      visit(parent, [...path, table]);
    state.set(table, "done");
    order.push(table);
  };
  for (const table of tables) visit(table, []);
  return order;
}

function insertScript(table, rows) {
  const present = new Set(rows.flatMap((r) => Object.keys(r)));
  const columns = schema.get(table).filter((c) => present.has(c.name));
  const typeOf = new Map(columns.map((c) => [c.name, c.type]));
  // `generated always as identity` refuses a supplied id unless told to take it.
  const overriding = columns.some((c) => c.idKind === "a")
    ? " overriding system value"
    : "";
  const body = rows
    .map(
      (row) =>
        `(${columns.map((c) => literal(row[c.name] ?? null, typeOf.get(c.name))).join(", ")})`,
    )
    .join(",\n");
  return `insert into ${quoteIdent(table)} (${columns
    .map((c) => quoteIdent(c.name))
    .join(", ")})${overriding} values\n${body};`;
}

/**
 * Row counts for a set of tables, in one round trip. `table` and `rows` are both
 * SQL keywords, so the aliases are quoted — an unquoted `as table` is a syntax
 * error, which is the kind of thing only a run catches.
 */
function countScript(tables) {
  return tables
    .map(
      (t) =>
        `select ${quoteString(t)} as "tbl", count(*)::bigint as "n" from ${quoteIdent(t)}`,
    )
    .join("\nunion all\n");
}

/**
 * The restore as an ordered list of statements. `begin`/`commit` are not in
 * here: the transport decides how they become one unit, because the two routes
 * cannot do it the same way.
 */
function buildRestore(orders, absentOwners) {
  const parts = ["set local statement_timeout = '15min';"];

  for (const id of absentOwners) {
    // An unusable password and no auth identity: the row exists so the app's
    // rows have an owner and RLS has somebody to scope to. Nobody can sign in
    // as it, which is the point of a drill database.
    parts.push(
      `insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, ` +
        `raw_app_meta_data, raw_user_meta_data) values (${quoteString(id)}::uuid, ` +
        `'authenticated', 'authenticated', ${quoteString(`restored-${id.slice(0, 8)}@invalid.example`)}, ` +
        `'x', now(), '{}'::jsonb, '{}'::jsonb) on conflict (id) do nothing;`,
    );
  }

  const filled = orders.filter((t) => (snapshot.tables[t] ?? []).length > 0);
  // Every table in the restore set, not just the ones with rows to put back: a
  // snapshot that holds zero `ai_draft` rows means the source had none, and a
  // target that still has some is not a copy of that source. Truncating the
  // empty ones is what makes "counts match" mean "the data matches".
  if (orders.length > 0) {
    parts.push(
      `truncate table ${orders.map(quoteIdent).join(", ")} restart identity cascade;`,
    );
  }
  for (const table of filled) {
    parts.push(insertScript(table, snapshot.tables[table]));
    if (schema.get(table).some((c) => c.idKind === "a" || c.idKind === "d")) {
      // Explicit ids do not move the sequence, so the next insert would collide
      // with the row that was restored into slot 15.
      parts.push(
        `select setval(pg_get_serial_sequence(${quoteString(table)}, 'id'), ` +
          `(select coalesce(max(id), 1) from ${quoteIdent(table)}));`,
      );
    }
  }
  return parts;
}

// --- run ---------------------------------------------------------------------

process.exitCode = 1;
try {
  const { untouched, absent } = await preflight();
  const orders = await restoreOrder(Object.keys(snapshot.tables));

  if (untouched.length > 0) {
    console.log(`left alone : ${untouched.join(", ")} (not in the snapshot)`);
  }
  console.log(`order      : ${orders.join(" -> ")}`);
  console.log(`transport  : ${transport}`);

  const parts = buildRestore(orders, DRY_RUN ? [] : absent);
  const chars = parts.join("\n").length;
  if (DRY_RUN) {
    console.log(
      `\n-- dry run: nothing was written. ${absent.length} account(s) would be created.`,
    );
    console.log(
      `-- ${parts.length} statements, ${chars.toLocaleString()} characters, first 40 lines:\n`,
    );
    console.log(
      parts
        .join("\n")
        .split("\n")
        .slice(0, 40)
        .map((l) => `   ${l.slice(0, 160)}`)
        .join("\n"),
    );
    process.exitCode = 0;
  } else {
    console.log(
      `\nrestoring ${parts.length} statements, ${chars.toLocaleString()} characters…`,
    );
    await transaction(parts);
    console.log("restored.");

    const after = await query(countScript(Object.keys(snapshot.tables)));
    const expected = new Map(
      Object.entries(snapshot.tables).map(([t, rows]) => [t, rows.length]),
    );
    let bad = 0;
    for (const row of after) {
      const want = expected.get(row.tbl) ?? 0;
      const got = Number(row.n);
      if (want !== got) {
        bad += 1;
        console.log(`  MISMATCH ${row.tbl}: snapshot ${want}, restored ${got}`);
      }
    }
    for (const [table, want] of expected) {
      if (!after.some((r) => r.tbl === table) && want !== 0) {
        bad += 1;
        console.log(
          `  MISSING  ${table}: never read back (${want} rows expected)`,
        );
      }
    }

    // The properties that make the data safe to serve again, re-read after the
    // write rather than assumed from the schema file — the same three counts
    // `verify.sql` asks a human to read (checks 2, 2 and 4).
    const guards = await query(`
      select
        (select count(*) from pg_class where relnamespace = 'public'::regnamespace
           and relkind = 'r' and relpersistence = 'p'
           and not relrowsecurity)                                              as "without_rls",
        (select count(*) from pg_class where relnamespace = 'public'::regnamespace
           and relkind = 'r' and relpersistence = 'p'
           and relrowsecurity and not relforcerowsecurity)                       as "without_force",
        (select count(*) from information_schema.role_table_grants
          where table_schema = 'public' and grantee = 'anon')                     as "anon_grants";
    `);
    const g = guards[0] ?? {};
    console.log(
      `RLS        : ${g.without_rls ?? "?"} table(s) without RLS, ` +
        `${g.without_force ?? "?"} without FORCE, ${g.anon_grants ?? "?"} anon table grants`,
    );

    const ok =
      bad === 0 &&
      Number(g.without_rls) === 0 &&
      Number(g.without_force) === 0 &&
      Number(g.anon_grants) === 0;
    console.log(
      ok
        ? `\nDRILL PASS — ${expected.size} tables, ${[...expected.values()].reduce((a, b) => a + b, 0)} rows, every count matched.`
        : `\nDRILL FAIL — ${bad} table(s) came back with a different count, or a guard moved.`,
    );
    console.log(
      "Next: sign in with a real account on this project and open the dashboard. A " +
        "count that matches is not the same as a page that renders.",
    );
    process.exitCode = ok ? 0 : 1;
  }
} catch (err) {
  if (err.status === 401) {
    console.error(
      "\nDRILL FAIL: the Management API refused this token (401) — the same refusal " +
        "apply-migration.mjs documents, a well-formed sbp_ token that authenticates " +
        "nobody. Run again with SUPABASE_DB_URL instead.",
    );
    process.exitCode = 2;
  } else if (err instanceof Refusal) {
    console.error(`\nrestore stopped before writing anything: ${err.message}`);
    process.exitCode = 2;
  } else {
    console.error(`\nDRILL FAIL: ${err.message}`);
    process.exitCode = 1;
  }
} finally {
  await close();
}
