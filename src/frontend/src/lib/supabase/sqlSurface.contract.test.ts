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

  it("puts the floor, not just the minted length, above 48 bits", () => {
    // `create_link` is granted to `anon`, so the shortest code the database
    // agrees to accept is the one an attacker gets to choose. Through 0013 that
    // range read `{7,12}`: the client minted ten characters and nothing stopped
    // a caller from planting a 34.7-bit address in the same public table. The
    // minimum is the security property; the maximum is a formatting one.
    for (const rule of codeRules) {
      const weakest = rule.min * Math.log2(rule.alphabet.length);
      expect(
        Math.floor(weakest),
        `${rule.file} allows a ${rule.min}-character code`,
      ).toBeGreaterThanOrEqual(48);
    }
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

/**
 * The throttle is the only thing between an anonymous caller and a patient
 * brute force of a public share code, and it is only as strong as the address it
 * keys on. `x-forwarded-for` arrives as `caller-written…, real peer`, so the
 * first element is attacker-chosen: measured on the live project, 25 calls
 * carrying 25 invented addresses were 25 separate buckets and none was limited.
 * 0011 reads `cf-connecting-ip`, which Cloudflare writes and refuses to pass
 * through from a client. This is the guard that fails if a later migration
 * re-declares the limiter and reaches for the leftmost element again.
 */
describe("client-address contract", () => {
  /** The body of the newest `enforce_rate_limit` declaration — the live one. */
  const limiterBody = (() => {
    let found: string | null = null;
    for (const file of migrations) {
      const match = file.text.match(
        /create or replace function public\.enforce_rate_limit[\s\S]*?\$body\$([\s\S]*?)\$body\$;/,
      );
      if (match?.[1]) found = match[1];
    }
    return found;
  })();

  it("has a limiter declaration to read at all", () => {
    expect(
      limiterBody,
      "no $body$-delimited enforce_rate_limit in any migration",
    ).not.toBeNull();
  });

  it("never keys a window on the caller-written leftmost x-forwarded-for element", () => {
    expect(limiterBody).not.toMatch(
      /split_part\([^)]*x-forwarded-for[^)]*,\s*1\s*\)/,
    );
  });

  it("keys the window on the address the edge vouches for", () => {
    expect(limiterBody).toContain("cf-connecting-ip");
  });

  it("keeps TRUNCATE out of the client roles, in stored grants and in defaults", () => {
    // RLS does not constrain TRUNCATE, so a grant of it to `authenticated` is a
    // cross-account wipe that no policy can stop. The statement is assembled —
    // `%s` carries the privilege list, because MAINTAIN only exists on 17 and up
    // — so the contract is that list plus both revoke targets, not one literal.
    const lockdown = migrations
      .filter((file) => /alter default privileges/i.test(code(file.text)))
      .at(-1);
    expect(
      lockdown,
      "no migration touches default table privileges",
    ).toBeDefined();
    const text = code(lockdown?.text ?? "");
    expect(text).toMatch(/\btruncate\b/i);
    expect(text).toMatch(/revoke[^;]*on table[^;]*from anon, authenticated/i);
    expect(text).toMatch(
      /alter default privileges[^;]*revoke[^;]*on tables from anon, authenticated/i,
    );
  });
});

/**
 * `report_link_abuse` is the one public RPC that answers a question about a link
 * the caller does not own. Through 0013 it was unthrottled and it distinguished
 * an issued code (`{"ok":null}`) from one never issued (`{"err":"notFound"}`),
 * which made the report form on `/r/:code` a free "does this short code exist?"
 * service — the same endpoint #116 is spending effort making hard to guess. Both
 * properties are readable from the newest declaration, so both are pinned here
 * rather than left to the live battery, which cannot run on this machine.
 */
describe("abuse report contract", () => {
  /** The body of the newest `report_link_abuse` declaration — the live one. */
  function abuseBody(text: string): string | null {
    let found: string | null = null;
    for (const match of text.matchAll(
      /create (?:or replace )?function (?:public\.)?report_link_abuse[\s\S]*?\$\$([\s\S]*?)\$\$/g,
    )) {
      if (match[1]) found = match[1];
    }
    return found;
  }

  const body = abuseBody(code(sql));

  it("has an abuse declaration to read at all", () => {
    expect(body, "no $$-delimited report_link_abuse in any migration").not.toBeNull();
  });

  it("gives a caller no reply that distinguishes an issued code from a guess", () => {
    // Comments are already stripped, so this is the code path and not the prose
    // that explains why the old answer had to go.
    expect(body).not.toMatch(/notFound/);
  });

  it("throttles before it touches the link table", () => {
    const text = body ?? "";
    expect(text).toContain("enforce_rate_limit");
    expect(text.indexOf("enforce_rate_limit")).toBeLessThan(
      text.search(/\bupdate\s+link\b/i),
    );
  });

  it("files a report only for a code that exists", () => {
    // The reply cannot say "miss", so the guard belongs here: an unconditional
    // insert would let a stranger grow `abuse_report` one row per request.
    expect(body).toMatch(/if\s+found\s+then[\s\S]*?insert into abuse_report/i);
  });

  it("notices a later migration that answers notFound again", () => {
    // The guard has to be able to fail: same function, restated with the
    // distinguishing branch 0013 removed.
    const regressed = `${code(sql)}
create or replace function report_link_abuse(p_code text, p_reason text) returns jsonb language plpgsql security definer as $$
begin
  if not exists (select 1 from link where code = p_code) then
    return jsonb_build_object('err', jsonb_build_object('notFound', null));
  end if;
  return jsonb_build_object('ok', null);
end
$$;`;
    expect(abuseBody(regressed)).toMatch(/notFound/);
  });
});

/**
 * `record_csp_violations` (0015) is the one RPC the browser calls anonymously to
 * write a row, and its input is a report the caller can invent. Everything that
 * keeps that harmless is readable from the newest declaration, so it is pinned
 * here: the grant set, the ceiling, the shape the table refuses to hold, and the
 * route rewrite that keeps `/r/<code>` and `/manage/<token>` out of it.
 */
describe("csp violation contract", () => {
  /** The body of the newest `record_csp_violations` declaration. */
  function violationBody(text: string): string | null {
    let found: string | null = null;
    for (const match of text.matchAll(
      /create (?:or replace )?function (?:public\.)?record_csp_violations[\s\S]*?\$\$([\s\S]*?)\$\$/g,
    )) {
      if (match[1]) found = match[1];
    }
    return found;
  }

  const body = violationBody(code(sql));
  const createTable = code(sql).match(
    /create table if not exists csp_violation[\s\S]*?\);/,
  )?.[0];

  it("has a violation declaration to read at all", () => {
    expect(body, "no $$-delimited record_csp_violations in any migration").not.toBeNull();
  });

  it("is executable by the delivery function and by nobody else", () => {
    // The 0006 mistake restated: a helper that only a service caller should use,
    // handed to `authenticated` by a blanket grant, becomes a public endpoint.
    const grants = [...code(sql).matchAll(/on function record_csp_violations\(jsonb\)\s+to\s+([a-z_,\s]+)/gi)]
      .flatMap((match) => (match[1] ?? "").split(","))
      .map((role) => role.trim())
      .filter((role) => role !== "");
    expect(grants).toEqual(["service_role"]);
    for (const role of ["anon", "authenticated"]) {
      expect(code(sql)).toMatch(
        new RegExp(`revoke all on function record_csp_violations\(jsonb\) from ${role}`, "i"),
      );
    }
  });

  it("stores one row per violation, not one row per report", () => {
    // An anonymous caller can reload a page as often as it likes. Without the
    // natural key and the upsert, that is a row per request in a table nobody
    // reads programmatically.
    expect(createTable).toMatch(
      /primary key \(directive, blocked_host, route, disposition\)/,
    );
    expect(body).toMatch(
      /on conflict \(directive, blocked_host, route, disposition\)\s+do update set hits/u,
    );
  });

  it("keeps the two halves of the batch collapse, or a duplicate is an error", () => {
    // `insert … on conflict do update` that touches one target row twice raises,
    // and a browser may put two identical reports in one array. So the batch is
    // grouped before it is inserted, and the count arrives as `excluded.hits`.
    expect(body).toMatch(/group by 1, 2, 3, 4/i);
    expect(body).toMatch(/csp_violation\.hits \+ excluded\.hits/i);
    expect(body).not.toMatch(/csp_violation\.hits \+ 1/i);
  });

  it("refuses to store what identifies a visitor", () => {
    // `user_agent` and `originalPolicy` are in every report, and both are either
    // a fingerprint or a megabyte. A body that selects them turns a telemetry
    // table into a visitor log.
    for (const field of ["user_agent", "originalPolicy", "referrer"]) {
      expect(body, `${field} must never be read out of a report`).not.toContain(
        field,
      );
    }
  });

  it("replaces the capability-bearing segment of a page before storing it", () => {
    // `/r/<code>`, `/manage/<token>` and `/shared/<token>` name a real object,
    // and this table is readable by anyone with the SQL editor.
    expect(body).toContain("^/(r|manage|shared)/[^/]+");
  });

  it("bounds the table against a caller who invents new violations", () => {
    // Every field of a report is the caller's choice, so without a ceiling the
    // distinct-tuple argument above is only a bound on honest traffic.
    expect(body).toMatch(/count\(\*\) >= 5000 from csp_violation/i);
    expect(createTable).toMatch(/char_length\(route\) +between 1 and 120/u);
  });

  it("throttles the batch before it writes, and still runs without 0002", () => {
    // The `exists` guard on `pg_proc` is 0003/0004's shape: this file has to be
    // applyable to a project that never installed the limiter.
    expect(body).toMatch(/enforce_rate_limit/i);
    expect(body).toMatch(/from pg_proc/i);
    expect(body.indexOf("enforce_rate_limit")).toBeLessThan(
      body.search(/\binsert into csp_violation\b/i),
    );
  });

  it("notices a later migration that hands the helper to a client role", () => {
    // The negative control: 0006's blanket grant, aimed at this function.
    const regressed = `${code(sql)}
grant execute on all functions in schema public to authenticated;`;
    const granted = [
      ...regressed.matchAll(
        /grant execute on all functions in schema public to ([a-z_,\s]+)/gi,
      ),
    ].map((match) => match[1] ?? "");
    expect(granted.join(",")).toMatch(/authenticated/);
    expect(sqlFunctions).toContain("record_csp_violations");
  });
});
