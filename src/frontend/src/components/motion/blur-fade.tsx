import { cn } from "@/lib/utils";
import { m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

type BlurFadeProps = {
  children: ReactNode;
  className?: string;
  /** Seconds to wait before this element starts. Keep it under ~0.6 — past
   * that the reader has moved on and the entrance reads as a lag. */
  delay?: number;
  /** How far it travels while fading in. `0` turns the reveal into a pure fade. */
  distance?: number;
  /** Set for the few elements that should arrive last, after a sibling tree. */
  duration?: number;
  /** A focus pull re-filters the whole subtree on every frame, and the cost
   * scales with its painted height — on a container that can run thousands of
   * pixels tall (a full question review) it lands on the software path and
   * stutters. Tall lists set `blur={false}` and arrive on rise and fade alone. */
  blur?: boolean;
};

/**
 * The entrance this app uses for anything that appears when it is first
 * painted: a rise, a fade, and a blur that snaps into focus.
 *
 * It animates on mount rather than on scroll because jsdom has no
 * IntersectionObserver, which would make every wrapped element invisible in
 * the suite — and because the screens it sits on (the landing sections, the
 * result summary) are shorter than a scroll anyway.
 *
 * Under `prefers-reduced-motion` the provider already refuses the transform;
 * the blur is dropped here as well, since a focus pull is exactly the kind of
 * change that preference is asking to be spared.
 */
export function BlurFade({
  children,
  className,
  delay = 0,
  distance = 14,
  duration = 0.5,
  blur = true,
}: BlurFadeProps) {
  const reduce = useReducedMotion();
  const focusPull = blur && !reduce;

  return (
    <m.div
      initial={{
        opacity: 0,
        y: distance,
        filter: focusPull ? "blur(6px)" : undefined,
      }}
      animate={{
        opacity: 1,
        y: 0,
        filter: focusPull ? "blur(0px)" : undefined,
      }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className={cn(className)}
    >
      {children}
    </m.div>
  );
}
