import { useEffect, useState } from "react";

/**
 * Whether the viewport is below the width where the sidebar becomes a sticky
 * column.
 *
 * The default is deliberately `lg` (1024), not a phone width: `Sidebar` slides
 * itself back in at `lg:translate-x-0`, so a toggle that disappeared at 768
 * would leave a tablet in a band where the navigation is translated off screen
 * and nothing on the page can bring it back.
 *
 * The first read is synchronous because the state seeds the hamburger in the
 * header — starting from `false` meant a phone painted a header with no way to
 * open the menu until the effect ran.
 */
export function useIsMobile(breakpoint = 1024): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < breakpoint);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [breakpoint]);
  return isMobile;
}
