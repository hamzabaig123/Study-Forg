import Analytics from "@/pages/Analytics";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the analytics surface. The empty state and the
 * attempt history must keep rendering from the actor's responses.
 */
describe("Analytics", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("shows the empty analytics state when there is no breakdown", async () => {
    const actor = createMockActor({
      getAnalyticsBreakdown: vi.fn().mockResolvedValue({
        byClass: [],
        bySubject: [],
        byQuestionType: [],
      }),
      getAttemptHistory: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<Analytics />);

    expect(await screen.findByText(/no analytics yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no attempts yet/i)).toBeInTheDocument();
  });

  it("renders the attempt history rows returned by the actor", async () => {
    const actor = createMockActor({
      getAnalyticsBreakdown: vi.fn().mockResolvedValue({
        byClass: [],
        bySubject: [],
        byQuestionType: [],
      }),
      getAttemptHistory: vi.fn().mockResolvedValue([
        {
          id: 7n,
          completedAt: 1_700_000_000_000_000_000n,
          total: 4n,
          mode: "practice" as never,
          scopeLabel: "Mitochondria",
          score: 3n,
        },
      ]),
    });
    setMockActor(actor);

    await renderWithProviders(<Analytics />);

    expect(await screen.findByText("Mitochondria")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("1 attempt")).toBeInTheDocument();
  });

  it("shows an error state when the breakdown query fails", async () => {
    const actor = createMockActor({
      getAnalyticsBreakdown: vi.fn().mockRejectedValue(new Error("boom")),
      getAttemptHistory: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<Analytics />);

    expect(
      await screen.findByText(/couldn't load analytics/i),
    ).toBeInTheDocument();
  });
});
