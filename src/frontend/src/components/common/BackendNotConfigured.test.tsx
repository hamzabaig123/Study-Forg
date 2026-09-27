import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The screen's whole job is to say what is wrong, so `SUPABASE_PROBLEM` is the
 * subject under test rather than a detail.
 *
 * `vi.doMock` after `resetModules()` rather than one hoisted `vi.mock`: the
 * constant is read at import time, so a factory registered once answers every
 * case with the first case's value, and the "no problem string" branch silently
 * renders the message from the test before it.
 */
async function renderScreen(problem: string | null) {
  vi.resetModules();
  vi.doMock("@/lib/supabase/env", () => ({ SUPABASE_PROBLEM: problem }));
  const { BackendNotConfigured: Screen } = await import(
    "@/components/common/BackendNotConfigured"
  );
  render(<Screen />);
}

describe("BackendNotConfigured", () => {
  it("quotes the exact complaint it was given", async () => {
    await renderScreen(
      "VITE_SUPABASE_ANON_KEY looks truncated. Copy the whole publishable key from Project Settings → API keys.",
    );

    expect(
      screen.getByText(/VITE_SUPABASE_ANON_KEY looks truncated/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "StudyForge" }),
    ).toBeInTheDocument();
  });

  it("still explains itself when the backend was selected without a problem string", async () => {
    await renderScreen(null);

    expect(screen.getByText(/no data can be loaded/i)).toBeInTheDocument();
  });

  it("names the file, both variables and the offline escape hatch", async () => {
    await renderScreen("VITE_SUPABASE_URL is not set.");

    expect(screen.getByText("src/frontend/.env.local")).toBeInTheDocument();
    expect(screen.getByText("VITE_SUPABASE_URL")).toBeInTheDocument();
    expect(screen.getByText("VITE_SUPABASE_ANON_KEY")).toBeInTheDocument();
    expect(screen.getByText(/VITE_DATA_BACKEND=mock/)).toBeInTheDocument();
    // Three numbered steps plus a restart note: the screen is a fix, not a shrug.
    expect(screen.getByText(/Restart the dev server/i)).toBeInTheDocument();
  });

  it("links out to the dashboard without leaking the referrer", async () => {
    await renderScreen("VITE_SUPABASE_URL is not set.");

    const link = screen.getByRole("link", {
      name: /Open the Supabase dashboard/i,
    });
    expect(link).toHaveAttribute("href", "https://supabase.com/dashboard");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(link).toHaveAttribute("target", "_blank");
  });
});
