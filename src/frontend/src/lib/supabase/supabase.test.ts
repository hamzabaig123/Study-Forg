import { getSupabase, supabaseAvailable } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/env";
import {
  newEditToken,
  newShareToken,
  newShortCode,
  tokenHash,
} from "@/lib/supabase/tokens";
import { describe, expect, it } from "vitest";

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
    expect(newShortCode()).toMatch(/^[2-9a-hjkmnp-z]{7}$/);
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
