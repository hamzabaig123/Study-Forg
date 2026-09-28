/**
 * The password floor is one number with three callers and one documented
 * owner. Each of those can drift on its own, and every drift is silent: a
 * dashboard policy change leaves the browser promising eight while the server
 * refuses it, and a code change leaves README describing a policy nobody
 * enforces. This test reads the sources and the document and pins them
 * together — the same style as `supabase/sqlSurface.contract.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
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
