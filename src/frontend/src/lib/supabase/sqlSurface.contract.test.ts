/**
 * The drift guard between the adapter and the migration.
 *
 * Every table and Postgres function the Supabase adapter names is checked
 * against what `supabase/migrations/0001_init.sql` actually creates. It runs
 * offline, from `pnpm test`, so "the adapter calls a function that was renamed
 * in the SQL" fails on the reviewer's machine rather than as a 404 from a live
 * project — the failure mode the real-backend tasks cannot exercise until a
 * valid key exists.
 *
 * Paths are built from `process.cwd()` because under jsdom `import.meta.url`
 * is an http URL.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from "./tokens";

const repoRoot = join(process.cwd(), "..", "..");
const migrationDir = join(repoRoot, "supabase", "migrations");

function tsFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...tsFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
      found.push(path);
  }
  return found;
}

/** Every migration, in apply order. Later files supersede earlier ones. */
const migrations = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    text: readFileSync(join(migrationDir, name), "utf8"),
  }));

const sql = migrations.map((file) => file.text).join("\n");

const sqlFunctions = new Set(
  [...sql.matchAll(/create (?:or replace )?function ([a-z_]+)/g)].map(
    (match) => match[1] as string,
  ),
);

const sqlTables = new Set(
  [
    ...sql.matchAll(/create table(?: if not exists)? (?:public\.)?([a-z_]+)/g),
  ].map((match) => match[1] as string),
);

const adapterDir = join(process.cwd(), "src", "lib", "supabase");
const source = tsFiles(adapterDir)
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

/** RPC names reach SQL three ways: transport.rpc, the shared wrappers, noteRpc. */
const rpcPatterns: RegExp[] = [
  /(?:\.rpc|noteRpc)\(\s*(?:[A-Za-z.]+\s*,\s*)?"([a-z_]+)"/g,
  /\b(?:rpcRows|rpcEnvelope|rpcOptional|oneRow|oneRowOrThrow)\(\s*[A-Za-z.]+\s*,\s*"([a-z_]+)"/g,
];

const tableReaders = /\.read\(\s*"([a-z_]+)"/g;
const tableWriters = /\.write\(\s*"([a-z_]+)"/g;

function collect(pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1] as string);
}

const usedRpc = [...new Set(rpcPatterns.flatMap(collect))].sort();
const usedTables = [
  ...new Set([...collect(tableReaders), ...collect(tableWriters)]),
].sort();

describe("adapter ↔ migration contract", () => {
  it("finds the SQL surface in the adapter (a broken pattern must not pass silently)", () => {
    // The adapter drives 24 RPCs and 14 tables; a drop below these means the
    // extraction regexes no longer match the call style, not that code was
    // deleted quietly.
    expect(usedRpc.length).toBeGreaterThanOrEqual(24);
    expect(usedTables.length).toBeGreaterThanOrEqual(14);
  });

  it("only calls Postgres functions the migration creates", () => {
    const missing = usedRpc.filter((name) => !sqlFunctions.has(name));
    expect(missing).toEqual([]);
  });

  it("only touches tables the migration creates", () => {
    const missing = usedTables.filter((name) => !sqlTables.has(name));
    expect(missing).toEqual([]);
  });

  it("grants every RPC the signed-in adapter uses", () => {
    // A function can exist and still be unexecutable: Supabase needs an
    // explicit grant to authenticated (or anon) for every RPC called.
    const granted = new Set(
      [...sql.matchAll(/grant execute on function ([a-z_]+)\(/g)].map(
        (match) => match[1] as string,
      ),
    );
    const ungranted = usedRpc.filter((name) => !granted.has(name));
    expect(ungranted).toEqual([]);
  });
});

/**
 * The short code is the only address the public `/r/:code` endpoint has, so its
 * entropy is a security property, not a formatting one. Three places have to
 * agree — the column CHECK, `create_link`'s own validator, and the generator
 * the client calls — and history shows they drift: 0001 wrote `{7}` and 0002
 * copied it into a new function body. This is the guard that catches the next
 * migration that widens one and forgets the other.
 */
/**
 * A code rule as it appears in SQL: which side declares it, and the pattern.
 *
 * Two statements constrain a code — `link`'s column CHECK and `create_link`'s
 * own validator — and they are written in different files by different
 * migrations. The function has to be re-declared whenever the column is
 * widened, so a later migration may legitimately carry one of the two and not
 * the other; what must never differ is the rule each of them finally states.
 */
const CODE_RULE =
  /\b(?<declarer>p_code|code)\s*(?:!~|~)\s*'(?<pattern>\^\[[^\]]+\]\{\d+(?:,\d+)?\}\$)'/g;

/**
 * `--` lines and `/* *\/` blocks removed. A migration prose-quotes the rule it
 * replaces ("0002 wrote `{7}`, this widens it"), and reading that as the live
 * constraint would let documentation decide a security property.
 */
function code(text: string): string {
  return text.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** `[2-9a-h]` → `23456789abcdefgh`; the SQL and the TS literal must be the same set. */
function expandCharClass(body: string): string {
  let out = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index + 1] === "-" && body[index + 2] !== undefined) {
      for (
        let char = body.charCodeAt(index);
        char <= body.charCodeAt(index + 2);
        char += 1
      ) {
        out += String.fromCharCode(char);
      }
      index += 2;
    } else {
      out += body[index];
    }
  }
  return out;
}

/**
 * The effective rule is whatever the newest migration that constrains each of
 * the two statements writes, because that file is the last to run. A missing
 * entry means nothing constrains that side any more, which the first test
 * treats as a failure rather than a vacuous pass.
 */
const codeRules = (() => {
  const latest = new Map<
    string,
    { file: string; alphabet: string; min: number; max: number }
  >();
  for (const file of migrations) {
    for (const match of code(file.text).matchAll(CODE_RULE)) {
      const declarer = match.groups?.declarer;
      const pattern = match.groups?.pattern;
      if (!declarer || !pattern) continue;
      const body = /\^\[([^\]]+)\](?:\{(\d+)(?:,(\d+))?\})?\$/.exec(pattern);
      if (!body) continue;
      latest.set(declarer, {
        file: file.name,
        alphabet: expandCharClass(body[1] as string),
        min: Number(body[2]),
        max: Number(body[3] ?? body[2]),
      });
    }
  }
  return [...latest.values()];
})();

/**
 * The replay below only models a function's privileges as they are *granted*,
 * so it has to know nothing re-grants a function behind its back. Supabase's
 * template does not; `alter default privileges … on functions` would.
 */
const DEFAULT_FUNCTION_GRANTS = migrations
  .map((file) => ({
    file: file.name,
    hits: code(file.text).match(
      /alter default privileges[^;]*\bfunctions\b[^;]*;/i,
    ),
  }))
  .filter((entry) => entry.hits);

/**
 * Effective `execute` per function, as the sequence of migrations leaves it.
 *
 * `grant execute on all functions in schema public to authenticated` is a
 * template convenience that appears at the bottom of more than one file, and it
 * reaches every function declared *up to that statement* — including the two
 * cross-account reminder views and the rate limiter, which no client may call.
 * The only thing standing between that line and a signed-in user reading every
 * account's address is the order the revokes run in, and order is exactly what
 * a hand-edited migration changes. Measured live on 2026-09-28: `authenticated`
 * could execute `due_reminders()`.
 *
 * So the privilege set is replayed here, in file order and statement order,
 * rather than asserted from whichever file happens to mention the function.
 */
const EXECUTE_EVENT =
  /create (?:or replace )?function (?:public\.)?([a-z_]+)|grant execute on all functions in schema public to ([a-z_]+)|revoke all on all functions in schema public from ([a-z_]+)|grant execute on function (?:public\.)?([a-z_]+)\([^)]*\) to ([a-z_,\s]+)|revoke all on function (?:public\.)?([a-z_]+)\([^)]*\) from ([a-z_,\s]+)/g;

function replayExecute(text: string): Map<string, Set<string>> {
  const effective = new Map<string, Set<string>>();
  const add = (name: string, role: string) => {
    if (!effective.has(name)) effective.set(name, new Set());
    effective.get(name)?.add(role);
  };
  const drop = (name: string, role: string) => {
    effective.get(name)?.delete(role);
  };
  for (const match of text.matchAll(EXECUTE_EVENT)) {
    const roles = (value: string) =>
      value
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean);
    if (match[1]) add(match[1], "owner");
    else if (match[2]) for (const name of effective.keys()) add(name, match[2]);
    else if (match[3])
      for (const name of effective.keys()) drop(name, match[3]);
    else if (match[4])
      for (const role of roles(match[5] ?? "")) add(match[4], role);
    else if (match[6])
      for (const role of roles(match[7] ?? "")) drop(match[6], role);
  }
  return effective;
}

/** The roles a request can arrive as — `service_role` and the owner are not clients. */
const CLIENT_ROLES = ["anon", "authenticated", "public"];

/** Client roles only — `service_role` and the owner are allowed everywhere here. */
function clientRolesFor(name: string, text: string): string[] {
  const roles = replayExecute(text).get(name) ?? new Set<string>();
  return [...roles].filter((role) => CLIENT_ROLES.includes(role)).sort();
}

const migratedSql = code(migrations.map((file) => file.text).join("\n"));

/**
 * The helpers the delivery function owns: they answer across accounts, so the
 * only role allowed to call them is the one holding the service key.
 */
const SERVICE_ONLY = ["due_reminders", "reminder_digest"];

describe("function grant replay", () => {
  it("holds no default function grants that could re-appear on a new function", () => {
    expect(DEFAULT_FUNCTION_GRANTS).toEqual([]);
  });

  it("leaves no client role able to execute the cross-account helpers", () => {
    for (const name of SERVICE_ONLY) {
      expect(clientRolesFor(name, migratedSql), name).toEqual([]);
    }
    // The limiter is called by security-definer functions, never by a client.
    expect(clientRolesFor("enforce_rate_limit", migratedSql)).toEqual([]);
  });

  it("keeps the two reminder helpers executable by the delivery function", () => {
    for (const name of SERVICE_ONLY) {
      const roles = replayExecute(migratedSql).get(name) ?? new Set<string>();
      expect(roles.has("service_role"), name).toBe(true);
    }
  });

  it("still gives every signed-in RPC its grant after the replay", () => {
    // The blanket grant is the house style; a walk-back that overshoots would
    // leave the adapter's own RPCs unexecutable, which is a 401-free 42501.
    for (const name of usedRpc) {
      const roles = replayExecute(migratedSql).get(name) ?? new Set<string>();
      expect(
        CLIENT_ROLES.some((role) => roles.has(role)),
        name,
      ).toBe(true);
    }
  });

  it("notices a walk-back that a later blanket grant undoes", () => {
    // The guard has to be able to fail, or reordering a migration stays silent:
    // same revokes, then the template grant after them.
    const outOfOrder = `${migratedSql}
grant execute on all functions in schema public to authenticated;`;
    expect(clientRolesFor("due_reminders", outOfOrder)).toEqual([
      "authenticated",
    ]);
  });
});

describe("short-code entropy contract", () => {
  it("finds both code rules and makes them state the same range", () => {
    // The table constraint and create_link's own validator. Fewer than two
    // means one of them stopped naming the range at all — which is how 0002
    // ended up copying 0001's `{7}` into a new function body.
    expect(codeRules.length).toBe(2);
    const [first, second] = codeRules as [
      (typeof codeRules)[number],
      (typeof codeRules)[number],
    ];
    expect(second.min).toBe(first.min);
    expect(second.max).toBe(first.max);
    expect(second.alphabet).toBe(first.alphabet);
  });

  it("mints a code the newest migration accepts", () => {
    for (const rule of codeRules) {
      expect(SHORT_CODE_LENGTH).toBeGreaterThanOrEqual(rule.min);
      expect(SHORT_CODE_LENGTH).toBeLessThanOrEqual(rule.max);
    }
  });

  it("uses the same alphabet in SQL and in TypeScript", () => {
    for (const rule of codeRules) {
      expect([...rule.alphabet].sort().join("")).toBe(
        [...SHORT_CODE_ALPHABET].sort().join(""),
      );
    }
  });

  it("keeps the public address at 48 bits or more", () => {
    const bits = SHORT_CODE_LENGTH * Math.log2(SHORT_CODE_ALPHABET.length);
    expect(Math.floor(bits)).toBeGreaterThanOrEqual(48);
  });

  it("keeps the mock backend on the same shape, so an imported archive cannot be rejected", () => {
    const mock = readFileSync(
      join(process.cwd(), "src", "mocks", "backend.ts"),
      "utf8",
    );
    const literal = mock.match(/randomAlphabet\("([a-z0-9]+)",\s*(\d+)\)/);
    expect(literal).not.toBeNull();
    expect(literal?.[1]).toBe(SHORT_CODE_ALPHABET);
    expect(Number(literal?.[2])).toBe(SHORT_CODE_LENGTH);
  });
});
