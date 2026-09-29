/**
 * The drift guard for the two Edge Functions.
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

describe("both functions on the wire", () => {
  it("never answers with a wildcard origin", () => {
    for (const [name, text] of [
      ["ai-proxy", proxy],
      ["reminder-sender", sender],
    ]) {
      expect(rules.wildcardCors(text), name).toBe(false);
    }
  });

  it("imports nothing remotely, so the deployed bundle boots", () => {
    for (const [name, text] of [
      ["ai-proxy", proxy],
      ["reminder-sender", sender],
    ]) {
      expect(/^\s*import .* from ["']https?:/m.test(text), name).toBe(false);
    }
  });
});
