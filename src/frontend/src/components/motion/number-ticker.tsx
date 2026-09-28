import { cn } from "@/lib/utils";
import { useLayoutEffect, useRef } from "react";

type NumberTickerProps = {
  value: number;
  className?: string;
  decimals?: number;
  /** Seconds the count takes. Short, because it sits on top of a number the
   *  reader is already trying to read. */
  duration?: number;
  prefix?: string;
  suffix?: string;
};

/**
 * Whether this environment should see the count at all. The test environment
 * and reduced motion must never paint a wrong number, not even for the single
 * frame between mount and the count settling.
 */
const shouldTick = () =>
  typeof window !== "undefined" &&
  import.meta.env.MODE !== "test" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Counts to a value instead of snapping to it — the stat-card and score
 * treatment borrowed from Magic UI's number ticker.
 *
 * It runs on `requestAnimationFrame` rather than on the Motion runtime on
 * purpose: the runtime lives in a lazily fetched chunk, and a hook that pulls
 * it into the entry bundle to animate four digits would cost more than the
 * effect is worth.
 *
 * The first mount counts up from zero — that climb is the whole point on a
 * score that was just earned. Every change after that starts from wherever the
 * number already is, so a dashboard whose data arrives later counts from the
 * previous reading instead of restarting from zero. Reduced motion, and the
 * test environment, get the final number on the first paint.
 *
 * The intermediate values go into the text node, not into React state: a
 * four-stat dashboard would otherwise ask React to render the whole tree sixty
 * times a second, and the frame budget that buys is the same one the count is
 * spent on. Because of that the JSX renders the *final* value — the layout
 * effect rewrites it before the first paint when the count is going to run.
 */
export function NumberTicker({
  value,
  className,
  decimals = 0,
  duration = 0.8,
  prefix = "",
  suffix = "",
}: NumberTickerProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const fromRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const paint = (n: number) => {
      el.textContent = n.toFixed(decimals);
    };

    if (!shouldTick()) {
      fromRef.current = value;
      paint(value);
      return;
    }

    const from = fromRef.current ?? 0;
    if (from === value) {
      paint(value);
      return;
    }

    const startedAt = performance.now();
    paint(from);
    let frame = 0;
    const step = (now: number) => {
      // `now` is the frame's own timestamp, taken before this frame's layout
      // work, so it can land behind the `startedAt` read above. Uncorrected,
      // the first frame runs with negative progress and paints a negative
      // number — measured at -39% for a score of 88.
      const t = Math.min(1, Math.max(0, (now - startedAt) / (duration * 1000)));
      // easeOutQuart — fast out of the gate, then a long settle.
      const eased = 1 - (1 - t) ** 4;
      const current = from + (value - from) * eased;
      fromRef.current = t === 1 ? value : current;
      paint(current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
  }, [value, duration, decimals]);

  return (
    <span className={cn("numeric tabular-nums", className)}>
      {prefix}
      <span ref={textRef}>{value.toFixed(decimals)}</span>
      {suffix}
    </span>
  );
}
