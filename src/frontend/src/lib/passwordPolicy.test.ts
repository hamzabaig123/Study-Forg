/**
 * The password floor is one number with three callers and one documented
 * owner. Each of those can drift on its own, and every drift is silent: a
 * dashboard policy change leaves the browser promising eight while the server
 * refuses it, and a code change leaves README describing a policy nobody
 * enforces. This test reads the sources and the document and pins them
 * together — the same style as `supabase/sqlSurface.contract.test.ts`.
 *
 * The breach check lives here too, because it is the other half of what this
 * module promises about a password.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  breachReason,
  passwordLengthError,
} from "./passwordPolicy";

const source = (relative: string) =>
  readFileSync(join(process.cwd(), "src", relative), "utf8");

describe("password policy", () => {
  it("is the number the deployed project enforces", () => {
    // supabase/README.md → "Auth settings a deployed project needs" records what
    // `PATCH /config/auth` set on the live project and what GoTrue then answers.
    const readme = readFileSync(
      join(process.cwd(), "..", "..", "supabase", "README.md"),
      "utf8",
    );
    const documented =
      /Password policy[\s\S]{0,600}?It is now \*\*(\d+)\*\*/.exec(readme);
    expect(
      documented,
      "README no longer states the live password floor",
    ).not.toBeNull();
    expect(Number(documented?.[1])).toBe(MIN_PASSWORD_LENGTH);
  });

  it("refuses under the floor and accepts at it", () => {
    expect(passwordLengthError("x".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      PASSWORD_POLICY_MESSAGE,
    );
    expect(
      passwordLengthError("x".repeat(MIN_PASSWORD_LENGTH)),
    ).toBeUndefined();
    expect(
      passwordLengthError("x".repeat(MAX_PASSWORD_LENGTH)),
    ).toBeUndefined();
    expect(passwordLengthError("x".repeat(MAX_PASSWORD_LENGTH + 1))).toBe(
      PASSWORD_POLICY_MESSAGE,
    );
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(10);
  });

  it("is read from this module by every caller, never re-hardcoded", () => {
    for (const [file, needle] of [
      ["lib/localAuth.ts", "MIN_PASSWORD_LENGTH"],
      ["lib/supabase/session.ts", "passwordLengthError"],
      // The breach check has to sit in the store, not the form: every path that
      // sets a password runs through `assertNewPassword`, and a form-only check
      // is one a future screen can forget.
      ["lib/supabase/session.ts", "breachReason"],
      ["pages/AuthPage.tsx", "MIN_PASSWORD_LENGTH"],
    ] as const) {
      expect(source(file), `${file} no longer uses the shared floor`).toContain(
        needle,
      );
    }
    // A numeric `minLength` in the form is a floor that will drift; the reset
    // screen and the sign-up screen both have to take it from here.
    expect(source("pages/AuthPage.tsx")).not.toMatch(/minLength=\{[0-9]+\}/);
    expect(
      source("pages/AuthPage.tsx").match(/minLength=\{MIN_PASSWORD_LENGTH\}/g),
    ).toHaveLength(4);
  });
});

/**
 * `breachReason` is the k-anonymity half of the policy: what leaves the machine
 * is five hex characters, and what comes back is a count. Both halves matter —
 * a lookup that sent the digest would be a worse leak than the weak password it
 * prevents, and a lookup that failed closed would lock everyone out the day the
 * corpus is unreachable.
 */
describe("breachReason", () => {
  const password = "studyforge-ada";

  async function sha1Hex(text: string): Promise<string> {
    const bytes = new Uint8Array(
      await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)),
    );
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  function corpus(body: string, ok = true) {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => ({
      ok,
      text: async () => body,
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends five hex characters of the digest and nothing else", async () => {
    const digest = await sha1Hex(password);
    const fetchMock = corpus("0000000000000000000000:1");

    await breachReason(password);

    // vi.fn with an async implementation types each call as a 2-arg list,
    // but the inference lands on an empty tuple without an annotation — say it.
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${digest.slice(0, 5)}`,
    );
    expect(String(url)).not.toContain(digest);
    expect(String(url)).not.toContain(password);
    // A cached entry would tell anyone sharing the cache which prefixes people
    // are typing.
    expect(init).toEqual({ cache: "no-store" });
  });

  it("names the count when the corpus already has the password", async () => {
    const digest = await sha1Hex(password);
    // The corpus answers suffixes in upper case and the range is sorted; match
    // in lower case too, so the check does not depend on that formatting.
    corpus(`${digest.slice(5).toLowerCase()}:224770`);

    const reason = await breachReason(password);

    expect(reason).toContain("already public");
    expect(reason).toContain((224770).toLocaleString());
  });

  it("says nothing about a password the range does not carry", async () => {
    const digest = await sha1Hex(password);
    corpus(`${digest.slice(5, 10).toUpperCase()}00000:9`);

    await expect(breachReason(password)).resolves.toBeUndefined();
  });

  it("fails open when the corpus is unreachable or answers an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(breachReason(password)).resolves.toBeUndefined();

    corpus("", false);
    await expect(breachReason(password)).resolves.toBeUndefined();
  });

  it("does not ask about an empty password", async () => {
    const fetchMock = corpus("");

    await expect(breachReason("")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
