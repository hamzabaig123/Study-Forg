import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";
/**
 * Session store tests.
 *
 * The store is the authorisation the database checks, so it is exercised against
 * a fake `supabase.auth` that answers in the project's own words. No network, no
 * project: what matters here is which account the app believes it has, when it
 * changes, and what a refusal looks like.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  resetPasswordForEmail(
    email: string,
    options?: { redirectTo?: string },
  ): Promise<{ error: { message: string } | null }>;
  updateUser(input: { password: string }): Promise<FakeReply>;
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
  const reply: {
    signIn: FakeReply;
    signUp: FakeReply;
    update: FakeReply;
    reset: { error: { message: string } | null };
  } = {
    signIn: ok(user()),
    signUp: ok(user()),
    update: ok(user()),
    reset: { error: null },
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
    async resetPasswordForEmail(email, options) {
      calls.push({ name: "resetPasswordForEmail", args: { email, options } });
      return { error: reply.reset.error };
    },
    async updateUser(input) {
      calls.push({ name: "updateUser", args: input });
      if (reply.update.data.user) {
        session = reply.update.data.session;
      }
      return reply.update;
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
    /** A named event, because the recovery flow is told about by name only. */
    emitAs(event: string, next: unknown) {
      for (const listener of listeners) {
        listener(event, next);
      }
    },
    /** Stand-in for another tab persisting a session this one never saw. */
    put(next: unknown) {
      session = next;
    },
  };
}

/**
 * The breach corpus that `assertNewPassword` consults is the one call the store
 * makes which does not go to the project, so it is answered here rather than
 * reached: an empty range is the corpus saying "not seen".
 */
function corpusAnsweredWith(...lines: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => lines.join("\n") })),
  );
}

/** The line the corpus carries for a password it already knows. */
async function breachLine(password: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password)),
  );
  const digest = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${digest.slice(5).toUpperCase()}:1234`;
}

beforeEach(() => {
  corpusAnsweredWith();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/**
 * `refresh` exists for the one change `onAuthStateChange` cannot report: a
 * confirmation link opened in another tab, which writes a session this browser
 * was never told about.
 */
describe("re-reading the stored session", () => {
  it("adopts a session another tab persisted and tells its listeners", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.restore();
    const listener = vi.fn();
    store.subscribe(listener);

    fake.put({ user: user({ email_confirmed_at: "2026-09-20T10:00:00Z" }) });
    await store.refresh();

    expect(store.account()).toMatchObject({
      email: "ada@example.com",
      emailVerified: true,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the account it has when the read finds nothing new", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();
    const listener = vi.fn();
    store.subscribe(listener);

    await store.refresh();

    expect(store.account()?.email).toBe("ada@example.com");
    expect(listener).not.toHaveBeenCalled();
  });

  it("treats a read that failed as no new session", async () => {
    const store = createSessionStore({
      auth: {
        getSession: async () => {
          throw new Error("token refresh offline");
        },
      },
    } as unknown as SupabaseClient);

    await expect(store.refresh()).resolves.toBeUndefined();
    expect(store.account()).toBe(null);
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

  it("does not pass a transport failure off as the project saying no", async () => {
    const fake = fakeClient();
    // The literal string a browser shows for a wrong VITE_SUPABASE_URL, a paused
    // project and an offline device alike.
    fake.reply.signIn = refused("Failed to fetch");
    const store = createSessionStore(fake.client);

    await expect(store.signIn("ada@example.com", "hunter2")).rejects.toThrow(
      /Could not reach the Supabase project[\s\S]*Check VITE_SUPABASE_URL/,
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
        password: "studyforge-ada",
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
      password: "studyforge-ada",
      passwordConfirmation: "studyforge-ada",
    });
    expect(fake.calls).toContainEqual({
      name: "signUp",
      args: {
        email: "ada@example.com",
        password: "studyforge-ada",
        options: {
          data: { full_name: "Ada" },
          emailRedirectTo: `${window.location.origin}/verify-email?email=ada%40example.com`,
        },
      },
    });
    expect(store.account()?.name).toBe("Ada");
  });

  it("asks for the confirmation link back on the origin that signed up", async () => {
    // The project's Site URL is one dashboard setting, and a preview deploy or a
    // dev server is never the origin it names. Sending the address per request
    // is what keeps the link arriving where the visitor already is — and keeps
    // the screen that can re-send it able to name the address when they do.
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.register({
      name: "Ada",
      email: "Ada@Example.com",
      password: "studyforge-ada",
      passwordConfirmation: "studyforge-ada",
    });
    await store.resendConfirmation("Ada@Example.com");

    const expected = `${window.location.origin}/verify-email?email=ada%40example.com`;
    const redirects = fake.calls
      .filter((call) => call.name === "signUp" || call.name === "resend")
      .map(
        (call) =>
          (call.args as { options: { emailRedirectTo?: string } }).options
            .emailRedirectTo,
      );
    expect(redirects).toEqual([expected, expected]);
  });

  it("leaves the browser a visitor when the address still needs confirming", async () => {
    const fake = fakeClient();
    fake.reply.signUp = ok(user(), false);
    const store = createSessionStore(fake.client);
    const account = await store.register({
      name: "Ada",
      email: "ada@example.com",
      password: "studyforge-ada",
      passwordConfirmation: "studyforge-ada",
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
        password: "studyforge-ada",
        passwordConfirmation: "studyforge-ada",
      }),
    ).rejects.toThrow("User already registered");
  });

  it("explains an unreachable project on the sign-up screen too", async () => {
    const fake = fakeClient();
    fake.reply.signUp = refused("Failed to fetch");
    const store = createSessionStore(fake.client);
    await expect(
      store.register({
        name: "Ada",
        email: "ada@example.com",
        password: "studyforge-ada",
        passwordConfirmation: "studyforge-ada",
      }),
    ).rejects.toThrow(/Could not reach the Supabase project/);
  });

  it("refuses a password the breach corpus already has, before asking the project", async () => {
    // GoTrue's own HIBP switch is plan-gated on this project, so the browser is
    // the only thing between a visitor and a password that is already public.
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    const password = "studyforge-ada";
    corpusAnsweredWith(await breachLine(password));

    await expect(
      store.register({
        name: "Ada",
        email: "ada@example.com",
        password,
        passwordConfirmation: password,
      }),
    ).rejects.toThrow(/already public/);
    expect(fake.calls).toEqual([]);
  });
});

describe("resetting a password", () => {
  it("sends the address and the page the link has to come back to", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);

    await store.requestPasswordReset("ada@example.com");

    expect(fake.calls).toContainEqual({
      name: "resetPasswordForEmail",
      args: {
        email: "ada@example.com",
        options: { redirectTo: `${window.location.origin}/reset-password` },
      },
    });
  });

  it("says which redirect the project refused", async () => {
    // A link that is never sent looks identical to one that is still in transit,
    // so the project's own reason is the only thing that makes this debuggable.
    const fake = fakeClient();
    fake.reply.reset = { error: { message: "Redirect not allowed" } };
    const store = createSessionStore(fake.client);

    await expect(store.requestPasswordReset("ada@example.com")).rejects.toThrow(
      "Redirect not allowed",
    );
  });

  it("translates the mailer's rate limit into what the visitor should do", async () => {
    // GoTrue's own wording ("email rate limit exceeded") is a quota code, not
    // an instruction — the store owes the visitor the hourly window instead.
    const fake = fakeClient();
    fake.reply.reset = { error: { message: "email rate limit exceeded" } };
    const store = createSessionStore(fake.client);

    await expect(store.requestPasswordReset("ada@example.com")).rejects.toThrow(
      /wait about an hour/,
    );
  });

  it("refuses two different passwords before asking the project", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);

    await expect(
      store.updatePassword("one secret", "another secret"),
    ).rejects.toThrow(/do not match/i);
    expect(fake.calls.map((call) => call.name)).not.toContain("updateUser");
  });

  it("refuses a password too short to be worth storing", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);

    await expect(store.updatePassword("abc", "abc")).rejects.toThrow(
      /between 10 and 128/i,
    );
    expect(fake.calls.map((call) => call.name)).not.toContain("updateUser");
  });

  it("refuses exactly one character under the live GoTrue floor", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    const underFloor = "x".repeat(MIN_PASSWORD_LENGTH - 1);

    await expect(store.updatePassword(underFloor, underFloor)).rejects.toThrow(
      /between 10 and 128/i,
    );
    expect(fake.calls.map((call) => call.name)).not.toContain("updateUser");

    const atFloor = "x".repeat(MIN_PASSWORD_LENGTH);
    await store.updatePassword(atFloor, atFloor);
    expect(fake.calls).toContainEqual({
      name: "updateUser",
      args: { password: atFloor },
    });
  });

  it("sends the new password and keeps the session it belongs to", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);

    const account = await store.updatePassword(
      "brand new secret",
      "brand new secret",
    );

    expect(fake.calls).toContainEqual({
      name: "updateUser",
      args: { password: "brand new secret" },
    });
    expect(account.email).toBe("ada@example.com");
  });

  it("holds the session as awaiting a password from the moment the link is opened", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.restore();
    expect(store.awaitsNewPassword()).toBe(false);

    fake.emitAs("PASSWORD_RECOVERY", { user: user() });

    expect(store.awaitsNewPassword()).toBe(true);
  });

  it("releases the gate once the new password is saved", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.restore();
    fake.emitAs("PASSWORD_RECOVERY", { user: user() });
    const listener = vi.fn();
    store.subscribe(listener);

    await store.updatePassword("brand new secret", "brand new secret");

    expect(store.awaitsNewPassword()).toBe(false);
    // The account itself never changed, so the only reason to hear from the store
    // is the flag — which is the whole point of notifying for it separately.
    expect(listener).toHaveBeenCalled();
  });

  it("clears the gate when the visitor signs out instead", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.restore();
    fake.emitAs("PASSWORD_RECOVERY", { user: user() });

    await store.signOut();

    expect(store.awaitsNewPassword()).toBe(false);
    expect(store.account()).toBe(null);
  });
});

/**
 * The signed-in change is the one password path where the session itself is the
 * attack surface: whoever holds an unlocked tab can otherwise write the real
 * owner out of the account. So the current password has to be proved before the
 * new one travels, and a form that leaves the proof out must not be able to
 * skip it.
 */
describe("changing a password while signed in", () => {
  it("proves the current password before it sends the new one", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();

    await store.changePassword(
      "the old secret",
      "a brand new secret",
      "a brand new secret",
    );

    // The order is the whole guarantee: a grant attempt with the old password,
    // and only then the update. `updateUser` never sees the old one.
    expect(fake.calls).toEqual([
      { name: "getSession", args: null },
      {
        name: "signInWithPassword",
        args: { email: "ada@example.com", password: "the old secret" },
      },
      { name: "updateUser", args: { password: "a brand new secret" } },
    ]);
  });

  it("leaves the account alone when the current password is wrong", async () => {
    const fake = fakeClient({ session: { user: user() } });
    fake.reply.signIn = refused("Invalid login credentials");
    const store = createSessionStore(fake.client);
    await store.restore();

    await expect(
      store.changePassword(
        "not the old secret",
        "a brand new secret",
        "a brand new secret",
      ),
    ).rejects.toThrow("The current password is incorrect.");
    expect(fake.calls.map((call) => call.name)).not.toContain("updateUser");
    expect(store.account()?.email).toBe("ada@example.com");
  });

  it("refuses an unusable new password without spending the grant attempt", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();

    await expect(
      store.changePassword("the old secret", "one secret", "another secret"),
    ).rejects.toThrow(/do not match/i);
    await expect(
      store.changePassword("the old secret", "too short", "too short"),
    ).rejects.toThrow(/between 10 and 128/i);
    expect(fake.calls.map((call) => call.name)).toEqual(["getSession"]);
  });

  it("refuses a breached new password before it touches the project", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();
    const password = "a brand new secret";
    corpusAnsweredWith(await breachLine(password));

    await expect(
      store.changePassword("the old secret", password, password),
    ).rejects.toThrow(/already public/);
    expect(fake.calls.map((call) => call.name)).toEqual(["getSession"]);
  });

  it("says there is no account to change when nothing is signed in", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);

    await expect(
      store.changePassword(
        "the old secret",
        "a brand new secret",
        "a brand new secret",
      ),
    ).rejects.toThrow(/no signed-in account/);
    expect(fake.calls).toEqual([]);
  });
});

/**
 * GoTrue's `security_captcha_enabled` is one dashboard switch, and it gates
 * sign-up, the password grant, the reset link and the re-send — not sign-up
 * alone. So the token has to reach every one of those calls, and a build with no
 * site key has to keep sending exactly what it sent before: a project that never
 * switched the check on must not start carrying an empty field.
 */
describe("carrying the human check", () => {
  it("puts the token on the password grant", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.signIn("ada@example.com", "correct horse", "turnstile-token");

    expect(fake.calls).toContainEqual({
      name: "signInWithPassword",
      args: {
        email: "ada@example.com",
        password: "correct horse",
        captchaToken: "turnstile-token",
      },
    });
  });

  it("sends the grant without the field when there is no token", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.signIn("ada@example.com", "correct horse");

    const grant = fake.calls[0] as unknown as { args: object };
    expect(grant.args).not.toHaveProperty("captchaToken");
  });

  it("nests the token in the sign-up options the client serialises", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.register({
      name: "Ada",
      email: "ada@example.com",
      password: "studyforge-ada",
      passwordConfirmation: "studyforge-ada",
      captchaToken: "turnstile-token",
    });

    expect(fake.calls).toContainEqual({
      name: "signUp",
      args: {
        email: "ada@example.com",
        password: "studyforge-ada",
        options: {
          data: { full_name: "Ada" },
          emailRedirectTo: `${window.location.origin}/verify-email?email=ada%40example.com`,
          captchaToken: "turnstile-token",
        },
      },
    });
  });

  it("carries it on the re-send and the reset link", async () => {
    const fake = fakeClient();
    const store = createSessionStore(fake.client);
    await store.resendConfirmation("ada@example.com", "re-send-token");
    await store.requestPasswordReset("ada@example.com", "reset-token");

    expect(fake.calls).toContainEqual({
      name: "resend",
      args: {
        type: "signup",
        email: "ada@example.com",
        options: {
          emailRedirectTo: `${window.location.origin}/verify-email?email=ada%40example.com`,
          captchaToken: "re-send-token",
        },
      },
    });
    expect(fake.calls).toContainEqual({
      name: "resetPasswordForEmail",
      args: {
        email: "ada@example.com",
        options: {
          redirectTo: `${window.location.origin}/reset-password`,
          captchaToken: "reset-token",
        },
      },
    });
  });

  it("proves the current password with the token the form was given", async () => {
    const fake = fakeClient({ session: { user: user() } });
    const store = createSessionStore(fake.client);
    await store.restore();

    await store.changePassword(
      "the old secret",
      "a brand new secret",
      "a brand new secret",
      "turnstile-token",
    );

    // The proof is the grant, so that is where the receipt belongs — and only
    // there. `updatePassword` needs a recovery session, not a solved check.
    expect(fake.calls).toEqual([
      { name: "getSession", args: null },
      {
        name: "signInWithPassword",
        args: {
          email: "ada@example.com",
          password: "the old secret",
          captchaToken: "turnstile-token",
        },
      },
      { name: "updateUser", args: { password: "a brand new secret" } },
    ]);
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
