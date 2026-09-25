import {
  CHANGE_EVENT,
  type LocalAccount,
  getAccountsSnapshot,
  getSessionSnapshot,
  loginAccount,
  logoutAccount,
  registerAccount,
  startDemoAccount,
  verifyCurrentAccount,
} from "@/lib/localAuth";
import { useCallback, useMemo, useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Personal email/password account state for the local application. */
export function useAuth() {
  // getSnapshot must return the same reference until storage actually changes.
  const accountsSnapshot = useSyncExternalStore(
    subscribe,
    getAccountsSnapshot,
    () => "[]",
  );
  const sessionSnapshot = useSyncExternalStore(
    subscribe,
    getSessionSnapshot,
    () => "null",
  );
  const session = useMemo(() => {
    try {
      return JSON.parse(sessionSnapshot) as { accountId: string } | null;
    } catch {
      return null;
    }
  }, [sessionSnapshot]);
  const account = useMemo(() => {
    try {
      return (
        (JSON.parse(accountsSnapshot) as LocalAccount[]).find(
          (item) => item.id === session?.accountId,
        ) ?? null
      );
    } catch {
      return null;
    }
  }, [accountsSnapshot, session?.accountId]);
  return {
    account,
    principal: account?.id ?? null,
    displayName: account?.name ?? null,
    isAuthenticated: Boolean(account && session),
    isVerified: Boolean(account?.emailVerified),
    isInitializing: false,
    isLoggingIn: false,
    loginStatus: "idle",
    signIn: useCallback(
      (email: string, password: string) => loginAccount(email, password),
      [],
    ),
    register: useCallback(
      (input: Parameters<typeof registerAccount>[0]) => registerAccount(input),
      [],
    ),
    startDemo: useCallback(() => startDemoAccount(), []),
    verifyEmail: useCallback(() => verifyCurrentAccount(), []),
    signOut: useCallback(() => logoutAccount(), []),
  };
}
