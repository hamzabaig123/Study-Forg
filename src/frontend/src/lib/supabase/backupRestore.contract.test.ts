/**
 * The drift guard for supabase/backup/restore.mjs's account collection.
 *
 * A restore recreates the auth.users rows the snapshot's data depends on. Those
 * rows are referenced by more than `owner_id`: `reminder_log`,
 * `reminder_settings` and `push_subscriptions` point at auth.users through
 * `user_id`. An account that set a reminder but owns no content has no
 * `owner_id` row anywhere, so an owner_id-only scan never creates it and the
 * restore fails its first reminder insert with a foreign-key violation. This was
 * measured against a real production snapshot on 2026-10-10 (a fourth account
 * appeared only in reminder_log.user_id).
 *
 * The fix discovers every public -> auth.users(id) foreign key from the target's
 * own catalog. This test pins that discovery so it cannot silently revert: it
 * runs offline from `pnpm test` and reads the script source, in the same idiom as
 * sqlSurface.contract.test.ts. Paths come from `process.cwd()` because under
 * jsdom `import.meta.url` is an http URL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "..", "..");
const restore = readFileSync(
  join(repoRoot, "supabase", "backup", "restore.mjs"),
  "utf8",
);

// Strip line and block comments so prose about the old behaviour cannot satisfy
// an assertion that is meant to be met by code.
const code = restore
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("restore.mjs account collection", () => {
  it("discovers account columns from the catalog, not a hardcoded owner_id", () => {
    // The referencing columns must be read from pg_constraint for foreign keys
    // into auth.users. information_schema.constraint_column_usage is deliberately
    // not used: it returned zero rows for these cross-schema keys on a real
    // target, which is the whole reason the query is written against pg_constraint.
    expect(code).toMatch(/pg_constraint/);
    expect(code).toMatch(/contype\s*=\s*'f'/);
    expect(code).toMatch(/relname\s*=\s*'users'/);
    expect(code).not.toMatch(/constraint_column_usage/);
  });

  it("collects every discovered account column, not only owner_id", () => {
    // The owners set is built by iterating the per-table column set. A revert to
    // `row.owner_id` alone would drop reminder-only accounts again.
    expect(code).toMatch(/accountColumns/);
    expect(code).toMatch(
      /for\s*\(const column of accountColumns\.get\(table\)/,
    );
    // owner_id is still seeded as the fallback for a target whose catalog cannot
    // be read, so the common case never regresses either.
    expect(code).toMatch(/addAccountColumn\(table, "owner_id"\)/);
  });

  it("still recreates missing accounts only under an explicit flag", () => {
    // The safety property the drill depends on: accounts are created only with
    // --create-missing-users, and never silently.
    expect(code).toMatch(/CREATE_USERS/);
    expect(restore).toMatch(/--create-missing-users|create-missing-users/);
  });
});
