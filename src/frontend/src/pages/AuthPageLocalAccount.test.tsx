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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Email/password accounts and the demo account exist only in dev-mock mode.
vi.mock("@/lib/authMode", () => ({ USE_LOCAL_ACCOUNTS: true }));

/**
 * The dev-mock sign-in screen. It keeps the local account form so the mock
 * backend stays usable without a canister, and it must not show the Internet
 * Identity options that only work against a real one.
 */
async function renderLogin() {
  setMockActor(null);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Public landing</h1>,
  });
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
      indexRoute,
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

describe("AuthPage with local accounts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps the email and password form", async () => {
    await renderLogin();

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with google/i }),
    ).not.toBeInTheDocument();
  });

  it("signs the demo account straight in", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.click(
      await screen.findByRole("button", { name: /use demo account/i }),
    );

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
    expect(
      JSON.parse(
        window.localStorage.getItem("studyforge.personal-session.v1") ?? "null",
      ),
    ).toMatchObject({ accountId: "studyforge-demo-account" });
  });

  it("registers a new account and sends it to email verification", async () => {
    const user = userEvent.setup();
    await renderLogin();

    await user.click(
      await screen.findByRole("link", { name: /create an account/i }),
    );
    await user.type(screen.getByLabelText("Name"), "Hamza");
    await user.type(screen.getByLabelText("Email"), "hamza@example.com");
    await user.type(screen.getByLabelText("Password"), "Str0ng-Passw0rd!");
    await user.type(
      screen.getByLabelText("Confirm password"),
      "Str0ng-Passw0rd!",
    );
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/confirm this email/i)).toBeInTheDocument();
  });
});
