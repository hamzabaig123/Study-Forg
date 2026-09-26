/**
 * Session store tests.
 *
 * The store is the authorisation the database checks, so it is exercised against
 * a fake `supabase.auth` that answers in the project's own words. No network, no
 * project: what matters here is which account the app believes it has, when it
 * changes, and what a refusal looks like.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./session";

interface FakeUser {
  id: string;
  email?: string | null;
  confirmed_at?: string | null;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

interface FakeReply {
  data: { user: FakeUser | null; session: { user: FakeUser } | null };
  error: { message: string } | null;
}

function user(overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: "8f14e45f-ceea-467a-9c1b-2f3d4a5b6c7d",
    email: "ada@example.com",
    email_confirmed_at: "2026-09-01T08:00:00Z",
    user_metadata: { full_name: "Ada" },
    ...overrides,
  };
}

function ok(member: FakeUser | null, session = true): FakeReply {
  return {
    data: {
      user: member,
      session: session && member ? { user: member } : null,
    },
    error: null,
  };
}

function refused(message: string): FakeReply {
  return { data: { user: null, session: null }, error: { message } };
}

interface FakeAuth {
  getSession(): Promise<{ data: { session: unknown }; error: null }>;
  onAuthStateChange(fn: (event: string, session: unknown) => void): {
    data: { subscription: { unsubscribe: () => void } };
  };
  signInWithPassword(input: {
    email: string;
    password: string;
  }): Promise<FakeReply>;
  signUp(input: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }): Promise<FakeReply>;
  resend(input: { type: string; email: string }): Promise<{ error: null }>;
  signOut(): Promise<{ error: null }>;
}

/**
 * A client that keeps one session and a scripted reply for each call, and records
 * what it was asked — the store should never be able to sign in without sending
 * the address it was given.
 */
function fakeClient(options: { session?: unknown } = {}) {
  const calls: { name: string; args: unknown }[] = [];
  const listeners = new Set<(event: string, session: unknown) => void>();
  const reply: { signIn: FakeReply; signUp: FakeReply } = {
    signIn: ok(user()),
    signUp: ok(user()),
  };
  let session: unknown = options.session ?? null;

  const auth: FakeAuth = {
    async getSession() {
      calls.push({ name: "getSession", args: null });
      return { data: { session }, error: null };
    },
    onAuthStateChange(fn) {
      listeners.add(fn);
      return {
        data: { subscription: { unsubscribe: () => listeners.delete(fn) } },
      };
    },
    async signInWithPassword(input) {
      calls.push({ name: "signInWithPassword", args: input });
      if (reply.signIn.data.user) {
        session = reply.signIn.data.session;
      }
      return reply.signIn;
    },
    async signUp(input) {
      calls.push({ name: "signUp", args: input });
      session = reply.signUp.data.session;
      return reply.signUp;
    },
    async resend(input) {
      calls.push({ name: "resend", args: input });
      return { error: null };
    },
    async signOut() {
      calls.push({ name: "signOut", args: null });
      session = null;
      return { error: null };
    },
  };

  return {
    client: { auth } as unknown as SupabaseClient,
    calls,
    listeners,
    reply,
    emit(next: unknown) {
      for (const listener of listeners) {
        listener("SIGNED_IN", next);
      }
    },
  };
}

describe("restoring the stored session", () => {
  it("reports the account supabase-js persisted", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    expect(store.account()).toBe(null);

    await store.restore();

    expect(store.account()).toEqual({
      id: "8f14e45f-ceea-467a-9c1b-2f3d4a5b6c7d",
      name: "Ada",
      email: "ada@example.com",
      emailVerified: true,
    });
  });

  it("stays signed out when the browser holds no session", async () => {
    const store = createSessionStore(fakeClient().client);
    await store.restore();
    expect(store.account()).toBe(null);
    expect(store.snapshot()).toBe("null");
  });

  it("names an account with no display name by its address", async () => {
    const member = user({ user_metadata: {} });
    const store = createSessionStore(
      fakeClient({ session: { user: member } }).client,
    );
    await store.restore();
    expect(store.account()?.name).toBe("ada@example.com");
  });

  it("treats confirmed_at as verification when the project sets only that", async () => {
    const member = user({
      email_confirmed_at: null,
      confirmed_at: "2026-09-01T08:00:00Z",
    });
    const store = createSessionStore(
      fakeClient({ session: { user: member } }).client,
    );
    await store.restore();
    expect(store.account()?.emailVerified).toBe(true);
  });

  it("follows a change pushed by supabase-js and notifies once per change", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();
    const listener = vi.fn();
    store.subscribe(listener);

    // The same account again must not re-render every subscribed page, which is
    // what a snapshot that is rebuilt instead of compared would do.
    fake.emit({ user: user() });
    expect(store.account()?.email).toBe("ada@example.com");
    expect(listener).not.toHaveBeenCalled();

    const other = user({ id: "b0", email: "grace@example.com" });
    fake.emit({ user: other });
    expect(store.account()?.email).toBe("grace@example.com");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("settles once even when restore is asked for twice", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await Promise.all([store.restore(), store.restore()]);
    expect(
      fake.calls.filter((call) => call.name === "getSession"),
    ).toHaveLength(1);
  });
});

describe("signing in", () => {
  it("sends the address and password it was given and returns the account", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    const account = await store.signIn("ada@example.com", "correct horse");

    expect(fake.calls).toContainEqual({
      name: "signInWithPassword",
      args: { email: "ada@example.com", password: "correct horse" },
    });
    expect(account.id).toBe("8f14e45f-ceea-467a-9c1b-2f3d4a5b6c7d");
    expect(store.account()).toEqual(account);
  });

  it("says what the project said when it refuses", async () => {
    const fake = fakeClient();
    fake.reply.signIn = refused("Invalid login credentials");
    const store = createSessionStore(fake.client);
    await expect(store.signIn("ada@example.com", "wrong")).rejects.toThrow(
      "Invalid login credentials",
    );
    expect(store.account()).toBe(null);
  });
});

describe("registering", () => {
  it("does not spend a request on two passwords that do not match", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await expect(
      store.register({
        name: "Ada",
        email: "ada@example.com",
        password: "aaaaaaaa",
        passwordConfirmation: "bbbbbbbb",
      }),
    ).rejects.toThrow(/do not match/i);
    expect(fake.calls).toEqual([]);
  });

  it("carries the name into user_metadata so the header has something to show", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.register({
      name: "Ada",
      email: "ada@example.com",
      password: "aaaaaaaa",
      passwordConfirmation: "aaaaaaaa",
    });
    expect(fake.calls).toContainEqual({
      name: "signUp",
      args: {
        email: "ada@example.com",
        password: "aaaaaaaa",
        options: { data: { full_name: "Ada" } },
      },
    });
    expect(store.account()?.name).toBe("Ada");
  });

  it("leaves the browser a visitor when the address still needs confirming", async () => {
    const fake = fakeClient();
    fake.reply.signUp = ok(user(), false);
    const store = createSessionStore(fake.client);
    const account = await store.register({
      name: "Ada",
      email: "ada@example.com",
      password: "aaaaaaaa",
      passwordConfirmation: "aaaaaaaa",
    });
    expect(account).toBe(null);
    expect(store.snapshot()).toBe("null");
  });

  it("surfaces the project's reason for refusing the address", async () => {
    const fake = fakeClient();
    fake.reply.signUp = refused("User already registered");
    const store = createSessionStore(fake.client);
    await expect(
      store.register({
        name: "Ada",
        email: "ada@example.com",
        password: "aaaaaaaa",
        passwordConfirmation: "aaaaaaaa",
      }),
    ).rejects.toThrow("User already registered");
  });
});

describe("signing out", () => {
  it("drops the account and tells its listeners", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();
    const listener = vi.fn();
    store.subscribe(listener);

    await store.signOut();

    expect(fake.calls).toContainEqual({ name: "signOut", args: null });
    expect(store.account()).toBe(null);
    expect(store.snapshot()).toBe("null");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
