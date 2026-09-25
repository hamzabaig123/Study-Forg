import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/**
 * Global test setup.
 *
 * `matchMedia` and `ResizeObserver` are not implemented by jsdom but are used
 * by the responsive layout and the chart container, so they are stubbed here
 * rather than in each test.
 */
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * jsdom does not implement the pointer-capture and scroll APIs that Radix UI
 * primitives (Select, DropdownMenu, Dialog) call during interaction. Without
 * these stubs, opening a Radix Select throws
 * `target.hasPointerCapture is not a function` and its options never render.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * jsdom defines `window.scrollTo` but its implementation throws a
 * "Not implemented" error. The real router calls it during scroll
 * restoration, so mounting the exported router logs that error even though
 * the render succeeds. Override it unconditionally with a no-op.
 */
window.scrollTo = (() => {}) as typeof window.scrollTo;

vi.mock("@caffeineai/core-infrastructure", async () => {
  const { coreMockState } = await import("@/test/coreMock");
  return {
    useActor: () => ({ actor: coreMockState.actor, isFetching: false }),
    useInternetIdentity: () => coreMockState.auth,
    createActorWithConfig: () => coreMockState.actor,
    InternetIdentityProvider: ({ children }: { children: unknown }) => children,
  };
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
