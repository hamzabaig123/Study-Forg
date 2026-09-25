import Classes from "@/pages/Classes";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { makeClass } from "@/test/fixtures";
import { createMockActor } from "@/test/mockActor";
import { renderWithProviders } from "@/test/render";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the top of the content hierarchy. The class
 * list, its empty state, and the create flow must keep working while unrelated
 * navigation and routing surfaces change.
 */
describe("Classes", () => {
  beforeEach(() => {
    setMockAuth(createAuthState({ isAuthenticated: true }));
  });

  it("lists the caller's classes with their subject counts", async () => {
    const actor = createMockActor({
      listClasses: vi
        .fn()
        .mockResolvedValue([
          makeClass({ id: 1n, name: "Biology 101", subjectCount: 2n }),
          makeClass({ id: 2n, name: "Chemistry 201", subjectCount: 0n }),
        ]),
    });
    setMockActor(actor);

    await renderWithProviders(<Classes />);

    expect(await screen.findByText("Biology 101")).toBeInTheDocument();
    expect(screen.getByText("Chemistry 201")).toBeInTheDocument();
    expect(screen.getByText("2 subjects")).toBeInTheDocument();
    expect(screen.getByText("0 subjects")).toBeInTheDocument();
  });

  it("shows the empty state when the caller has no classes", async () => {
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([]),
    });
    setMockActor(actor);

    await renderWithProviders(<Classes />);

    await waitFor(() => {
      expect(screen.getByText(/no classes yet/i)).toBeInTheDocument();
    });
  });

  it("creates a class through the dialog and calls the actor", async () => {
    const user = userEvent.setup();
    const createClass = vi.fn().mockResolvedValue(makeClass());
    const actor = createMockActor({
      listClasses: vi.fn().mockResolvedValue([]),
      createClass,
    });
    setMockActor(actor);

    await renderWithProviders(<Classes />);

    await user.click(await screen.findByRole("button", { name: /new class/i }));
    await user.type(await screen.findByLabelText(/^name$/i), "Physics 101");
    await user.click(screen.getByRole("button", { name: /create class/i }));

    await waitFor(() => {
      expect(createClass).toHaveBeenCalledTimes(1);
    });
    expect(createClass.mock.calls[0][0]).toBe("Physics 101");
  });

  it("shows an error state when the class list fails to load", async () => {
    const actor = createMockActor({
      listClasses: vi.fn().mockRejectedValue(new Error("boom")),
    });
    setMockActor(actor);

    await renderWithProviders(<Classes />);

    expect(
      await screen.findByText(/couldn't load classes/i),
    ).toBeInTheDocument();
  });
});
