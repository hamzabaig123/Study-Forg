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

function accountOf(user: AuthUser): SupabaseAccount {
  const email = user.email ?? "";
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

  function apply(next: SupabaseAccount | null) {
    const nextSnapshot = next ? JSON.stringify(next) : "null";
    if (nextSnapshot === snapshot) {
      return;
    }
    current = next;
    snapshot = nextSnapshot;
    for (const listener of listeners) {
      listener();
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
      throw new Error(error.message);
    }
    if (!user) {
      throw new Error("The sign-in request was refused.");
    }
    return accountOf(user);
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
        client.auth.onAuthStateChange((_event, session) => {
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
      if (password !== passwordConfirmation) {
        throw new Error("The two passwords do not match.");
      }
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      });
      if (error) {
        throw new Error(error.message);
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
      const { error } = await client.auth.resend({ type: "signup", email });
      if (error) {
        throw new Error(error.message);
      }
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) {
        throw new Error(error.message);
      }
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
