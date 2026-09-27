#!/usr/bin/env node
/**
 * StudyForge data backup — dumps every public table to one JSON snapshot.
 *
 * The platform's daily backups and PITR cover disaster recovery, but they are
 * opaque until a restore is attempted; this dump is a readable, diffable copy
 * a human can open. Run it before and after risky operations:
 *
 *   SUPABASE_ACCESS_TOKEN=<PAT> SUPABASE_PROJECT_REF=<ref> \
 *     node supabase/backup/backup.mjs
 *
 * Writes supabase/backup/snapshots/<stamp>.json (the snapshots folder is
 * gitignored — real user data must not land in git). Exit 0 = every table read.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref = process.env.SUPABASE_PROJECT_REF?.trim();
if (!TOKEN || !ref) {
  console.error(
    "SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF are required (env only).",
  );
  process.exit(2);
}

const API = "https://api.supabase.com/v1";
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function runSql(query) {
  const res = await fetch(`${API}/projects/${ref}/database/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`query failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

(async () => {
  const tables = (
    await runSql(
      "select tablename from pg_tables where schemaname='public' and tablename not in ('rate_limit') order by 1;",
    )
  ).map((row) => row.tablename);
  console.log(`backing up ${tables.length} tables:`, tables.join(", "));

  const snapshot = { project: ref, takenAt: new Date().toISOString(), tables: {} };
  for (const table of tables) {
    // The anon-blocked and owner tables read fine here: this runs as postgres,
    // and the point of the dump is everything, not what one role can see.
    const rows = await runSql(`select * from "${table}";`);
    snapshot.tables[table] = rows;
    console.log(`  ${table}: ${rows.length} row(s)`);
  }

  const outDir = join(here, "snapshots");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(outDir, `${stamp}.json`);
  writeFileSync(out, JSON.stringify(snapshot, null, 2));
  console.log("snapshot written:", out);

  // Platform-side scheduled backups, for the record next to the dump.
  try {
    const res = await fetch(`${API}/projects/${ref}/database/backups`, { headers });
    if (res.ok) {
      const info = await res.json();
      const scheduled = Array.isArray(info) ? info : info.backups ?? [];
      console.log(
        "platform scheduled backups:",
        scheduled.length > 0
          ? scheduled
              .map((b) => `${b.name ?? "backup"}: ${b.status ?? "?"} @ ${b.inserted_at ?? b.start_at ?? "?"}`)
              .join(" | ")
          : "(none reported — Free projects get daily platform backups regardless)",
      );
    } else {
      console.log(`platform backups endpoint: HTTP ${res.status} (recorded here for completeness)`);
    }
  } catch (err) {
    console.log("platform backups endpoint unreachable:", err.message);
  }
  console.log("BACKUP OK");
})().catch((err) => {
  console.error("BACKUP FAILED:", err.message);
  process.exit(1);
});
