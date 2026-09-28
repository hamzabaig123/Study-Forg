/**
 * The local account store, tested on its own because it is the only thing
 * standing between a shared browser and someone else's study data: a verifier
 * that can be bypassed, a session that never expires, or a session another tab
 * can forge are all worth more coverage than the screens that call them.
 */

import {
  ACCOUNTS_KEY,
  SESSION_KEY,
  getSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  startDemoAccount,
  verifyCurrentAccount,
} from "@/lib/localAuth";
import {
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "@/lib/passwordPolicy";
import { beforeEach, describe, expect, it } from "vitest";

const PASSWORD = "Newton's-third-law";

async function register(email = "newton@example.com") {
  return registerAccount({
    name: "Isaac Newton",
    email,
    password: PASSWORD,
    passwordConfirmation: PASSWORD,
  });
}

/** A session written by an older build, or by a tab that has no business. */
function writeSession(accountId: string, createdAt: string) {
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ accountId, token: "forged-token", createdAt }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("local accounts", () => {
  it("stores a derived verifier, never the password", async () => {
    const account = await register();

    expect(account.passwordHash).not.toBe(PASSWORD);
    expect(account.passwordHash).toHaveLength(64);
    expect(account.salt).toHaveLength(32);
    const stored = window.localStorage.getItem(ACCOUNTS_KEY) ?? "";
    expect(stored).not.toContain(PASSWORD);
    expect(stored).toContain(account.passwordHash);
  });

  it("signs in, and signing out takes the session with it", async () => {
    const account = await register();
    logoutAccount();
    expect(getSession()).toBeNull();

    const signedIn = await loginAccount("newton@example.com", PASSWORD);
    expect(signedIn.id).toBe(account.id);
    const session = getSession();
    expect(session?.accountId).toBe(account.id);
    // A fresh random token per sign-in, so a stolen one does not outlive the tab.
    expect(session?.token).not.toBe("forged-token");

    logoutAccount();
    expect(getSession()).toBeNull();
  });

  it("rejects a wrong password and an unknown address the same way", async () => {
    const account = await register();

    await expect(
      loginAccount("newton@example.com", "Kepler's-eighth-law"),
    ).rejects.toThrow("Incorrect email or password.");
    await expect(loginAccount("kepler@example.com", PASSWORD)).rejects.toThrow(
      "Incorrect email or password.",
    );
    // Registering signed this account in, and a failed attempt must not be a
    // way of signing somebody else out.
    expect(getSession()?.accountId).toBe(account.id);

    logoutAccount();
    await expect(
      loginAccount("newton@example.com", "Kepler's-eighth-law"),
    ).rejects.toThrow("Incorrect email or password.");
    expect(getSession()).toBeNull();
  });

  it("cannot be signed into with the demo account, which has no password", async () => {
    startDemoAccount();
    await expect(
      loginAccount("demo@studyforge.local", "anything at all"),
    ).rejects.toThrow("Incorrect email or password.");
  });

  it("refuses a registration that would leave the account unsafe", async () => {
    await register();

    await expect(
      registerAccount({
        name: "Copycat",
        email: "newton@example.com",
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      }),
    ).rejects.toThrow("An account already uses this email address.");
    await expect(
      registerAccount({
        name: "Short",
        email: "short@example.com",
        password: "abc123",
        passwordConfirmation: "abc123",
      }),
    ).rejects.toThrow(PASSWORD_POLICY_MESSAGE);
    // One character under the live floor, so the number cannot drift back to the
    // eight this project used to accept and the server refused.
    await expect(
      registerAccount({
        name: "Almost",
        email: "almost@example.com",
        password: "x".repeat(MIN_PASSWORD_LENGTH - 1),
        passwordConfirmation: "x".repeat(MIN_PASSWORD_LENGTH - 1),
      }),
    ).rejects.toThrow(PASSWORD_POLICY_MESSAGE);
    await expect(
      registerAccount({
        name: "Echo",
        email: "echo@example.com",
        password: "echo@example.com",
        passwordConfirmation: "echo@example.com",
      }),
    ).rejects.toThrow("Your password cannot be your email address.");
    await expect(
      registerAccount({
        name: "Mismatch",
        email: "mismatch@example.com",
        password: PASSWORD,
        passwordConfirmation: "something else entirely",
      }),
    ).rejects.toThrow("Passwords do not match.");
    expect(
      JSON.parse(window.localStorage.getItem(ACCOUNTS_KEY) ?? "[]"),
    ).toHaveLength(1);
  });

  it("drops a session once it is older than the sign-in window", async () => {
    const account = await register();
    const thirtyOneDays = 31 * 86_400_000;
    writeSession(
      account.id,
      new Date(Date.now() - thirtyOneDays).toISOString(),
    );

    expect(getSession()).toBeNull();
    // Cleared rather than merely ignored, so nothing re-reads it later.
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("keeps a session inside the window and survives a broken one", async () => {
    const account = await register();
    writeSession(account.id, new Date().toISOString());
    expect(getSession()?.token).toBe("forged-token");

    window.localStorage.setItem(SESSION_KEY, "{not a session");
    expect(getSession()).toBeNull();

    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ token: "no account here" }),
    );
    expect(getSession()).toBeNull();
  });

  it("verifies the signed-in account only, and only through its own id", async () => {
    const first = await register("first@example.com");
    await register("second@example.com");
    logoutAccount();

    expect(() => verifyCurrentAccount()).toThrow("Sign in first.");

    writeSession(first.id, new Date().toISOString());
    verifyCurrentAccount();

    const accounts = JSON.parse(
      window.localStorage.getItem(ACCOUNTS_KEY) ?? "[]",
    ) as Array<{ email: string; emailVerified: boolean }>;
    expect(
      accounts.find((item) => item.email === "first@example.com"),
    ).toMatchObject({ emailVerified: true });
    expect(
      accounts.find((item) => item.email === "second@example.com"),
    ).toMatchObject({ emailVerified: false });
  });
});
