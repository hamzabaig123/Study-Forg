import { USE_LOCAL_ACCOUNTS } from "@/lib/authMode";
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
import {
  type LoginOptions,
  useInternetIdentity,
} from "@caffeineai/core-infrastructure";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Session state the app reads, whichever authentication path is active. */
export interface AuthState {
  /** The local account record; Internet Identity sign-in has none. */
  account: LocalAccount | null;
  principal: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  /** Internet Identity only issues verified principals, so it is always true there. */
  isVerified: boolean;
  isInitializing: boolean;
  isLoggingIn: boolean;
  signOut: () => void;
}

/** Email/password accounts exist only beside the dev mock backend. */
export interface LocalAuthState extends AuthState {
  signIn: (email: string, password: string) => Promise<LocalAccount>;
  register: (
    input: Parameters<typeof registerAccount>[0],
  ) => Promise<LocalAccount>;
  startDemo: () => LocalAccount;
  verifyEmail: () => void;
}

/** Internet Identity session: the identity itself is the credential. */
export interface InternetIdentityAuthState extends AuthState {
  login: (options?: LoginOptions) => void;
  loginError: Error | undefined;
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Personal email/password account state for the local mock development app. */
export function useLocalAccountAuth(): LocalAuthState {
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

/**
 * Internet Identity session for a real canister.
 *
 * The identity is the whole credential, so there is no display name or email
 * to show and no verification step to gate: `useActor` keys the backend actor
 * to this principal, which is what isolates one user's data from another's.
 */
export function useInternetIdentityAuth(): InternetIdentityAuthState {
  const {
    identity,
    isAuthenticated: signedIn,
    isInitializing,
    isLoggingIn,
    loginError,
    login,
    clear,
  } = useInternetIdentity();
  const principal = identity?.getPrincipal().toString() ?? null;
  const isAuthenticated = signedIn && principal !== null;
  return {
    account: null,
    principal,
    displayName: null,
    isAuthenticated,
    isVerified: isAuthenticated,
    isInitializing,
    isLoggingIn,
    login,
    loginError,
    signOut: clear,
  };
}

const MODE_SELECTED: () => AuthState = USE_LOCAL_ACCOUNTS
  ? useLocalAccountAuth
  : useInternetIdentityAuth;

/**
 * Authentication state for the current backend.
 *
 * Pages import this rather than `useInternetIdentity` so the dev mock app keeps
 * its local accounts while a real deployment gets Internet Identity, without
 * either branch of the UI having to know which mode it is in. Mode is fixed at
 * module load, so choosing the implementation here never changes hook order.
 */
export function useAuth(): AuthState {
  return MODE_SELECTED();
}
