import type { Backend } from "@/backend";
import { RequireAuth } from "@/components/layout/RequireAuth";
import type { SupabaseAccount } from "@/lib/supabase/session";
import { createMockActor } from "@/test/mockActor";
import { renderGuard } from "@/test/renderGuard";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A Supabase deployment authenticates through the project's own session store,
// not local accounts or an Internet Identity principal.
vi.mock("@/lib/authMode", () => ({
  DATA_BACKEND: "supabase",
  SHARED_BACKEND: true,
  USE_LOCAL_ACCOUNTS: false,
  USE_SUPABASE: true,
}));

/**
 * The session store, as the guard sees it.
 *
 * `useSupabaseAuth` reads the account through `snapshot()` and the recovery flag
 * through `awaitsNewPassword()`, and re-renders when `subscribe()` fires, so a
 * test moves the session by settling this object rather than by talking to
 * supabase-js — which `lib/supabase/session.test.ts` already covers.
 */
const session = vi.hoisted(() => ({
  account: null as SupabaseAccount | null,
  recovering: false,
  listeners: new Set<() => void>(),
  snapshot() {
    return session.account ? JSON.stringify(session.account) : "null";
  },
  subscribe(listener: () => void) {
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  },
  awaitsNewPassword: () => session.recovering,
  signIn: vi.fn(),
  register: vi.fn(),
  resendConfirmation: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
  settle(account: SupabaseAccount | null, recovering = false) {
    session.account = account;
    session.recovering = recovering;
    for (const listener of [...session.listeners]) {
      listener();
    }
  },
}));

vi.mock("@/lib/supabase/session", () => ({
  sessionStore: () => session,
}));

/**
 * The adapter as a resolved object.
 *
 * The guard will not hand a verified session to `AppLayout` until `useBackend`
 * has an actor, and in this mode that actor comes from the adapter module rather
 * than the Internet Identity seam the other guard suites inject into.
 */
vi.mock("@/lib/supabase/supabaseBackend", () => ({
  supabaseBackend: async () => adapter.actor,
}));

const adapter = vi.hoisted(() => ({
  actor: null as unknown,
}));

const ada: SupabaseAccount = {
  id: "8f14e45f-ceea-467a-9c1b-2f3d4a5b6c7d",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: true,
};

/**
 * The Supabase branch of the sign-in gate: an unverified address stops at the
 * verification screen, and a session carried by a password-reset link stops at
 * the new-password screen even though it is otherwise a signed-in session.
 */
describe("RequireAuth with a Supabase session", () => {
  beforeEach(() => {
    session.settle(null);
    adapter.actor = createMockActor() as unknown as Backend;
  });

  it("redirects a browser with no stored session to the login screen", async () => {
    await renderGuard(RequireAuth);

    expect(await screen.findByText("Log in screen")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("holds an account with an unverified email at the verification screen", async () => {
    session.settle({ ...ada, emailVerified: false });

    await renderGuard(RequireAuth);

    expect(await screen.findByText("Verify your email")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("holds a session carried by a reset link at the new-password screen", async () => {
    // The state a `PASSWORD_RECOVERY` event leaves: a real session for a verified
    // address, plus the flag that says its password is still the old one.
    session.settle(ada, true);

    await renderGuard(RequireAuth);

    expect(await screen.findByText("New password screen")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("renders the signed-in shell for a verified session with no reset outstanding", async () => {
    session.settle(ada);

    await renderGuard(RequireAuth);

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
    expect(screen.queryByText("New password screen")).not.toBeInTheDocument();
  });

  it("keeps the shell closed while the adapter is still loading", async () => {
    // The guard waits for an actor on purpose: a page query that disables itself
    // without one reads as "loaded, nothing found".
    adapter.actor = null;
    session.settle(ada);

    await renderGuard(RequireAuth);

    expect(
      await screen.findByText("Loading your workspace…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });
});
