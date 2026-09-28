import { useEffect } from "react";

/**
 * Feeds the CSS spotlight (`[data-slot="card"]::after` in index.css) the
 * pointer position as custom properties on whichever card is hovered.
 *
 * One delegated `pointermove` listener for the whole app — cards themselves
 * stay stateless, and touch devices are skipped entirely (they never hover,
 * and the ::after is `display: none` there anyway). The rAF throttle keeps
 * the work at one layout read/write pair per frame however fast the pointer
 * moves.
 */
export function useCardSpotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return;
    }
    let frame = 0;
    let lastEvent: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const event = lastEvent;
      lastEvent = null;
      if (!event) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const card = target.closest<HTMLElement>('[data-slot="card"]');
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
      card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
    };

    const onMove = (event: PointerEvent) => {
      lastEvent = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
