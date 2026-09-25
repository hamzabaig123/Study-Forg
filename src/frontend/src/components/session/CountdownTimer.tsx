import { formatClock } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface CountdownTimerProps {
  /** Total seconds the test was allotted. */
  durationSeconds: number;
  /** Seconds already elapsed when this component mounted. */
  initialElapsedSeconds?: number;
  /** Fired exactly once when the remaining time reaches zero. */
  onExpire: () => void;
  /** Pauses the countdown (e.g. while the result is being recorded). */
  paused?: boolean;
  /** Deterministic-test marker prefix, e.g. `timed`. */
  marker: string;
}

const RING_SIZE = 132;
const RING_STROKE = 9;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Visible countdown timer with a circular progress ring.
 *
 * The remaining time is rendered with the `numeric` utility so it stays
 * tabular and high-contrast in all three themes. The ring drains as time
 * passes and shifts to the destructive token in the final stretch.
 */
export function CountdownTimer({
  durationSeconds,
  initialElapsedSeconds = 0,
  onExpire,
  paused = false,
  marker,
}: CountdownTimerProps) {
  const [elapsed, setElapsed] = useState(() =>
    Math.min(Math.max(0, initialElapsedSeconds), durationSeconds),
  );
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    if (paused) return;
    const interval = window.setInterval(() => {
      setElapsed((current) => Math.min(current + 1, durationSeconds));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [paused, durationSeconds]);

  useEffect(() => {
    if (elapsed >= durationSeconds && !expiredRef.current) {
      expiredRef.current = true;
      onExpireRef.current();
    }
  }, [elapsed, durationSeconds]);

  const remaining = Math.max(0, durationSeconds - elapsed);
  const progress = durationSeconds > 0 ? remaining / durationSeconds : 0;
  const isCritical = remaining <= 30;
  const isWarning = !isCritical && remaining <= 60;

  return (
    <div
      data-ocid={`${marker}.timer`}
      className="flex flex-col items-center gap-3"
      aria-live="off"
    >
      <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <svg
          width={RING_SIZE}
          height={RING_SIZE}
          viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
          className="-rotate-90"
          aria-hidden="true"
        >
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            className="stroke-muted"
          />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress)}
            className={cn(
              "transition-[stroke-dashoffset] duration-1000 ease-linear",
              isCritical
                ? "stroke-destructive"
                : isWarning
                  ? "stroke-warning"
                  : "stroke-primary",
            )}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            data-ocid={`${marker}.timer_value`}
            className={cn(
              "numeric text-3xl font-semibold tabular-nums",
              isCritical ? "text-destructive" : "text-foreground",
            )}
          >
            {formatClock(remaining)}
          </span>
          <span className="text-muted-foreground mt-0.5 text-[0.65rem] font-medium tracking-widest uppercase">
            remaining
          </span>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        {isCritical
          ? "Time is almost up — the test submits automatically."
          : "The test submits automatically when time runs out."}
      </p>
    </div>
  );
}
