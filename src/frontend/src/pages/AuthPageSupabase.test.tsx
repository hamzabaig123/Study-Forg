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
import { render, screen, waitFor } from "@testing-library/react";
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
  snapshot: () => (store.current ? JSON.stringify(store.current) : "null"),
  subscribe(listener: () => void) {
    store.listeners.add(listener);
    return () => store.listeners.delete(listener);
  },
  signIn: vi.fn(),
  register: vi.fn(),
  resendConfirmation: vi.fn(),
  signOut: vi.fn(),
  settle(account: FakeAccount | null) {
    store.current = account;
    for (const listener of store.listeners) {
      listener();
    }
  },
};

vi.mock("@/lib/supabase/session", () => ({
  sessionStore: () => store,
}));

async function renderLogin() {
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
      dashboardRoute,
    ]),
    history: createMemoryHistory({ initialEntries: ["/login"] }),
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
    store.settle(null);
    store.signIn.mockReset();
    store.register.mockReset();
    store.resendConfirmation.mockReset();
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

  it("holds a new address at the login screen until its link is clicked", async () => {
    // Supabase creates the user and returns no session when confirmation is on,
    // and there is no verify screen to show for a browser that is still a visitor.
    store.register.mockResolvedValue(null);
    await renderLogin();
    await fillRegister();

    await waitFor(() => expect(store.register).toHaveBeenCalled());
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
    expect(store.resendConfirmation).not.toHaveBeenCalled();
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
});
