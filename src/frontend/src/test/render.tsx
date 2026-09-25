import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { type RenderResult, render } from "@testing-library/react";
import type { ReactNode } from "react";

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface RenderWithProvidersOptions {
  /** Initial URL for the memory router, e.g. `/classes`. */
  initialPath?: string;
  queryClient?: QueryClient;
}

/**
 * Render a single component inside the providers the app supplies at runtime:
 * a fresh QueryClient, the ThemeProvider, and a memory router whose root route
 * renders the component under test.
 *
 * The router is loaded before rendering so the matched route is present on the
 * first paint; without this `RouterProvider` renders an empty container.
 *
 * This is component/integration coverage, not a deployed browser journey.
 */
export async function renderWithProviders(
  ui: ReactNode,
  options: RenderWithProvidersOptions = {},
): Promise<RenderResult> {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <>{ui}</>,
  });
  const catchAllRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "$",
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, catchAllRoute]),
    history: createMemoryHistory({
      initialEntries: [options.initialPath ?? "/"],
    }),
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

interface RenderRouteOptions {
  /** Route path pattern, e.g. `/topics/$topicId`. */
  path: string;
  /** Concrete URL to visit, e.g. `/topics/4`. */
  initialPath: string;
  queryClient?: QueryClient;
}

/**
 * Render a public page at a real top-level route path so a strict
 * `useParams({ from: "/manage/$token" })` resolves.
 *
 * `renderRoute` nests the page under an `app` layout route, which changes the
 * route id to `/app/...`. Public routes (`/manage/$token`, `/r/$code`,
 * `/shared/note/$token`) live directly under the root route, so their strict
 * `from` lookups only match when the page is registered at the root.
 */
export async function renderPublicRoute(
  ui: ReactNode,
  options: RenderRouteOptions,
): Promise<RenderResult> {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: options.path,
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: [options.initialPath] }),
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
 * Render a page at a real route path so `useParams` resolves its params.
 *
 * `renderWithProviders` mounts the component at `/` and `/$`, which is enough
 * for pages that read no params. Pages that call
 * `useParams({ from: "/app/topics/$topicId" })` need the actual route tree, so
 * this helper registers the path under an `app` layout route that renders an
 * `<Outlet />` (a `null` parent would swallow the child).
 */
export async function renderRoute(
  ui: ReactNode,
  options: RenderRouteOptions,
): Promise<RenderResult> {
  const queryClient = options.queryClient ?? createTestQueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "app",
    component: () => <Outlet />,
  });
  const pageRoute = createRoute({
    getParentRoute: () => appRoute,
    path: options.path,
    component: () => <>{ui}</>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([pageRoute])]),
    history: createMemoryHistory({ initialEntries: [options.initialPath] }),
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
