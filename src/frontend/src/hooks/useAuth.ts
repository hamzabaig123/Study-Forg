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
  /**
   * A session that has not chosen the password a reset link was sent for.
   *
   * Only the email/password paths can be in that state; Internet Identity has no
   * password to reset, so it is always false there.
   */
  awaitsNewPassword: boolean;
  signOut: () => void;
}

/**
 * What the sign-up form collects.
 *
 * `captchaToken` is the one field a local account has no use for: it is a
 * receipt from a human check the project asked for, and `lib/localAuth` is not
 * a project. It is optional everywhere because a build with
 * `VITE_TURNSTILE_SITE_KEY` unset has no widget to produce one.
 */
export interface EmailSignUpInput {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  captchaToken?: string;
}

/**
 * Email and password, whichever store verifies them.
 *
 * `verification` is the one place the two differ visibly: the dev mock has no
 * mail server, so its verify screen completes the address in the browser, while
 * Supabase has already sent a link and the screen can only re-send it.
 *
 * The screens all take the same last argument, a captcha token, and all ignore
 * it when the project does not ask for one — which is the shape a local account
 * keeps no matter what the dashboard says.
 */
export interface EmailPasswordAuthState extends AuthState {
  account: EmailAccount | null;
  signIn: (
    email: string,
    password: string,
    captchaToken?: string,
  ) => Promise<EmailAccount>;
  /** `null` means the address still has to be confirmed before there is a session. */
  register: (input: EmailSignUpInput) => Promise<EmailAccount | null>;
  /** A seeded account for the mock backend; a real project has none to offer. */
  startDemo: (() => EmailAccount) | null;
  verification: "local" | "email";
  /**
   * Send the confirmation link. The address is optional because the screen that
   * calls it is often showing an account the browser has no session for yet —
   * the moment just after signing up.
   */
  verifyEmail: (email?: string, captchaToken?: string) => void | Promise<void>;
  /**
   * Read the session again, for a screen that waits on something this browser is
   * not told about — the confirmation link opened in another tab. Only a store
   * whose session lives outside the page has anything to re-read; a local account
   * list is state this window already holds, so its answer is the current one.
   */
  refreshSession: () => Promise<void>;
  /**
   * Send a "choose a new password" link.
   *
   * `null` where there is no mail server to send it with, which is what keeps the
   * dev app's sign-in screen from offering a link that could only ever fail.
   */
  requestPasswordReset:
    | ((email: string, captchaToken?: string) => Promise<void>)
    | null;
  /**
   * Complete a reset with the new password. Paired with the request above, and
   * `null` for the same reason.
   */
  updatePassword:
    | ((password: string, confirmation: string) => Promise<void>)
    | null;
  /**
   * Change the password of the signed-in account.
   *
   * `null` where there is nothing to change it against — the dev mock keeps
   * its accounts in this browser, and Internet Identity has no password. The
   * implementation proves possession of the current password first, so a
   * session alone is never enough to rotate someone out of their account.
   */
  changePassword:
    | ((
        currentPassword: string,
        password: string,
        confirmation: string,
        captchaToken?: string,
      ) => Promise<void>)
    | null;
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
    // A local account is a row in this browser's storage with no mail server
    // behind it, so there is no link to send and nothing to follow. The screen
    // says so rather than offering a button that can only fail.
    awaitsNewPassword: false,
    requestPasswordReset: null,
    updatePassword: null,
    changePassword: null,
    signIn: useCallback(
      async (email: string, password: string) =>
        emailAccountOf(await loginAccount(email, password)),
      [],
    ),
    register: useCallback(async (input: EmailSignUpInput) => {
      // A local account is a row in this browser's storage: there is no project
      // to present a human-check receipt to, so the token never leaves here.
      return emailAccountOf(
        await registerAccount({
          name: input.name,
          email: input.email,
          password: input.password,
          passwordConfirmation: input.passwordConfirmation,
        }),
      );
    }, []),
    startDemo: useCallback(() => emailAccountOf(startDemoAccount()), []),
    verifyEmail: useCallback(() => verifyCurrentAccount(), []),
    // Nothing to pull: a local account lives in this browser's storage, and the
    // subscription above already saw the confirmation land.
    refreshSession: useCallback(async () => {}, []),
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
    // Internet Identity has no password to reset: the identity itself is the
    // credential, and a lost one is re-minted by the provider.
    awaitsNewPassword: false,
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
 * The recovery flag, as a string.
 *
 * A second subscription with its own snapshot rather than a field inside the
 * account JSON: `useSyncExternalStore` re-renders on a changed snapshot, and the
 * account itself does not change when a reset link is opened — only what the app
 * is allowed to do with it does.
 */
function supabaseRecoverySnapshot() {
  return sessionStore().awaitsNewPassword() ? "awaiting" : "settled";
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
  const recovery = useSyncExternalStore(
    subscribeSupabaseSession,
    supabaseRecoverySnapshot,
    () => "settled",
  );
  return {
    account,
    principal: account?.id ?? null,
    displayName: account?.name ?? null,
    isAuthenticated: account !== null,
    isVerified: Boolean(account?.emailVerified),
    isInitializing: false,
    isLoggingIn: false,
    awaitsNewPassword: recovery === "awaiting",
    verification: "email",
    signIn: useCallback(
      (address: string, password: string, captchaToken?: string) =>
        sessionStore().signIn(address, password, captchaToken),
      [],
    ),
    register: useCallback(
      (input: EmailSignUpInput) => sessionStore().register(input),
      [],
    ),
    startDemo: null,
    verifyEmail: useCallback(
      async (address?: string, captchaToken?: string) => {
        // A confirmation can be re-sent to an address the browser holds no
        // session for — that is exactly the state right after signing up.
        await sessionStore().resendConfirmation(address || email, captchaToken);
      },
      [email],
    ),
    refreshSession: useCallback(() => sessionStore().refresh(), []),
    requestPasswordReset: useCallback(
      async (address: string, captchaToken?: string) => {
        await sessionStore().requestPasswordReset(address, captchaToken);
      },
      [],
    ),
    updatePassword: useCallback(
      async (password: string, confirmation: string) => {
        await sessionStore().updatePassword(password, confirmation);
      },
      [],
    ),
    changePassword: useCallback(
      async (
        currentPassword: string,
        password: string,
        confirmation: string,
        captchaToken?: string,
      ) => {
        await sessionStore().changePassword(
          currentPassword,
          password,
          confirmation,
          captchaToken,
        );
      },
      [],
    ),
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
