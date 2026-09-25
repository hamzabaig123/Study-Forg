import { router } from "@/router";
import { setMockActor } from "@/test/coreMock";
import { createTestQueryClient } from "@/test/render";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the existing route table.
 *
 * The build intentionally adds new routes (`/qr`, `/manage/$token`, `/r/$code`,
 * `/notes`, `/notes/$noteId`, `/settings`), so this test freezes only the paths
 * that already exist and must keep resolving. It deliberately does not assert
 * the absence of any new route.
 */

interface RouteNode {
  fullPath?: string;
  children?: RouteNode[];
}

function collectPaths(
  node: RouteNode,
  into: Set<string> = new Set(),
): Set<string> {
  if (typeof node.fullPath === "string") {
    into.add(node.fullPath);
  }
  for (const child of node.children ?? []) {
    collectPaths(child, into);
  }
  return into;
}

describe("router", () => {
  it("keeps every existing route path registered", () => {
    const paths = collectPaths(router.routeTree as unknown as RouteNode);

    const expected = [
      "/",
      "/shared/$token",
      "/dashboard",
      "/classes",
      "/classes/$classId",
      "/subjects/$subjectId",
      "/chapters/$chapterId",
      "/topics/$topicId",
      "/ai-studio",
      "/ai-settings",
      "/practice/$sessionId",
      "/test/$sessionId",
      "/results/$sessionId",
      "/analytics",
      "/share",
      "/export",
    ];

    for (const path of expected) {
      expect(paths.has(path), `expected route ${path} to be registered`).toBe(
        true,
      );
    }
  });
});

/**
 * The default route must keep resolving to the public landing page and render
 * its hero, rather than a blank screen. The landing page intentionally gains a
 * public QR generator section, so this asserts only the pre-existing hero
 * heading and sign-in call to action.
 */
describe("default route", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setMockActor(null);
  });

  it("renders the public landing hero at / instead of a blank screen", async () => {
    // The exported router uses browser history; jsdom's default URL is `/`.
    window.history.replaceState({}, "", "/");
    await router.load();

    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /forge your study material into real recall/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /create your account/i }).length,
    ).toBeGreaterThan(0);
  });
});
