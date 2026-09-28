/**
 * Local development account store. It deliberately keeps credentials out of
 * the rendered application and uses PBKDF2 before persisting a verifier.
 *
 * A production deployment must replace this adapter with the server-side
 * session API described in the security specification; browser storage cannot
 * provide HttpOnly cookies, email delivery, or cross-device sessions.
 */
export interface LocalAccount {
  id: string;
  name: string;
  email: string;
  salt: string;
  passwordHash: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthSession {
  accountId: string;
  token: string;
  createdAt: string;
}

import { safeRemoveItem, safeSetItem } from "@/lib/localStore";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from "@/lib/passwordPolicy";

export const ACCOUNTS_KEY = "studyforge.personal-accounts.v1";
export const SESSION_KEY = "studyforge.personal-session.v1";
const CHANGE_EVENT = "studyforge-auth-change";
const MS_PER_DAY = 86_400_000;
/** How long a locally stored sign-in stays valid before it must be repeated. */
const SESSION_DAYS = 30;
const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
function randomHex(length = 24) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function passwordHash(password: string, salt: string) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 210_000,
      hash: "SHA-256",
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}
function getAccounts(): LocalAccount[] {
  try {
    return JSON.parse(
      localStorage.getItem(ACCOUNTS_KEY) ?? "[]",
    ) as LocalAccount[];
  } catch {
    return [];
  }
}
export function getAccountsSnapshot() {
  return localStorage.getItem(ACCOUNTS_KEY) ?? "[]";
}
function saveAccounts(accounts: LocalAccount[]) {
  safeSetItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}
function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function getSessionSnapshot() {
  return localStorage.getItem(SESSION_KEY) ?? "null";
}
function writeSession(accountId: string) {
  safeSetItem(
    SESSION_KEY,
    JSON.stringify({
      accountId,
      token: randomHex(32),
      createdAt: new Date().toISOString(),
    }),
  );
}
export function getSession(): AuthSession | null {
  let session: AuthSession | null;
  try {
    session = JSON.parse(getSessionSnapshot()) as AuthSession | null;
  } catch {
    return null;
  }
  if (!session?.accountId) {
    return null;
  }
  const issuedAt = Date.parse(session.createdAt);
  if (
    !Number.isFinite(issuedAt) ||
    Date.now() - issuedAt > SESSION_DAYS * MS_PER_DAY
  ) {
    safeRemoveItem(SESSION_KEY);
    return null;
  }
  return session;
}
export function getCurrentAccount(): LocalAccount | null {
  const session = getSession();
  return session
    ? (getAccounts().find((account) => account.id === session.accountId) ??
        null)
    : null;
}

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}) {
  const email = input.email.trim().toLowerCase();
  if (!input.name.trim()) throw new Error("Enter your name.");
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw new Error("Enter a valid email address.");
  if (
    input.password.length < MIN_PASSWORD_LENGTH ||
    input.password.length > MAX_PASSWORD_LENGTH
  )
    throw new Error(PASSWORD_POLICY_MESSAGE);
  if (input.password.toLowerCase() === email)
    throw new Error("Your password cannot be your email address.");
  if (input.password !== input.passwordConfirmation)
    throw new Error("Passwords do not match.");
  const accounts = getAccounts();
  if (accounts.some((account) => account.email === email))
    throw new Error("An account already uses this email address.");
  const salt = randomHex(16);
  const account: LocalAccount = {
    id: randomHex(16),
    name: input.name.trim(),
    email,
    salt,
    passwordHash: await passwordHash(input.password, salt),
    emailVerified: false,
    createdAt: new Date().toISOString(),
  };
  saveAccounts([...accounts, account]);
  writeSession(account.id);
  notify();
  return account;
}
export async function loginAccount(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const account = getAccounts().find((candidate) => candidate.email === email);
  const hash = await passwordHash(
    password,
    account?.salt ?? "unknown-account-salt",
  );
  // The demo record is created with an empty verifier; no password may match it.
  if (!account?.passwordHash || hash !== account.passwordHash)
    throw new Error("Incorrect email or password.");
  writeSession(account.id);
  notify();
  return account;
}
export function verifyCurrentAccount() {
  const account = getCurrentAccount();
  if (!account) throw new Error("Sign in first.");
  saveAccounts(
    getAccounts().map((item) =>
      item.id === account.id ? { ...item, emailVerified: true } : item,
    ),
  );
  notify();
}
export function logoutAccount() {
  safeRemoveItem(SESSION_KEY);
  notify();
}
/** A verified, local-only account for trying the app without registration. */
export function startDemoAccount() {
  const email = "demo@studyforge.local";
  let account = getAccounts().find((item) => item.email === email);
  if (!account) {
    account = {
      id: "studyforge-demo-account",
      name: "Demo Student",
      email,
      salt: "",
      passwordHash: "",
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
    saveAccounts([...getAccounts(), account]);
  }
  writeSession(account.id);
  notify();
  return account;
}
export { CHANGE_EVENT };
