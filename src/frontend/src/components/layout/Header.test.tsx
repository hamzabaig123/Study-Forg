import { Header } from "@/components/layout/Header";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
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
import { describe, expect, it, vi } from "vitest";

/**
 * The header against a real canister: the session is an Internet Identity
 * principal, so there is no account record to read an email from, and signing
 * out clears the identity rather than a stored local session.
 */
async function renderHeader(auth: MockAuthState) {
  setMockAuth(auth);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <Header />,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, loginRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
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

describe("Header with Internet Identity", () => {
  it("shows the signed-in principal and signs out through the identity", async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    await renderHeader(createAuthState({ isAuthenticated: true, clear }));

    const menu = await screen.findByRole("button", { name: /2vxsx/i });
    expect(menu).toHaveTextContent("2vxsx…aba");

    await user.click(menu);
    await user.click(
      await screen.findByRole("menuitem", { name: /sign out/i }),
    );
    expect(clear).toHaveBeenCalled();
  });

  it("offers the sign-in link to a visitor without an identity", async () => {
    await renderHeader(
      createAuthState({ isAuthenticated: false, identity: null }),
    );

    expect(
      await screen.findByRole("link", { name: /sign in/i }),
    ).toHaveAttribute("href", "/login");
  });
});
