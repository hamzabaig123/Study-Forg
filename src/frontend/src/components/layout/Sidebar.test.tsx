import { Sidebar } from "@/components/layout/Sidebar";
import { renderWithProviders } from "@/test/render";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * Characterization baseline for the existing sidebar navigation.
 *
 * The build intentionally adds new entries (QR Generator, Notes, Settings), so
 * this test freezes only the entries that already exist and must survive: each
 * one keeps its label and its destination. It deliberately does not assert the
 * absence of any new entry.
 */
describe("Sidebar", () => {
  it("keeps the existing study and distribute navigation entries", async () => {
    await renderWithProviders(<Sidebar open onClose={vi.fn()} />);

    const expected: Array<[string, string]> = [
      ["Dashboard", "/dashboard"],
      ["Classes", "/classes"],
      ["AI Studio", "/ai-studio"],
      ["Analytics", "/analytics"],
      ["Share", "/share"],
      ["Export", "/export"],
    ];

    for (const [label, href] of expected) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", href);
    }
  });

  it("keeps the sidebar landmark and its close control", async () => {
    const onClose = vi.fn();
    await renderWithProviders(<Sidebar open onClose={onClose} />);

    expect(
      screen.getByRole("complementary", { name: /primary navigation/i }),
    ).toBeInTheDocument();
    // The backdrop and the close button share the label, so assert the
    // dedicated close control by its stable test id.
    expect(
      document.querySelector('[data-ocid="nav.sidebar_close_button"]'),
    ).not.toBeNull();
  });
});
