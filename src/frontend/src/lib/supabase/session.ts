/**
 * The Supabase session: who the browser is allowed to read as.
 *
 * Row level security keys every row to `auth.uid()`, so this is not a UI detail
 * but the authorisation the database checks. It replaces the browser-side
 * account list the mock keeps (`lib/localAuth.ts`), which cannot work here: a
 * password hashed in a script has no `auth.uid()` behind it, and every Postgres
 * query would arrive as `anon` and be filtered to nothing.
 *
 * supabase-js owns the token — it persists the session, refreshes it, and reports
 * changes — so this module only narrows what it exposes to the app (an id, a name,
 * an email, and whether the email is confirmed), keeps one snapshot string for
 * `useSyncExternalStore`, and turns a failed call into an `Error` whose message is
 * worth showing. `client.auth` is not called anywhere else.
 */
import { passwordLengthError } from "@/lib/passwordPolicy";
import { breachReason } from "@/lib/passwordPolicy";
import { SUPABASE_URL } from "@/lib/supabase/env";
import type { SupabaseClient } from "@supabase/supabase-js";

/** What the app is allowed to know about the signed-in user. */
export interface SupabaseAccount {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/**
 * The `User` fields read here, named rather than imported from `@supabase/
 * auth-js`: this is the whole surface the app depends on, and a fake client in a
 * test only has to provide it.
 */
interface AuthUser {
  id: string;
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/**
 * Validate a new password before any request is made.
 *
 * Refused locally rather than by the server: a mismatch or an under-floor
 * password would otherwise cost a round trip (GoTrue answers under the floor
 * with `422 weak_password`, measured live), and a breached password should
 * never travel at all — the breach lookup leaves the browser either way
 * (k-anonymity range query, see `breachReason`).
 */
async function assertNewPassword(
  password: string,
  confirmation: string,
): Promise<void> {
  if (password !== confirmation) {
    throw new Error("The two passwords do not match.");
  }
  const tooShort = passwordLengthError(password);
  if (tooShort) {
    throw new Error(tooShort);
  }
  const breached = await breachReason(password);
  if (breached) {
    throw new Error(breached);
  }
}

function accountOf(user: AuthUser): SupabaseAccount {  const email = user.email ?? "";
  const metadata = user.user_metadata;
  const full = metadata?.full_name;
  const name = typeof full === "string" ? full.trim() : "";
  return {
    id: user.id,
    // A display name is set at sign-up and may be edited later; an account that
    // never supplied one is named by its address rather than a placeholder.
    name: name || email,
    email,
    emailVerified: Boolean(user.email_confirmed_at ?? user.confirmed_at),
  };
}

export interface SessionStore {
  /** The restored account, or null for a visitor. */
  account(): SupabaseAccount | null;
  /** A stable JSON string for `useSyncExternalStore`; identical until the session changes. */
  snapshot(): string;
  subscribe(listener: () => void): () => void;
  /** Read the persisted session once, then follow every change to it. */
  restore(): Promise<void>;
  /**
   * Read the persisted session again.
   *
   * `onAuthStateChange` reports what happens in this tab; a link opened in
   * another one writes a token into storage that only a pull will notice.
   */
  refresh(): Promise<void>;
  /** Resolves with the account, or throws the project's own reason for refusing. */
  signIn(email: string, password: string): Promise<SupabaseAccount>;
  register(input: {
    name: string;
    email: string;
    password: string;
    passwordConfirmation: string;
  }): Promise<SupabaseAccount | null>;
  /** Re-send the confirmation link to an address. */
  resendConfirmation(email: string): Promise<void>;
  /**
   * Email a "choose a new password" link.
   *
   * Supabase answers a request for an address that does not exist with the same
   * success it gives a real one, so this cannot be used to learn whether an
   * account exists — which is why the screen that calls it can say "if that
   * address is ours, a link is on its way" without lying.
   */
  requestPasswordReset(email: string): Promise<void>;
  /**
   * Set the new password for the session the reset link opened.
   *
   * The link is what authorises this: following it produced a session whose only
   * purpose is this call, and `updateUser` refuses any other token.
   */
  updatePassword(
    password: string,
    confirmation: string,
  ): Promise<SupabaseAccount>;
  /**
   * Change the password of the signed-in account.
   *
   * Unlike `updatePassword`, possession of the current password is required
   * first: without that check, anyone who reaches an unlocked session — a
   * shared computer, a stolen laptop, a tab left open — can lock the real
   * owner out by rotating the password. The proof is a password grant, which
   * also refreshes the session; a wrong answer never touches it.
   */
  changePassword(
    currentPassword: string,
    password: string,
    confirmation: string,
  ): Promise<SupabaseAccount>;
  /**
   * True from the moment a reset link is opened until a new password is chosen.
   *
   * A recovery session reads to the app exactly like a signed-in account, so
   * without this the visitor would land on the dashboard and never be asked to
   * pick the password the link was sent for.
   */
  awaitsNewPassword(): boolean;
  signOut(): Promise<void>;
}

/**
 * Build a session store over a client.
 *
 * A parameter rather than a module singleton for the same reason the adapter
 * takes a transport: the seam is what makes it testable, and a fake client here
 * exercises the whole store without a project to talk to.
 */
export function createSessionStore(client: SupabaseClient): SessionStore {
  const listeners = new Set<() => void>();
  let current: SupabaseAccount | null = null;
  let snapshot = "null";
  let restoring: Promise<void> | null = null;
  let recovering = false;

  /**
   * Where a reset link brings the visitor back to.
   *
   * The project's Site URL is a dashboard setting that a local dev server is
   * never part of, so the redirect is sent per request from the origin the page
   * is actually on. That makes the link work on `localhost`, on a preview and on
   * the deployed app without a setting being changed three times — at the cost of
   * one rule: every origin that may sign a user in has to be listed in the
   * project's auth allow-list, or Supabase refuses the redirect.
   */
  function redirectTo(path: string) {
    const origin = globalThis.location?.origin ?? "";
    return origin ? `${origin}${path}` : undefined;
  }

  /**
   * Where a confirmation link lands, with the address it belongs to.
   *
   * The verification screen reads the address from `?email=` when there is no
   * session to read it from, and a link that fails to open a session is exactly
   * that case. GoTrue appends its own parameters after the query string, so the
   * address survives the round trip.
   */
  function verificationRedirect(email: string) {
    const target = redirectTo("/verify-email");
    return target
      ? `${target}?email=${encodeURIComponent(email.trim().toLowerCase())}`
      : undefined;
  }

  function apply(next: SupabaseAccount | null) {
    const nextSnapshot = next ? JSON.stringify(next) : "null";
    if (nextSnapshot === snapshot) {
      return;
    }
    current = next;
    snapshot = nextSnapshot;
    notify();
  }

  /**
   * Tell every subscriber to read again.
   *
   * The account snapshot is what usually changes, but the recovery flag is a
   * second thing a page subscribes to, and a reset link opened by an account that
   * is already signed in changes only that — so the flag has its own path to the
   * listeners rather than riding on the snapshot.
   */
  function notify() {
    for (const listener of listeners) {
      listener();
    }
  }

  /** Record what the last auth event meant, and wake anyone who needs to know. */
  function setRecovery(next: boolean) {
    if (next !== recovering) {
      recovering = next;
      notify();
    }
  }

  /**
   * Unpack supabase-js's `{ data, error }` envelope.
   *
   * The messages are the project's own ("Invalid login credentials", "Email not
   * confirmed"), which is what a sign-in screen should say. Only a reply with
   * neither a user nor an error gets a generic line, because that shape means
   * the call was refused before it reached the auth service.
   */
  function unwrap(user: AuthUser | null, error: { message: string } | null) {
    if (error) {
      throw new Error(authMessage(error.message));
    }
    if (!user) {
      throw new Error("The sign-in request was refused.");
    }
    return accountOf(user);
  }

  /**
   * Turn a refusal into a sentence worth showing.
   *
   * A bare "Failed to fetch" is what three different problems look like — a
   * mistyped `VITE_SUPABASE_URL`, a project that is paused, and a laptop with no
   * network — and none of them is the project saying no. Naming the URL the
   * browser tried to reach is the difference between a fix and a debugging
   * session, and it is the reason this module reads the config at all.
   */
  function authMessage(raw: string | null | undefined) {
    const message = raw?.trim() ?? "";
    if (
      /^(failed to fetch|fetch failed|networkerror|network error|load failed|ERR_(?:NETWORK|CONNECTION)|signal is aborted|timeout)/i.test(
        message,
      )
    ) {
      return `Could not reach the Supabase project${SUPABASE_URL ? ` at ${SUPABASE_URL}` : ""} (${message}). Check VITE_SUPABASE_URL, and that this device is online.`;
    }
    // GoTrue's own wording for the shared mailer's hourly quota — the visitor
    // cannot fix it by retrying, so say what to do instead of the raw code.
    if (/rate limit/i.test(message)) {
      return "Too many emails were requested in a short window. The free mailer allows only a few per hour — wait about an hour and request a fresh link.";
    }
    return message || "The sign-in request was refused.";
  }

  return {
    account: () => current,
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    restore() {
      restoring ??= (async () => {
        const { data, error } = await client.auth.getSession();
        if (error) {
          throw new Error(error.message);
        }
        apply(data.session ? accountOf(data.session.user) : null);
        client.auth.onAuthStateChange((event, session) => {
          // The link was opened, so a new password is owed before this session
          // is treated as an ordinary sign-in. Every other event means that
          // password has been chosen, or the session is gone.
          setRecovery(event === "PASSWORD_RECOVERY");
          apply(session ? accountOf(session.user) : null);
        });
      })().catch(() => {
        // A project that cannot answer has no session, which is the same state
        // as a signed-out browser. The pages report the failure; the app must
        // not sit on a promise that never settles.
        restoring = null;
      });
      return restoring;
    },

    async refresh() {
      // A read that fails has the same answer as a read that finds nothing new:
      // the session is still what it was a moment ago. The caller asks again.
      try {
        const { data } = await client.auth.getSession();
        apply(data.session ? accountOf(data.session.user) : null);
      } catch {
        /* swallowed on purpose — this runs on a timer */
      }
    },

    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      const account = unwrap(data.user, error);
      apply(account);
      return account;
    },

    async register({ name, email, password, passwordConfirmation }) {
      await assertNewPassword(password, passwordConfirmation);
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
          // The same rule the reset link follows: land the visitor back on the
          // origin that asked, rather than on the project's Site URL, which is
          // one setting that is wrong for every preview and every dev server.
          // The screen is the verification one and it carries the address, so a
          // link that fails to open a session still lands somewhere that can
          // re-send it.
          emailRedirectTo: verificationRedirect(email),
        },
      });
      if (error) {
        throw new Error(authMessage(error.message));
      }
      // With confirmation required Supabase creates the user and returns no
      // session: the visitor stays one until the link is followed, which is the
      // state the verify screen exists for.
      if (data.user && data.session) {
        apply(accountOf(data.user));
      }
      return current;
    },

    async resendConfirmation(email) {
      const { error } = await client.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: verificationRedirect(email) },
      });
      if (error) {
        throw new Error(authMessage(error.message));
      }
    },

    async requestPasswordReset(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: redirectTo("/reset-password"),
      });
      if (error) {
        throw new Error(authMessage(error.message));
      }
    },

    async updatePassword(password, confirmation) {
      await assertNewPassword(password, confirmation);
      const { data, error } = await client.auth.updateUser({ password });
      const account = unwrap(data.user, error);
      setRecovery(false);
      apply(account);
      return account;
    },

    async changePassword(currentPassword, password, confirmation) {
      await assertNewPassword(password, confirmation);
      const account = current;
      if (!account) {
        throw new Error("There is no signed-in account to change.");
      }
      // Possession proof before the change: a wrong current password must
      // leave the session exactly as it was. GoTrue answers a bad grant with
      // `invalid_login_credentials`; anything else (network, unconfirmed)
      // keeps the store's own wording.
      const proof = await client.auth.signInWithPassword({
        email: account.email,
        password: currentPassword,
      });
      if (proof.error) {
        if (/invalid/i.test(proof.error.message)) {
          throw new Error("The current password is incorrect.");
        }
        throw new Error(authMessage(proof.error.message));
      }
      const { data, error } = await client.auth.updateUser({ password });
      const next = unwrap(data.user, error);
      apply(next);
      return next;
    },

    awaitsNewPassword: () => recovering,

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) {
        throw new Error(authMessage(error.message));
      }
      setRecovery(false);
      apply(null);
    },
  };
}

let store: SessionStore | null = null;

/**
 * Create the app's session store, from the one place that has a client.
 *
 * Attached rather than imported: `useAuth` reads `sessionStore()` synchronously
 * during the first render, and if building a store required `client.ts` then every
 * mode of the app — the mock and the canister included — would carry
 * `@supabase/supabase-js` in its main bundle to satisfy an import that never runs.
 */
export function attachSessionStore(client: SupabaseClient): SessionStore {
  store ??= createSessionStore(client);
  return store;
}

/** The store the pages read, once `supabaseBackend()` has attached one. */
export function sessionStore(): SessionStore {
  if (!store) {
    throw new Error(
      "There is no Supabase session. The Supabase backend has not been started.",
    );
  }
  return store;
}
