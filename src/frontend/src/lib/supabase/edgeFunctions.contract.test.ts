/**
 * The drift guard for the three Edge Functions.
 *
 * `supabase/functions/` is Deno, outside every frontend gate: nothing in
 * `pnpm test` reads it, and this machine has no Deno, so a regression there is
 * otherwise silent until the function is redeployed. These assertions run over
 * the source text, offline, and each one is paired with the mutated source it is
 * meant to reject — a guard that cannot fail is not a guard.
 *
 * The live behaviour is proven out of band, by the harness described in
 * `supabase/README.md` → The Edge Functions; this file only pins that the fix
 * stays in the code.
 *
 * Paths are built from `process.cwd()` because under jsdom `import.meta.url`
 * is an http URL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(process.cwd(), "..", "..");

function source(name: string): string {
  return readFileSync(
    join(repoRoot, "supabase", "functions", name, "index.ts"),
    "utf8",
  );
}

const proxy = source("ai-proxy");
const sender = source("reminder-sender");
const collector = source("csp-collector");

/**
 * The report fields the collector is allowed to forward.
 *
 * A CSP report also carries `user_agent` (a fingerprint), `originalPolicy` (a
 * copy of a policy this repository already has), `referrer` and `sampleSize`, and
 * the full blocked/document URLs whose paths are somebody's study pages. The
 * whitelist is asserted as a list rather than as "no forbidden name appears",
 * because the second kind of guard passes on a field nobody thought to forbid.
 */
const FORWARDED_REPORT_FIELDS = [
  "effectiveDirective",
  "violatedDirective",
  "blockedURL",
  "originalURL",
  "url",
  "documentURL",
  "disposition",
];

/** The string literal list inside `toForwarded`. */
function forwardedFieldList(text: string): string[] {
  const list = /for \(const field of \[([\s\S]*?)\]\)/.exec(text)?.[1] ?? "";
  // `_` is in the class because the fields a leak would use — `user_agent`,
  // `original_policy` — are the snake_case ones the Reporting API itself names.
  return [...list.matchAll(/"([A-Za-z_]+)"/g)].map((match) => match[1] ?? "");
}

/**
 * Every shape this file cares about, as a predicate. Each takes a source string
 * so the same rule can be run against a deliberately regressed copy.
 */
const rules = {
  /** A counter that dies with the isolate: N isolates, N x the cap. */
  inIsolateCounter: (text: string) => /new Map<string, number\[\]>/.test(text),
  /** The durable helper, called over PostgREST. */
  durableLimiter: (text: string) =>
    /\/rest\/v1\/rpc\/enforce_rate_limit/.test(text),
  /** The account is in the bucket name, which is what makes it per-account. */
  limiterPerAccount: (text: string) =>
    /p_bucket:\s*`ai_proxy:\$\{user\}`/.test(text),
  /** Counting needs a write to the table, so the service key — and only here. */
  limiterUsesServiceKey: (text: string) =>
    /SUPABASE_SERVICE_ROLE_KEY/.test(text) &&
    /overRateLimit[\s\S]{0,900}?apikey:\s*serviceKey/.test(text),
  /** A broken counter must not switch the AI Studio off. */
  limiterFailsOpen: (text: string) =>
    /catch\s*\{\s*\n?\s*return false;/.test(text) &&
    /detail\.includes\("RATE_LIMITED"\)/.test(text),
  /** The cap is enforced while reading, not after the whole body is buffered. */
  streamingBodyCap: (text: string) =>
    /reader\.cancel\(\)/.test(text) && /received > MAX_BODY_BYTES/.test(text),
  /** A shared secret compared so that latency says nothing about the match. */
  timingSafeSecret: (text: string) =>
    /secretsMatch\(bearer, cronSecret\)/.test(text) &&
    !/bearer === (?:cronSecret|Deno\.env\.get\("CRON_SECRET"\))/.test(text),
  /** "Send one now" is capped, and only that branch. */
  testSendCapped: (text: string) =>
    /recentTestSends\(user!\.id\)/.test(text) &&
    /alreadySent >= TEST_SEND_LIMIT/.test(text),
  dailyPathUncapped: (text: string) =>
    /if \(!isCron && !wantsDaily\)/.test(text),
  wildcardCors: (text: string) =>
    /"Access-Control-Allow-Origin":\s*"\*"/.test(text),
  /** The batch is truncated, so one caller cannot make 20 000 rows in a minute. */
  capsTheBatch: (text: string) =>
    /reports\.slice\(0, MAX_REPORTS_PER_BATCH\)/.test(text),
  /** Every forwarded string is clamped before it leaves the isolate. */
  clampsEachField: (text: string) =>
    /value\.slice\(0, MAX_FIELD_CHARS\)/.test(text),
  /**
   * The RPC's outcome never moves the status.
   *
   * A forged batch that learns "that one was dropped by the ceiling" has learned
   * the shape of the table, which is the thing the endpoint has no reason to
   * hand out. So the reply is `204` whether the RPC answered 200, 404 (0015 not
   * applied) or threw.
   */
  replyNeverReflectsTheUpstream: (text: string) =>
    /status: 204/.test(text) && !/status: res\.status/.test(text),
  /**
   * No inbound content-type gate.
   *
   * The Reporting API posts a CORS-safelisted `text/plain` body, so a function
   * that demanded `application/json` would reject every real violation and the
   * owner would read an empty table.
   */
  refusesNoContentType: (text: string) =>
    !/headers\.get\(\s*"content-type"\s*\)/.test(text),
};

describe("ai-proxy request cap", () => {
  it("counts in Postgres, not in the isolate", () => {
    expect(rules.inIsolateCounter(proxy)).toBe(false);
    expect(rules.durableLimiter(proxy)).toBe(true);
    // The control: this is exactly the shape the function had before.
    const regressed = proxy.replace(
      /async function overRateLimit[\s\S]*?\n}\n/,
      "const hits = new Map<string, number[]>();\nasync function overRateLimit(user: string) {\n  return (hits.get(user) ?? []).length > 20;\n}\n",
    );
    expect(regressed).not.toBe(proxy);
    expect(rules.durableLimiter(regressed)).toBe(false);
    expect(rules.inIsolateCounter(regressed)).toBe(true);
  });

  it("keys the window on the signed-in account", () => {
    expect(rules.limiterPerAccount(proxy)).toBe(true);
    const shared = proxy.replace(/`ai_proxy:\$\{user\}`/, '"ai_proxy"');
    expect(rules.limiterPerAccount(shared)).toBe(false);
  });

  it("counts with the service role, and uses it for nothing else", () => {
    expect(rules.limiterUsesServiceKey(proxy)).toBe(true);
    // One read of the key, in one function: the service role must not leak into
    // any other call this proxy makes.
    expect([
      ...proxy.matchAll(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/g),
    ]).toHaveLength(1);
  });

  it("fails open when the counter is broken, and only then", () => {
    expect(rules.limiterFailsOpen(proxy)).toBe(true);
    const failClosed = proxy.replace(
      /return detail\.includes\("RATE_LIMITED"\);/,
      "return true;",
    );
    expect(rules.limiterFailsOpen(failClosed)).toBe(false);
  });

  it("caps the body while reading it", () => {
    expect(rules.streamingBodyCap(proxy)).toBe(true);
    const buffered = proxy.replace(
      /async function readCappedText\([\s\S]*?\n}\n/,
      "async function readCappedText(request: Request) {\n  const text = await request.text();\n  return { tooLarge: text.length > MAX_BODY_BYTES, text };\n}\n",
    );
    expect(buffered).not.toBe(proxy);
    expect(rules.streamingBodyCap(buffered)).toBe(false);
  });
});

describe("reminder-sender request handling", () => {
  it("caps the body while reading it", () => {
    expect(rules.streamingBodyCap(sender)).toBe(true);
  });

  it("reads the cap before it resolves the caller", () => {
    expect(sender.indexOf("await readBody(request)")).toBeLessThan(
      sender.indexOf("await getAuthUser(bearer)"),
    );
  });

  it("compares the cron bearer without a timing signal", () => {
    expect(rules.timingSafeSecret(sender)).toBe(true);
    const plain = sender.replace(
      "secretsMatch(bearer, cronSecret)",
      "bearer === cronSecret",
    );
    expect(rules.timingSafeSecret(plain)).toBe(false);
  });

  it("caps a repeated test send and leaves the scheduled digest alone", () => {
    expect(rules.testSendCapped(sender)).toBe(true);
    expect(rules.dailyPathUncapped(sender)).toBe(true);
    const everySend = sender.replace("!isCron && !wantsDaily", "!isCron");
    expect(rules.dailyPathUncapped(everySend)).toBe(false);
    const noCap = sender.replace(
      /const alreadySent = await recentTestSends\(user!\.id\);/,
      "const alreadySent = 0;",
    );
    expect(rules.testSendCapped(noCap)).toBe(false);
  });

  it("counts test sends from the log every send already writes", () => {
    expect(sender).toMatch(
      /rest\/v1\/reminder_log\?select=id[\s\S]*?kind=eq\.test/,
    );
  });
});

describe("csp-collector reporting surface", () => {
  it("forwards exactly the fields worth recording", () => {
    expect(forwardedFieldList(collector)).toEqual(FORWARDED_REPORT_FIELDS);
    // The control: a field added to the whitelist has to be caught by this test,
    // not by whoever notices a fingerprint column later.
    const leaked = collector.replace(
      '"documentURL",',
      '"documentURL", "user_agent",',
    );
    expect(leaked).not.toBe(collector);
    expect(forwardedFieldList(leaked)).toContain("user_agent");
  });

  it("bounds the batch and every string in it", () => {
    expect(rules.capsTheBatch(collector)).toBe(true);
    expect(rules.clampsEachField(collector)).toBe(true);
    const unclamped = collector.replace(
      /value\.slice\(0, MAX_FIELD_CHARS\)/,
      "value",
    );
    expect(rules.clampsEachField(unclamped)).toBe(false);
  });

  it("caps the body while reading it", () => {
    expect(rules.streamingBodyCap(collector)).toBe(true);
  });

  it("refuses a foreign origin before it reads the body", () => {
    expect(
      collector.indexOf("!allowedOrigins().has(origin)"),
    ).toBeGreaterThanOrEqual(0);
    expect(collector.indexOf("!allowedOrigins().has(origin)")).toBeLessThan(
      collector.indexOf("await readCappedText(request)"),
    );
  });

  it("says nothing about what it did with the reports", () => {
    expect(rules.replyNeverReflectsTheUpstream(collector)).toBe(true);
    const honest = collector.replace(
      /return new Response\(null, \{ status: 204, headers: cors \}\);/,
      "return new Response(null, { status: res.status, headers: cors });",
    );
    expect(honest).not.toBe(collector);
    expect(rules.replyNeverReflectsTheUpstream(honest)).toBe(false);
  });

  it("accepts the body the Reporting API actually sends", () => {
    expect(rules.refusesNoContentType(collector)).toBe(true);
    const jsonOnly = collector.replace(
      "const read = await readCappedText(request);",
      'if (!request.headers.get("content-type")?.includes("application/json")) {\n    return new Response(null, { status: 415, headers: cors });\n  }\n  const read = await readCappedText(request);',
    );
    expect(jsonOnly).not.toBe(collector);
    expect(rules.refusesNoContentType(jsonOnly)).toBe(false);
  });

  it("holds the service key for one call, and never puts it in a reply", () => {
    expect([
      ...collector.matchAll(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/g),
    ]).toHaveLength(1);
    expect(collector).toMatch(/rest\/v1\/rpc\/record_csp_violations/);
    expect(collector).toMatch(/p_reports:/);
  });

  it("names the migration that owns the table it writes", () => {
    // The collector 404s against a project without 0015, and an empty table then
    // reads as "nothing is blocked" — so the deploy order is documented, not
    // inferred from the RPC name alone.
    expect(collector).toMatch(/0015_csp_violation_reports\.sql/);
  });
});

describe("every function on the wire", () => {
  it("never answers with a wildcard origin", () => {
    for (const [name, text] of [
      ["ai-proxy", proxy],
      ["reminder-sender", sender],
      ["csp-collector", collector],
    ]) {
      expect(rules.wildcardCors(text), name).toBe(false);
    }
  });

  it("imports nothing remotely, so the deployed bundle boots", () => {
    for (const [name, text] of [
      ["ai-proxy", proxy],
      ["reminder-sender", sender],
      ["csp-collector", collector],
    ]) {
      expect(/^\s*import .* from ["']https?:/m.test(text), name).toBe(false);
    }
  });
});
