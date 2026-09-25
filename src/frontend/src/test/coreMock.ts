import { ACCOUNTS_KEY, type LocalAccount, SESSION_KEY } from "@/lib/localAuth";
import type { MockActor } from "@/test/mockActor";
import { vi } from "vitest";

/**
 * Mutable state the `@caffeineai/core-infrastructure` mock reads from.
 *
 * `vi.mock` factories are hoisted above imports, so a factory cannot close over
 * a per-test variable. It closes over this module-level holder instead, and
 * tests mutate it through the setters below.
 */
export const coreMockState: {
  actor: MockActor | null;
  auth: {
    isAuthenticated: boolean;
    isInitializing: boolean;
    isLoggingIn: boolean;
    isLoginError: boolean;
    isLoginIdle: boolean;
    principal: string;
    login: () => void;
    clear: () => void;
  };
} = {
  actor: null,
  auth: {
    isAuthenticated: false,
    isInitializing: false,
    isLoggingIn: false,
    isLoginError: false,
    isLoginIdle: true,
    principal: "",
    login: () => {},
    clear: () => {},
  },
};

export const DEFAULT_PRINCIPAL =
  "2vxsx-fae-aaaaa-aaaab-aaaca-aaaae-aaaaf-aaaag-aaaah-aaaai-aaaaj-aaaak-aaaba";

export interface MockAuthState {
  isAuthenticated: boolean;
  isInitializing?: boolean;
  isLoggingIn?: boolean;
  isLoginError?: boolean;
  isLoginIdle?: boolean;
  principal?: string;
  login?: () => void;
  clear?: () => void;
}

export function createAuthState(
  overrides: Partial<MockAuthState> = {},
): typeof coreMockState.auth {
  return {
    isAuthenticated: true,
    isInitializing: false,
    isLoggingIn: false,
    isLoginError: false,
    isLoginIdle: true,
    principal: DEFAULT_PRINCIPAL,
    login: vi.fn(),
    clear: vi.fn(),
    ...overrides,
  };
}

export function setMockActor(actor: MockActor | null): void {
  coreMockState.actor = actor;
}

export function setMockAuth(auth: typeof coreMockState.auth): void {
  coreMockState.auth = auth;
}

/**
 * Write a local account straight into storage so `useAuth` reports a signed-in
 * caller without running PBKDF2 in a test. Call it before rendering; `useAuth`
 * reads storage when it mounts.
 */
export function setLocalAccount(
  options: { signedIn?: boolean; emailVerified?: boolean; name?: string } = {},
): LocalAccount {
  const createdAt = new Date().toISOString();
  const account: LocalAccount = {
    id: "test-account",
    name: options.name ?? "Test Student",
    email: "test@example.com",
    salt: "",
    passwordHash: "",
    emailVerified: options.emailVerified ?? true,
    createdAt,
  };
  window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([account]));
  if (options.signedIn ?? true) {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ accountId: account.id, token: "test-token", createdAt }),
    );
  }
  return account;
}
