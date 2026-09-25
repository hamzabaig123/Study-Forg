import { RequireAuth } from "@/components/layout/RequireAuth";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { setLocalAccount, setMockActor } from "@/test/coreMock";
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
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Render the signed-in shell guard at `/dashboard`, alongside the public landing
 * page and the two auth screens the guard redirects to, so every branch of the
 * gate lands on a route that exists.
 */
async function renderGuard() {
  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const landingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <h1>Public landing</h1>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => <h1>Log in screen</h1>,
  });
  const verifyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/verify-email",
    component: () => <h1>Verify your email</h1>,
  });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    component: RequireAuth,
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/dashboard",
    component: () => <h1>Dashboard body</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      landingRoute,
      loginRoute,
      verifyRoute,
      appRoute.addChildren([dashboardRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
  });
  await router.load();
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/**
 * Characterization baseline for the account sign-in gate. The guard keeps
 * visitors without a session at the login screen, holds an account with an
 * unverified email at the verification screen, and renders the signed-in shell
 * once the email is verified.
 */
describe("RequireAuth", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setMockActor(null);
  });

  it("redirects a visitor without a session to the login screen", async () => {
    await renderGuard();

    expect(await screen.findByText("Log in screen")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("holds an account with an unverified email at the verification screen", async () => {
    setLocalAccount({ emailVerified: false });

    await renderGuard();

    expect(await screen.findByText("Verify your email")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("renders the signed-in shell for a verified account", async () => {
    setLocalAccount({ name: "Hamza" });

    await renderGuard();

    expect(await screen.findByText("Dashboard body")).toBeInTheDocument();
    expect(screen.getByText("StudyForge")).toBeInTheDocument();
  });
});
