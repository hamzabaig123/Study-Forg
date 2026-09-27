import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AuthPage from "@/pages/AuthPage";
import { setMockActor } from "@/test/coreMock";
import { createTestQueryClient } from "@/test/render";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Supabase app has its own session store, no demo account, and the same
// email/password form as the dev mock.
vi.mock("@/lib/authMode", () => ({
  DATA_BACKEND: "supabase",
  SHARED_BACKEND: true,
  USE_LOCAL_ACCOUNTS: false,
  USE_SUPABASE: true,
}));

/**
 * Pinned so the screen under test is the form and not this machine's
 * `.env.local`, which carries a placeholder key and would otherwise make
 * `SUPABASE_PROBLEM` non-null here and null on another box.
 */
const problem = vi.hoisted(() => ({ message: null as string | null }));

vi.mock("@/lib/supabase/env", () => ({
  get SUPABASE_PROBLEM() {
    return problem.message;
  },
}));

interface FakeAccount {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

const ada: FakeAccount = {
  id: "8f14e45f-ceea-467a-9c1b-2f3d4a5b6c7d",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: true,
};

/**
 * A session store the test drives directly.
 *
 * Only what the pages call is here: the store's own behaviour is covered by
 * `lib/supabase/session.test.ts`, and a sign-in screen is not the place to
 * discover whether supabase-js persisted a token.
 */
const store = {
  current: null as FakeAccount | null,
  listeners: new Set<() => void>(),
  recovering: false,
  snapshot: () => (store.current ? JSON.stringify(store.current) : "null"),
  subscribe(listener: () => void) {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  signIn: vi.fn(),
  register: vi.fn(),
  resendConfirmation: vi.fn(),
  refresh: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  awaitsNewPassword: () => store.recovering,
  signOut: vi.fn(),
  settle(account: FakeAccount | null) {
    store.current = account;
    for (const listener of store.listeners) {
      listener();
    }
  },
  /**
   * The state a reset link leaves behind: a session, and the flag that says the
   * password it was made with has not been chosen yet.
   */
  settleRecovery(account: FakeAccount | null) {
    store.recovering = true;
    store.settle(account);
  },
};

vi.mock("@/lib/supabase/session", () => ({
  sessionStore: () => store,
}));

async function renderLogin(initial = "/login") {
  setMockActor(null);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => <AuthPage mode="login" />,
  });
  const registerRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/register",
    component: () => <AuthPage mode="register" />,
  });
  const verifyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/verify-email",
    component: () => <AuthPage mode="verify" />,
  });
  const forgotRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/forgot-password",
    component: () => <AuthPage mode="forgot" />,
    validateSearch: (search: Record<string, unknown>) => ({
      email: typeof search.email === "string" ? search.email : "",
    }),
  });
  const resetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reset-password",
    component: () => <AuthPage mode="reset" />,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboard",
    component: () => <h1>Dashboard body</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      loginRoute,
      registerRoute,
      verifyRoute,
      forgotRoute,
      resetRoute,
      dashboardRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  await router.load();
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function fillRegister() {
  await user.click(
    await screen.findByRole("link", { name: /create an account/i }),
  );
  await user.type(screen.getByLabelText("Name"), "Grace");
  await user.type(screen.getByLabelText("Email"), "grace@example.com");
  await user.type(screen.getByLabelText("Password"), "Str0ng-Passw0rd!");
  await user.type(
    screen.getByLabelText("Confirm password"),
    "Str0ng-Passw0rd!",
  );
  await user.click(screen.getByRole("button", { name: /create account/i }));
}

let user: ReturnType<typeof userEvent.setup>;

describe("AuthPage with a Supabase session", () => {
  beforeEach(() => {
    window.localStorage.clear();
    problem.message = null;
    store.recovering = false;
    store.settle(null);
    store.signIn.mockReset();
    store.register.mockReset();
    store.resendConfirmation.mockReset();
    store.refresh.mockReset();
    store.requestPasswordReset.mockReset();
    store.updatePassword.mockReset();
    store.signOut.mockReset();
    user = userEvent.setup();
  });

  it("shows the email and password form without the mock-only or canister options", async () => {
    await renderLogin();

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /use demo account/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
  });

  it("signs a verified account in", async () => {
    store.signIn.mockImplementation(async () => {
      store.settle(ada);
      return ada;
    });
    await renderLogin();

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
    expect(store.signIn).toHaveBeenCalledWith(
      "ada@example.com",
      "correct horse",
    );
  });

  it("keeps the visitor at the form when the session is refused", async () => {
    // The words shown are the project's own — `session.test.ts` proves the
    // rejection carries them; here what matters is that a refusal is not a
    // signed-in state.
    store.signIn.mockRejectedValue(new Error("Invalid login credentials"));
    await renderLogin();

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(store.signIn).toHaveBeenCalled());
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("carries a session-less sign-up to the verify screen with its address", async () => {
    // Supabase creates the user and returns no session when confirmation is on,
    // so the only thing this browser can still offer the new account is the URL.
    store.register.mockResolvedValue(null);
    await renderLogin();
    await fillRegister();

    expect(
      await screen.findByText(/is not confirmed yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /check the inbox and the spam folder of grace@example\.com/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
    expect(store.resendConfirmation).not.toHaveBeenCalled();

    await user.click(
      await screen.findByRole("button", { name: /send the link again/i }),
    );
    expect(store.resendConfirmation).toHaveBeenCalledWith("grace@example.com");
  });

  it("prefers the address the link is for when it comes back to sign in", async () => {
    store.register.mockResolvedValue(null);
    await renderLogin();
    await fillRegister();

    await user.click(
      await screen.findByRole("link", { name: /back to sign in/i }),
    );
    expect(
      (await screen.findByLabelText("Email")) as HTMLInputElement,
    ).toHaveValue("grace@example.com");
  });

  it("sends a correct password on an unconfirmed address to the verify screen", async () => {
    // "Email not confirmed" is the project's answer to a password that works,
    // and a toast of it leaves the visitor with nothing to click.
    store.signIn.mockRejectedValue(new Error("Email not confirmed"));
    await renderLogin();

    await user.type(await screen.findByLabelText("Email"), "grace@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(
      await screen.findByText(
        /check the inbox and the spam folder of grace@example\.com/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("keeps a rate-limited re-sending on the card, not just in a toast", async () => {
    store.register.mockResolvedValue(null);
    await renderLogin();
    await fillRegister();

    store.resendConfirmation.mockRejectedValue(
      new Error(
        "For security, our system will automatically resend the confirmation email in 2 minutes",
      ),
    );
    await user.click(
      await screen.findByRole("button", { name: /send the link again/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /automatically resend the confirmation email/i,
    );
    expect(
      screen.getByRole("button", { name: /send the link again in 30s/i }),
    ).toBeDisabled();
  });

  it("keeps asking the session store what another tab may have done", async () => {
    // Only the interval is faked, so the screen still opens on a pull: one call
    // as it mounts, then one per period while the address stays unconfirmed.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      await renderLogin("/verify-email?email=grace@example.com");
      expect(store.refresh).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(4100);
      expect(store.refresh).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards a session whose address turned out to be confirmed", async () => {
    store.register.mockResolvedValue(null);
    await renderLogin();
    await fillRegister();
    await screen.findByText(/is not confirmed yet/i);

    // This is what the pull above returns once the link is opened anywhere: the
    // screen has no reason to go on gating a confirmed account.
    act(() => {
      store.settle({ ...ada, email: "grace@example.com" });
    });
    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
  });

  it("sends a visitor with no address and no session back to the form", async () => {
    await renderLogin("/verify-email");

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
  });

  it("sends an unconfirmed account to the verify screen, which only re-sends", async () => {
    store.register.mockImplementation(async () => {
      store.settle({
        ...ada,
        email: "grace@example.com",
        emailVerified: false,
      });
      return { ...ada, email: "grace@example.com", emailVerified: false };
    });
    await renderLogin();
    await fillRegister();

    expect(await screen.findByText(/verify your email/i)).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: /send the link again/i }),
    );

    expect(store.resendConfirmation).toHaveBeenCalledWith("grace@example.com");
    expect(
      screen.getByRole("button", { name: /send the link again/i }),
    ).toBeInTheDocument();
  });

  it("does not offer the browser-side confirmation shortcut", async () => {
    store.register.mockImplementation(async () => {
      store.settle({
        ...ada,
        email: "grace@example.com",
        emailVerified: false,
      });
      return { ...ada, email: "grace@example.com", emailVerified: false };
    });
    await renderLogin();
    await fillRegister();

    await screen.findByText(/verify your email/i);
    expect(
      screen.queryByRole("button", { name: /confirm this email/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/local development mode/i),
    ).not.toBeInTheDocument();
  });

  it("offers a way to reset a forgotten password", async () => {
    await renderLogin();

    expect(
      await screen.findByRole("link", { name: /send a reset link/i }),
    ).toBeInTheDocument();
  });

  it("asks for an address and sends the reset link to it", async () => {
    store.requestPasswordReset.mockResolvedValue(undefined);
    await renderLogin();

    await user.click(
      await screen.findByRole("link", { name: /send a reset link/i }),
    );
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: /send the reset link/i }),
    );

    await waitFor(() =>
      expect(store.requestPasswordReset).toHaveBeenCalledWith(
        "ada@example.com",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      /if ada@example\.com has an account/i,
    );
  });

  it("carries the address from the sign-in card to the reset form", async () => {
    await renderLogin("/login?email=grace@example.com");

    await user.click(
      await screen.findByRole("link", { name: /send a reset link/i }),
    );
    expect(
      (await screen.findByLabelText("Email")) as HTMLInputElement,
    ).toHaveValue("grace@example.com");
  });

  it("keeps a refused reset request on the card", async () => {
    // A project that has not been told the redirect is allowed answers with this,
    // and the visitor would otherwise wait for an email that was never sent.
    store.requestPasswordReset.mockRejectedValue(
      new Error("Redirect not allowed"),
    );
    await renderLogin("/forgot-password");

    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: /send the reset link/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /redirect not allowed/i,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("sends the new password the reset link was opened for", async () => {
    store.updatePassword.mockResolvedValue(undefined);
    store.settleRecovery(ada);
    await renderLogin("/reset-password");

    await user.type(
      await screen.findByLabelText("New password"),
      "brand new secret",
    );
    await user.type(screen.getByLabelText("Confirm it"), "brand new secret");
    await user.click(
      screen.getByRole("button", { name: /save the new password/i }),
    );

    await waitFor(() =>
      expect(store.updatePassword).toHaveBeenCalledWith(
        "brand new secret",
        "brand new secret",
      ),
    );
  });

  it("says so when the reset page is opened without the link", async () => {
    await renderLogin("/reset-password");

    expect(
      await screen.findByText(/open the link from your email/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send a reset link/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });
});
