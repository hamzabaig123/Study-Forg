/**
 * The one hook that decides whether the navigation is a drawer or a column.
 *
 * The bug this pins: the sidebar becomes a sticky column at `lg` (1024), but the
 * toggle used to disappear at 768, so a tablet in between had a menu that was
 * translated off screen and nothing on the page that could bring it back.
 */
import { useIsMobile } from "@/hooks/use-mobile";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

describe("useIsMobile", () => {
  const resize = new Event("resize");
  let originalWidth: number;

  beforeEach(() => {
    originalWidth = window.innerWidth;
  });

  afterEach(() => setWidth(originalWidth));

  it("counts a tablet as mobile, because that is where the sidebar comes back", () => {
    setWidth(900);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("is already right on the first render", () => {
    setWidth(900);
    const { result } = renderHook(() => useIsMobile());
    // An effect-only implementation reports `false` here, which paints a header
    // with no way to open the menu.
    expect(result.current).toBe(true);
  });

  it("gives the sidebar its column back at and above lg", () => {
    setWidth(1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => {
      setWidth(767);
      window.dispatchEvent(resize);
    });
    expect(result.current).toBe(true);
  });
});
