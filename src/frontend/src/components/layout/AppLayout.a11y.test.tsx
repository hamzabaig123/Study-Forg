import { readFileSync } from "node:fs";
import path from "node:path";
import { AppLayout } from "@/components/layout/AppLayout";
import { createAuthState, setMockActor, setMockAuth } from "@/test/coreMock";
import { createMockActor } from "@/test/mockActor";
import { renderPublicRoute } from "@/test/render";
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The keyboard and no-JavaScript floor.
 *
 * A page whose first tab stops are the header and the sidebar forces a keyboard
 * visitor through the whole chrome before the content, and a browser with
 * scripts disabled would show an empty box. Neither is visible to the rest of
 * the suite, so both are asserted here.
 */

// A repo file, so the path comes from the working directory: under jsdom
// `import.meta.url` is an http URL and `fileURLToPath` throws on it.
const documentHtml = readFileSync(
  path.join(process.cwd(), "index.html"),
  "utf8",
);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setMockAuth(createAuthState({ isAuthenticated: true }));
  setMockActor(createMockActor());
});

/** The signed-in shell, with its skip link already resolved. */
async function renderShell() {
  // Mounted as a page rather than as children of the root route, because the
  // helper that does the latter renders its argument twice.
  const view = await renderPublicRoute(<AppLayout />, {
    path: "/",
    initialPath: "/",
  });
  const link = await screen.findByRole("link", { name: /skip to content/i });
  return { ...view, link };
}

describe("skip to content", () => {
  it("comes before every other control a tab stop can reach", async () => {
    const { container, link } = await renderShell();

    const focusable = container.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable.length, "the shell renders its chrome").toBeGreaterThan(1);
    expect(focusable[0]).toBe(link);
  });

  it("jumps to a main region that can take focus", async () => {
    const { container, link } = await renderShell();

    expect(link.getAttribute("href")).toBe("#main");
    const target = container.querySelector<HTMLElement>("#main");
    expect(target?.tagName).toBe("MAIN");
    // Without this the anchor lands the scroll on the region but leaves the
    // focus where it was, so a screen reader keeps reading the chrome.
    expect(target?.tabIndex).toBe(-1);
  });
});

describe("the document without scripts", () => {
  it("says in plain words that the app needs JavaScript", () => {
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(documentHtml)?.[1];
    expect(noscript, "index.html should carry a <noscript> block").toBeTruthy();
    expect(noscript).toContain("<h1>StudyForge needs JavaScript</h1>");
    expect(noscript).toMatch(/enable\s+javascript/i);
  });

  it("keeps that content free of inline script", () => {
    // The Content-Security-Policy grants scripts no 'unsafe-inline', so a block
    // added here would be refused at runtime rather than fail the build.
    for (const script of documentHtml.match(/<script\b[^>]*>/g) ?? []) {
      expect(script, script).toContain(" src=");
    }
    expect(documentHtml).toMatch(/<script src="\/theme-bootstrap\.js">/);
  });
});
