import { readFileSync, readdirSync } from "node:fs";
import { getSupabase, supabaseAvailable } from "@/lib/supabase/client";
import {
  SUPABASE_CONFIGURED,
  readSupabaseConfig,
  selectDataBackend,
} from "@/lib/supabase/env";
import {
  SHORT_CODE_LENGTH,
  newEditToken,
  newShareToken,
  newShortCode,
  tokenHash,
} from "@/lib/supabase/tokens";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("share token hashing", () => {
  it("produces the lowercase hex sha256 of the token", async () => {
    // Published vector for "abc": a wrong digest silently breaks every share
    // link, because the database only ever sees this value.
    await expect(tokenHash("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is stable and never returns the token itself", async () => {
    const token = newShareToken("share");
    const first = await tokenHash(token);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await tokenHash(token)).toBe(first);
    expect(first).not.toContain(token.slice(0, 8));
  });
});

describe("token generators", () => {
  it("keeps the shapes the routes and the canister contract expect", () => {
    expect(newShortCode()).toMatch(
      new RegExp(`^[2-9a-hjkmnp-z]{${SHORT_CODE_LENGTH}}$`),
    );
    expect(newEditToken()).toMatch(/^[A-HJ-NP-Za-km-z2-9]{32}$/);
    expect(newShareToken("note")).toMatch(/^note_[a-z0-9]{24}$/);
  });

  it("does not repeat a token across runs", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      seen.add(newEditToken());
    }
    expect(seen.size).toBe(200);
  });
});

describe("data backend selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes the explicit choice over everything else", () => {
    vi.stubEnv("VITE_DATA_BACKEND", "supabase");
    vi.stubEnv("VITE_USE_MOCK", "true");
    expect(selectDataBackend()).toBe("supabase");
  });

  it("keeps the mock for the development server and the suite", () => {
    vi.stubEnv("VITE_DATA_BACKEND", "");
    vi.stubEnv("VITE_USE_MOCK", "true");
    expect(selectDataBackend()).toBe("mock");
  });

  it("falls back to the canister when no project is configured", () => {
    vi.stubEnv("VITE_DATA_BACKEND", "");
    vi.stubEnv("VITE_USE_MOCK", "false");
    expect(selectDataBackend()).toBe(
      SUPABASE_CONFIGURED ? "supabase" : "canister",
    );
  });

  it("ignores a name that is not a backend", () => {
    vi.stubEnv("VITE_DATA_BACKEND", "postgres");
    vi.stubEnv("VITE_USE_MOCK", "true");
    expect(selectDataBackend()).toBe("mock");
  });
});

/**
 * The one cross-check between the TypeScript side and the SQL side that needs
 * neither Postgres nor a project: argument names.
 *
 * A `p_` name the adapter invents is not a compile error and not a failing test —
 * it is a function that gets `null` for a parameter it never sent, which surfaces
 * as a wrong answer or a cast error at runtime. Reading the migration's signatures
 * here turns that class of drift into a test failure, and nothing more: names
 * matching says nothing about values, reply shapes or behaviour.
 */
describe("adapter and migration share one rpc surface", () => {
  // Vitest sets the working directory to this config's root, which is also where
  // `pnpm test` runs from; `import.meta.url` is not usable here because jsdom
  // rewrites it to an http URL.
  const root = process.cwd();
  const migration = `${root}/../../supabase/migrations/0001_init.sql`;
  const sql = readFileSync(migration, "utf8");
  const signatures = new Map<string, string[]>();
  for (const match of sql.matchAll(/create function (\w+)\(([^)]*)\)/g)) {
    signatures.set(
      match[1],
      match[2]
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter((name) => name.startsWith("p_")),
    );
  }

  const slicesDir = `${root}/src/lib/supabase/slices`;
  const calls = [
    ...readdirSync(slicesDir).flatMap((file) => {
      const source = readFileSync(`${slicesDir}/${file}`, "utf8");
      return [
        ...source.matchAll(
          /(?:rpcEnvelope\(transport,|transport\.rpc\()\s*"(\w+)"\s*,?\s*\{([\s\S]*?)\n\s*\}\s*\)/g,
        ),
      ].map((match) => ({
        function: match[1],
        args: [...match[2].matchAll(/(p_\w+)\s*:/g)].map((a) => a[1]),
      }));
    }),
  ];

  it("finds the call sites it is about to check", () => {
    // Guards against a regex that quietly stopped matching anything.
    expect(calls.length).toBeGreaterThanOrEqual(13);
  });

  it("calls only functions the migration creates", () => {
    const missing = calls
      .filter((call) => !signatures.has(call.function))
      .map((call) => call.function);
    expect(missing).toEqual([]);
  });

  it("sends every parameter by the name the function declares", () => {
    const drift = calls.flatMap((call) => {
      const declared = signatures.get(call.function);
      if (!declared) {
        return [];
      }
      const absent = declared.filter((name) => !call.args.includes(name));
      const invented = call.args.filter((name) => !declared.includes(name));
      return absent.length || invented.length
        ? [`${call.function}: sends [${call.args}] vs [${declared}]`]
        : [];
    });
    expect(drift).toEqual([]);
  });
});

describe("connection settings", () => {
  const url = "https://exampleproject.supabase.co";
  // Shape of a publishable key: long, single segment, `sb_publishable_` prefix.
  const key = `sb_publishable_${"a".repeat(43)}`;

  it("treats an absent configuration as 'not configured', not as an error", () => {
    expect(readSupabaseConfig(undefined, undefined)).toEqual({
      url: "",
      key: "",
      configured: false,
      problem: null,
    });
  });

  it("accepts a project URL with a full publishable key", () => {
    expect(readSupabaseConfig(url, key)).toEqual({
      url,
      key,
      configured: true,
      problem: null,
    });
  });

  it("names a truncated key instead of letting every request fail with 401", () => {
    const result = readSupabaseConfig(url, "sb_publishable_shortpaste");
    expect(result.configured).toBe(false);
    expect(result.problem).toMatch(/truncated/i);
  });

  it("rejects a URL from another host", () => {
    expect(
      readSupabaseConfig("https://not-supabase.example.com", key).problem,
    ).toMatch(/project URL/i);
  });

  it("refuses to build a client while the project is unusable", () => {
    if (supabaseAvailable) {
      // Configured on this machine through .env.local, so there is nothing to assert.
      return;
    }
    expect(() => getSupabase()).toThrow(/not configured|truncated|not set/i);
  });
});
