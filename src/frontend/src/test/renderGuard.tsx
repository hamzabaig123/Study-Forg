import { ThemeProvider } from "@/components/theme/ThemeProvider";
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
import { render } from "@testing-library/react";
import type { ComponentType } from "react";

/**
 * Mount the signed-in shell guard at `/dashboard`, alongside the public landing
 * page and the auth screens the guard can redirect to, so every branch of the
 * gate lands on a route that exists.
 *
 * The guard is passed in because the three `RequireAuth` suites differ only in
 * which authentication mode is pinned for the file.
 */
export async function renderGuard(Guard: ComponentType) {
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
  const resetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/reset-password",
    component: () => <h1>New password screen</h1>,
  });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    component: () => <Guard />,
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
      resetRoute,
      appRoute.addChildren([dashboardRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
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
