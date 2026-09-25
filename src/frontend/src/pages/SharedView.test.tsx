import SharedView from "@/pages/SharedView";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makePublicQuestion, makeSharedContent } from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderRoute } from "@/test/render";
import { QuestionType } from "@/types";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the public read-only share view. Anyone with
 * the token can open it without signing in, so it must keep resolving the
 * token through the actor and rendering the shared questions with answers
 * withheld.
 */
describe("SharedView", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: false }));
  });

  it("renders the shared title, breadcrumb, and questions for a valid token", async () => {
    const actor = createMockActor({
      getSharedContent: vi.fn().mockResolvedValue(makeSharedContent()),
    });
    setMockActor(actor);

    await renderRoute(<SharedView />, {
      path: "/shared/$token",
      initialPath: "/shared/abc123",
    });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Mitochondria" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cell Biology")).toBeInTheDocument();
    expect(
      screen.getByText("Which organelle produces ATP?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/answers hidden/i)).toBeInTheDocument();
    expect(actor.getSharedContent).toHaveBeenCalledWith("abc123");
  });

  it("renders the unavailable state when the token does not resolve", async () => {
    const actor = createMockActor({
      getSharedContent: vi.fn().mockResolvedValue(null),
    });
    setMockActor(actor);

    await renderRoute(<SharedView />, {
      path: "/shared/$token",
      initialPath: "/shared/revoked",
    });

    expect(
      await screen.findByText(/this link is no longer available/i),
    ).toBeInTheDocument();
  });

  it("renders the empty state when the share has no questions", async () => {
    const actor = createMockActor({
      getSharedContent: vi.fn().mockResolvedValue(
        makeSharedContent({
          questions: [],
        }),
      ),
    });
    setMockActor(actor);

    await renderRoute(<SharedView />, {
      path: "/shared/$token",
      initialPath: "/shared/empty",
    });

    expect(
      await screen.findByText(/no questions in this share yet/i),
    ).toBeInTheDocument();
  });

  it("renders a true/false question with its two options and no answer", async () => {
    const actor = createMockActor({
      getSharedContent: vi.fn().mockResolvedValue(
        makeSharedContent({
          questions: [
            makePublicQuestion({
              id: 11n,
              questionType: QuestionType.trueFalse,
              prompt: "The mitochondria is the powerhouse of the cell.",
              options: [],
            }),
          ],
        }),
      ),
    });
    setMockActor(actor);

    await renderRoute(<SharedView />, {
      path: "/shared/$token",
      initialPath: "/shared/tf",
    });

    expect(
      await screen.findByText(/powerhouse of the cell/i),
    ).toBeInTheDocument();
    expect(screen.getByText("True")).toBeInTheDocument();
    expect(screen.getByText("False")).toBeInTheDocument();
  });
});
