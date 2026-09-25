import Dashboard from "@/pages/Dashboard";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makeClass } from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Dashboard", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("renders the five stat cards with the caller's totals", async () => {
    const actor = createMockActor({
      getDashboardStats: vi.fn().mockResolvedValue({
        classCount: 3n,
        subjectCount: 5n,
        chapterCount: 7n,
        topicCount: 11n,
        questionCount: 42n,
      }),
      getRecentActivity: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<Dashboard />);

    // The cards swap out of their loading skeleton once the actor resolves, so
    // wait for a loaded value before touching the label nodes.
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("Classes")).toBeInTheDocument();
    expect(screen.getByText("Subjects")).toBeInTheDocument();
    expect(screen.getByText("Chapters")).toBeInTheDocument();
    expect(screen.getByText("Topics")).toBeInTheDocument();
    expect(screen.getByText("Questions authored")).toBeInTheDocument();
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("shows the getting-started card when the caller has no content", async () => {
    const actor = createMockActor({
      getDashboardStats: vi.fn().mockResolvedValue({
        classCount: 0n,
        subjectCount: 0n,
        chapterCount: 0n,
        topicCount: 0n,
        questionCount: 0n,
      }),
      getRecentActivity: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<Dashboard />);

    expect(
      await screen.findByText(/start your first study set/i),
    ).toBeInTheDocument();
  });

  it("renders recent activity items returned by the actor", async () => {
    const actor = createMockActor({
      getDashboardStats: vi.fn().mockResolvedValue({
        classCount: 1n,
        subjectCount: 1n,
        chapterCount: 1n,
        topicCount: 1n,
        questionCount: 1n,
      }),
      getRecentActivity: vi.fn().mockResolvedValue([
        {
          kind: "class",
          title: "Biology 101",
          at: 1_700_000_000_000_000_000n,
        },
      ]),
    });
    setMockActor(actor);

    await renderWithProviders(<Dashboard />);

    expect(await screen.findByText("Biology 101")).toBeInTheDocument();
  });

  it("shows an error state when the stats query fails", async () => {
    const actor = createMockActor({
      getDashboardStats: vi.fn().mockRejectedValue(new Error("boom")),
      getRecentActivity: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText(/couldn't load your stats/i)).toBeInTheDocument();
    });
  });

  it("does not render a blank screen when the actor is not ready", async () => {
    setMockActor(null);

    await renderWithProviders(<Dashboard />);

    // The page shell renders even before the actor resolves.
    expect(screen.getByText("Classes")).toBeInTheDocument();
    expect(makeClass).toBeDefined();
  });
});
