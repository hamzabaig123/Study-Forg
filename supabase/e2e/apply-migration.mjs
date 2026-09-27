#!/usr/bin/env node
/**
 * StudyForge migration runner — applies 0001_init.sql and proves it landed,
 * using only the Supabase Management API.
 *
 * Why this exists: the documented path (`supabase db push`, `psql`) needs Docker
 * or a postgres client, and the development machine has neither — no virtualiser,
 * no psql, no dfx. The Management API reaches the same database over HTTPS with
 * one credential, so applying the schema, asserting the grants and running the
 * cross-tenant RLS file are all possible from this PC.
 *
 * Credentials (env only, never a file that gets committed):
 *   SUPABASE_ACCESS_TOKEN  dashboard → Account → Advanced → API tokens (a
 *                          "Personal access token"). This is the ONLY secret
 *                          this script needs.
 *   SUPABASE_PROJECT_REF   the <ref> from https://<ref>.supabase.co
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... node supabase/e2e/apply-migration.mjs
 *   ... add --dry-run to check the project and print what WOULD run
 *   ... add --project to target a second ref (staging then production, same file)
 *
 * Exit 0 = schema present, every assertion holds, RLS file raised nothing.
 * Exit 1 = a check failed. Exit 2 = credentials or the project itself unusable.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
let ref = process.env.SUPABASE_PROJECT_REF?.trim();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const projectFlag = args.indexOf("--project");
if (projectFlag !== -1 && args[projectFlag + 1]) ref = args[projectFlag + 1];

if (!TOKEN) {
  console.error(
    "SUPABASE_ACCESS_TOKEN is not set.\n" +
      "  Create one at https://supabase.com/dashboard/account/tokens and run:\n" +
      "  SUPABASE_ACCESS_TOKEN=<token> SUPABASE_PROJECT_REF=<ref> node supabase/e2e/apply-migration.mjs",
  );
  process.exit(2);
}
if (!ref) {
  console.error(
    "SUPABASE_PROJECT_REF is not set (the subdomain of https://<ref>.supabase.co).",
  );
  process.exit(2);
}

const API = "https://api.supabase.com/v1";
const sqlPath = join(root, "supabase", "migrations", "0001_init.sql");
const rlsPath = join(root, "supabase", "tests", "rls_cross_tenant.sql");

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

/**
 * The query endpoint answers with an array of rows for a SELECT, an empty body
 * or array for a statement that returns nothing, and — on error — either a non
 * 2xx status or a payload carrying `error`. All three shapes are handled, because
 * a migration script that misreads an error as success is worse than no script.
 */
async function runSql(query, { label } = {}) {
  const response = await fetch(`${API}/projects/${ref}/database/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  let payload = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    const detail =
      typeof payload === "string"
        ? payload.slice(0, 400)
        : JSON.stringify(payload).slice(0, 400);
    throw new Error(
      `${label ?? "query"} failed (HTTP ${response.status}): ${detail}`,
    );
  }
  if (payload && !Array.isArray(payload) && payload.error) {
    throw new Error(
      `${label ?? "query"} failed: ${JSON.stringify(payload).slice(0, 400)}`,
    );
  }
  return Array.isArray(payload) ? payload : payload ? [payload] : [];
}

const rows = (payload) => (Array.isArray(payload) ? payload : [payload]);
const firstValue = (payload) => {
  const list = rows(payload);
  const first = list[0];
  if (!first || typeof first !== "object") return first;
  return Object.values(first)[0];
};
/** Every assertion below is a row count, so one helper rather than eight shapes. */
const count = (payload) => rows(payload).length;
/** The first column of every row, for printing what a failed count was counting. */
const names = (payload) =>
  rows(payload)
    .map((row) =>
      row && typeof row === "object" ? Object.values(row)[0] : row,
    )
    .join(", ");

/**
 * A credential or project problem is fatal but not a check failure: exit 2 tells
 * whoever ran it to fix how it was run, exit 1 tells them to fix the database.
 *
 * Thrown rather than `process.exit`-ed because a pending `fetch` on Windows
 * crashes on a mid-flight exit ("Assertion failed: UV_HANDLE_CLOSING") and the
 * real message never reaches whoever needs it. Setting `process.exitCode` lets
 * the sockets close and the message print first.
 */
class FatalError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

let failures = 0;
function check(name, actual, expected, detail) {
  const ok = String(actual) === String(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}: ${actual}` +
      (ok ? "" : ` (expected ${expected})`) +
      (ok || !detail ? "" : `\n        ${detail}`),
  );
}

/**
 * Run one assertion and print it.
 *
 * A bare "FAIL  tables: 19" says only that a number moved, so the rows behind the
 * count are printed with the failure — that is what turns "something is off" into
 * the name of the leaked grant or the extra anon-executable function.
 */
async function assertCount(name, sql, label, expected) {
  const result = await runSql(sql, { label });
  check(name, count(result), expected, names(result).slice(0, 500));
}

async function main() {
  // 1. The token and the ref have to agree about a project that exists.
  const projectResponse = await fetch(`${API}/projects/${ref}`, { headers });
  if (!projectResponse.ok) {
    const body = await projectResponse.text();
    throw new FatalError(
      `Cannot read project "${ref}" (HTTP ${projectResponse.status}): ${body.slice(0, 300)}\n` +
        (projectResponse.status === 401
          ? "The access token is not valid for this account."
          : projectResponse.status === 404
            ? "Wrong ref, or this token cannot see that project."
            : ""),
    );
  }
  const project = await projectResponse.json();
  console.log(
    `Project ${ref} — "${project.name}" (${project.region}, ${project.database?.size ?? "?"})`,
  );

  // 2. Idempotency guard: never re-run the migration over an applied one.
  const applied = firstValue(
    await runSql("select to_regclass('public.question')::text;", {
      label: "presence check",
    }),
  );

  if (applied && applied !== "null") {
    console.log("public.question already exists — migration not re-applied.");
  } else if (dryRun) {
    console.log(
      `DRY RUN: would apply ${readFileSync(sqlPath, "utf8").length} bytes of 0001_init.sql.`,
    );
  } else {
    console.log("Applying supabase/migrations/0001_init.sql …");
    await runSql(readFileSync(sqlPath, "utf8"), { label: "migration" });
    console.log("Applied.");
  }

  // 3. verify.sql states these as queries a human reads; here they are counts,
  //    so a half-applied schema or a leaked grant fails the run instead of
  //    waiting for somebody to notice a surprising row count in the editor.
  console.log("\nChecks");
  await assertCount(
    "tables in public (verify.sql #1)",
    "select table_name from information_schema.tables where table_schema='public' order by 1;",
    "tables",
    19,
  );
  await assertCount(
    "tables with RLS on and forced (verify.sql #2)",
    "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity and c.relforcerowsecurity order by 1;",
    "rls",
    19,
  );
  await assertCount(
    "tables missing an owner policy (verify.sql #3)",
    // `pg_policies.cmd` carries the command (INSERT's check lives in
    // `with_check`, where `qual` is null) — `permutation` needs a newer
    // Postgres than this project runs.
    `with required(role) as (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
     select t.tablename, r.role from pg_tables t cross join required r
      where t.schemaname='public' and t.tablename not in ('abuse_report', 'rate_limit')
        and not exists (select 1 from pg_policies p
                         where p.schemaname='public' and p.tablename=t.tablename
                           and p.cmd=r.role
                           and (p.qual like '%auth.uid()%' or p.with_check like '%auth.uid()%'))
      order by 1, 2;`,
    "missing policies",
    0,
  );
  await assertCount(
    "anon table grants — RLS must not be the only door (verify.sql #4)",
    // Storage's own tables are granted to anon by the platform; only the
    // public schema is ours to protect.
    "select table_name, privilege_type from information_schema.role_table_grants where grantee='anon' and table_schema='public';",
    "anon grants",
    0,
  );
  await assertCount(
    "functions anon may execute — the token surface only (verify.sql #5)",
    "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute') order by 1;",
    "anon functions",
    10,
  );
  await assertCount(
    "SECURITY DEFINER functions with no search_path pin (verify.sql #6)",
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
        and not exists (select 1 from unnest(p.proconfig) as cfg(x) where cfg.x like 'search_path=%')
      order by 1;`,
    "search_path",
    0,
  );
  await assertCount(
    "policies that admit anon (verify.sql #7)",
    "select tablename, policyname from pg_policies where schemaname='public' and roles @> array['anon'::name] order by 1, 2;",
    "anon policies",
    0,
  );

  // 4. Behaviour, not configuration: three identities, one transaction, ROLLBACK.
  //    The file raises an exception naming the check on any failure, so a clean
  //    return means it passed.
  if (dryRun) {
    console.log("\nDRY RUN: rls_cross_tenant.sql not executed.");
  } else {
    console.log("\nRunning supabase/tests/rls_cross_tenant.sql …");
    // The file needs one transaction around it: `set local role/jwt.claims`
    // only holds inside one, and the query endpoint's autocommit mode mangles
    // multi-statement files (a bare batch dies compiling a RAISE it never
    // reaches). `begin … rollback` is the shape the SQL editor would run.
    await runSql(
      `begin;\n${readFileSync(rlsPath, "utf8")}\nrollback;`,
      { label: "cross-tenant RLS" },
    );
    console.log("PASS  cross-tenant RLS file raised nothing.");
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `\nAll checks passed on ${ref}${dryRun ? " (dry run)" : ""}. Next: run the replay sweep,\n` +
      "  SUPABASE_URL=https://" +
      ref +
      ".supabase.co SUPABASE_ANON_KEY=<publishable> SUPABASE_SERVICE_ROLE_KEY=<service> \\\n" +
      "  node supabase/e2e/replay-sweep.mjs",
  );
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = error instanceof FatalError ? error.exitCode : 1;
});
