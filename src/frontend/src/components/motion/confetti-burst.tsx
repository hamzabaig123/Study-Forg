import { cn } from "@/lib/utils";
import { type CSSProperties, useEffect, useState } from "react";

/**
 * A short burst of paper confetti over a result the user earned.
 *
 * DOM pieces on CSS keyframes rather than a canvas library: the whole effect is
 * ~28 absolutely-positioned squares, and `canvas-confetti` would add a
 * dependency plus a second render surface for four seconds of celebration
 * nobody watches twice.
 *
 * The scatter is derived from the piece index, not `Math.random()`, so a rerender
 * mid-burst cannot reshuffle the pieces, and every run of the same result looks
 * the same. It removes itself when the last piece has landed.
 */

const COUNT = 28;
const PALETTE = [
  "bg-primary",
  "bg-success",
  "bg-warning",
  "bg-accent",
  "bg-destructive",
];

/** Deterministic 0..1 value per (index, salt) pair. */
function seeded(index: number, salt: number) {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Built once, at module scope. Two reasons: every burst of the same result
 * should look identical rather than re-scattered on each render, and a piece
 * carries its own id so React never keys a node to its position in the array.
 */
const PIECES = Array.from({ length: COUNT }, (_, i) => ({
  id: `confetti-${i}`,
  className: cn(
    PALETTE[i % PALETTE.length],
    i % 4 === 0 ? "rounded-full" : "rounded-[1px]",
  ),
  style: {
    left: `${4 + seeded(i, 1) * 92}%`,
    animationDelay: `${seeded(i, 2) * 0.45}s`,
    animationDuration: `${1.5 + seeded(i, 3) * 1}s`,
    "--confetti-drift": `${(seeded(i, 4) - 0.5) * 140}px`,
    "--confetti-spin": `${180 + seeded(i, 5) * 540}deg`,
    width: `${5 + Math.round(seeded(i, 6) * 4)}px`,
    height: `${8 + Math.round(seeded(i, 7) * 7)}px`,
  } as CSSProperties,
}));

export function ConfettiBurst({ className }: { className?: string }) {
  const [spent, setSpent] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSpent(true), 3200);
    return () => window.clearTimeout(timer);
  }, []);

  // Neither the test environment nor a reduced-motion visitor ever sees this:
  // the pieces are pure decoration, and decoration is what they opted out of.
  if (
    spent ||
    import.meta.env.MODE === "test" ||
    (typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  ) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {PIECES.map((piece) => (
        <span
          key={piece.id}
          style={piece.style}
          className={cn("confetti-piece", piece.className)}
        />
      ))}
    </div>
  );
}
