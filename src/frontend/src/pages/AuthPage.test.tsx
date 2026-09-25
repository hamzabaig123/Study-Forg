import { ThemeProvider } from "@/components/theme/ThemeProvider";
import AuthPage from "@/pages/AuthPage";
import {
  type MockAuthState,
  createAuthState,
  setMockAuth,
} from "@/test/coreMock";
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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-in against a real canister. Every option runs through Internet Identity,
 * so the page offers no email/password form, no demo account, and no email
 * verification step.
 */
async function renderLogin(auth: MockAuthState) {
  setMockAuth(auth);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => <AuthPage mode="login" />,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboard",
    component: () => <h1>Dashboard body</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute, dashboardRoute]),
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

function signedOut(overrides: Partial<MockAuthState> = {}): MockAuthState {
  return createAuthState({
    isAuthenticated: false,
    identity: null,
    ...overrides,
  });
}

describe("AuthPage with Internet Identity", () => {
  let login: MockAuthState["login"];

  beforeEach(() => {
    login = vi.fn();
  });

  it("offers Internet Identity, Google and Microsoft instead of a password form", async () => {
    const user = userEvent.setup();
    await renderLogin(signedOut({ login }));

    expect(
      await screen.findByText(/sign in to studyforge/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /demo account/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(login).toHaveBeenCalledWith();

    await user.click(
      screen.getByRole("button", { name: /continue with google/i }),
    );
    expect(login).toHaveBeenLastCalledWith({ provider: "google" });

    await user.click(
      screen.getByRole("button", { name: /continue with microsoft/i }),
    );
    expect(login).toHaveBeenLastCalledWith({ provider: "microsoft" });
  });

  it("signs in through a workspace domain once one is typed", async () => {
    const user = userEvent.setup();
    await renderLogin(signedOut({ login }));

    const sso = screen.getByRole("button", { name: /^sso$/i });
    expect(sso).toBeDisabled();

    await user.type(
      screen.getByLabelText(/company or workspace domain/i),
      "acme.com",
    );
    expect(sso).toBeEnabled();
    await user.click(sso);
    expect(login).toHaveBeenLastCalledWith({ ssoDomain: "acme.com" });
  });

  it("shows why a sign-in failed", async () => {
    await renderLogin(
      signedOut({
        isLoginError: true,
        loginError: new Error("Popup closed before signing in."),
        login,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /popup closed before signing in/i,
    );
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeEnabled();
  });

  it("keeps the buttons waiting while the identity popup is open", async () => {
    await renderLogin(signedOut({ isLoggingIn: true, login }));

    expect(
      await screen.findByRole("button", {
        name: /waiting for internet identity/i,
      }),
    ).toBeDisabled();
    expect(login).not.toHaveBeenCalled();
  });

  it("moves an already signed-in visitor on to the dashboard", async () => {
    await renderLogin(createAuthState({ isAuthenticated: true }));

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
  });
});
