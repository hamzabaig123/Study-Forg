import Landing from "@/pages/Landing";
import { setLocalAccount, setMockActor } from "@/test/coreMock";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The signed-in test signs in through a local account.
vi.mock("@/lib/authMode", () => ({ USE_LOCAL_ACCOUNTS: true }));

describe("Landing page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setMockActor(null);
  });

  it("renders the value proposition and a registration call to action without a blank screen", async () => {
    await renderWithProviders(<Landing />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /forge your study material into real recall/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: /create your account/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /create a qr code/i }).length,
    ).toBeGreaterThan(0);
  });

  it("shows the feature highlights and question types", async () => {
    await renderWithProviders(<Landing />);

    expect(
      screen.getByRole("heading", { name: /ai question generation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /practice & timed tests/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /multiple choice/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /true \/ false/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /short answer/i }),
    ).toBeInTheDocument();
  });

  it("sends the registration call to action to the account form", async () => {
    await renderWithProviders(<Landing />);

    for (const link of screen.getAllByRole("link", {
      name: /create your account/i,
    })) {
      expect(link).toHaveAttribute("href", "/register");
    }
  });

  it("offers a dashboard link instead of registration when signed in", async () => {
    setLocalAccount();

    await renderWithProviders(<Landing />);

    expect(
      screen.getAllByRole("link", { name: /go to your dashboard/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: /create your account/i }),
    ).not.toBeInTheDocument();
  });
});
