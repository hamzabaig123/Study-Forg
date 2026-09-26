import { USE_LOCAL_ACCOUNTS, USE_SUPABASE } from "@/lib/authMode";
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
import { sessionStore } from "@/lib/supabase/session";
import {
  type LoginOptions,
  useInternetIdentity,
} from "@caffeineai/core-infrastructure";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * The account a sign-in screen shows.
 *
 * Narrower than `LocalAccount` on purpose: the salt and the password hash belong
 * to `lib/localAuth`, and a header or a route guard has no business receiving
 * them.
 */
export interface EmailAccount {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/** Session state the app reads, whichever authentication path is active. */
export interface AuthState {
  /** The email account behind the session; Internet Identity sign-in has none. */
  account: EmailAccount | null;
  principal: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
  /** Internet Identity only issues verified principals, so it is always true there. */
  isVerified: boolean;
  isInitializing: boolean;
  isLoggingIn: boolean;
  signOut: () => void;
}

/**
 * Email and password, whichever store verifies them.
 *
 * `verification` is the one place the two differ visibly: the dev mock has no
 * mail server, so its verify screen completes the address in the browser, while
 * Supabase has already sent a link and the screen can only re-send it.
 */
export interface EmailPasswordAuthState extends AuthState {
  account: EmailAccount | null;
  signIn: (email: string, password: string) => Promise<EmailAccount>;
  /** `null` means the address still has to be confirmed before there is a session. */
  register: (
    input: Parameters<typeof registerAccount>[0],
  ) => Promise<EmailAccount | null>;
  /** A seeded account for the mock backend; a real project has none to offer. */
  startDemo: (() => EmailAccount) | null;
  verification: "local" | "email";
  verifyEmail: () => void | Promise<void>;
}

/** Internet Identity session: the identity itself is the credential. */
export interface InternetIdentityAuthState extends AuthState {
  login: (options?: LoginOptions) => void;
  loginError: Error | undefined;
}

function emailAccountOf(account: LocalAccount): EmailAccount {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    emailVerified: account.emailVerified,
  };
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
export function useLocalAccountAuth(): EmailPasswordAuthState {
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
      const found = (JSON.parse(accountsSnapshot) as LocalAccount[]).find(
        (item) => item.id === session?.accountId,
      );
      return found ? emailAccountOf(found) : null;
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
    verification: "local",
    signIn: useCallback(
      async (email: string, password: string) =>
        emailAccountOf(await loginAccount(email, password)),
      [],
    ),
    register: useCallback(
      async (input: Parameters<typeof registerAccount>[0]) =>
        emailAccountOf(await registerAccount(input)),
      [],
    ),
    startDemo: useCallback(() => emailAccountOf(startDemoAccount()), []),
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

function subscribeSupabaseSession(listener: () => void) {
  return sessionStore().subscribe(listener);
}

function supabaseSessionSnapshot() {
  return sessionStore().snapshot();
}

/**
 * Supabase session for the adapter-backed app.
 *
 * The browser holds no account list here: supabase-js persists and refreshes the
 * token, and the database authorises every row against the id inside it. The
 * store has already been restored before the app mounts (see `main.tsx`), so
 * there is no initializing frame to report — an unresolved session and a signed
 * out browser are the same thing to these pages.
 */
export function useSupabaseAuth(): EmailPasswordAuthState {
  const snapshot = useSyncExternalStore(
    subscribeSupabaseSession,
    supabaseSessionSnapshot,
    () => "null",
  );
  const account = useMemo(() => {
    try {
      return JSON.parse(snapshot) as EmailAccount | null;
    } catch {
      return null;
    }
  }, [snapshot]);
  const email = account?.email ?? "";
  return {
    account,
    principal: account?.id ?? null,
    displayName: account?.name ?? null,
    isAuthenticated: account !== null,
    isVerified: Boolean(account?.emailVerified),
    isInitializing: false,
    isLoggingIn: false,
    verification: "email",
    signIn: useCallback(
      (address: string, password: string) =>
        sessionStore().signIn(address, password),
      [],
    ),
    register: useCallback(
      (input: Parameters<typeof registerAccount>[0]) =>
        sessionStore().register(input),
      [],
    ),
    startDemo: null,
    verifyEmail: useCallback(async () => {
      await sessionStore().resendConfirmation(email);
    }, [email]),
    signOut: useCallback(() => {
      void sessionStore().signOut();
    }, []),
  };
}

const EMAIL_PASSWORD_MODE: () => EmailPasswordAuthState = USE_SUPABASE
  ? useSupabaseAuth
  : useLocalAccountAuth;

/**
 * Email/password sign-in for whichever store verifies it.
 *
 * The dev screens and the Supabase screens are the same form, so the page asks
 * for this rather than for one implementation: `USE_SUPABASE` is fixed at module
 * load, so the hook order never changes mid-session.
 */
export function useEmailPasswordAuth(): EmailPasswordAuthState {
  return EMAIL_PASSWORD_MODE();
}

const AUTH_MODE_SELECTED: () => AuthState = (() => {
  if (USE_SUPABASE) {
    return useSupabaseAuth;
  }
  if (USE_LOCAL_ACCOUNTS) {
    return useLocalAccountAuth;
  }
  return useInternetIdentityAuth;
})();

/**
 * Authentication state for the current backend.
 *
 * Pages import this rather than `useInternetIdentity` so the dev mock app keeps
 * its local accounts and a Supabase app gets its own session, while a canister
 * deployment gets Internet Identity — none of the UI having to know which mode it
 * is in. Mode is fixed at module load, so choosing the implementation here never
 * changes hook order.
 */
export function useAuth(): AuthState {
  return AUTH_MODE_SELECTED();
}
