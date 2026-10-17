import { cn } from "@/lib/utils";

interface OutcomeBarProps {
  correct: number;
  wrong: number;
  skipped: number;
  className?: string;
}

/** Correct / wrong / skipped as one segmented bar, with the counts spelled out. */
export function OutcomeBar({
  correct,
  wrong,
  skipped,
  className,
}: OutcomeBarProps) {
  const total = correct + wrong + skipped;
  const segments = [
    { key: "correct", value: correct, className: "bg-success" },
    { key: "wrong", value: wrong, className: "bg-destructive" },
    { key: "skipped", value: skipped, className: "bg-muted-foreground/35" },
  ].filter((segment) => segment.value > 0);
  const summary = [
    `${correct} correct`,
    `${wrong} wrong`,
    ...(skipped > 0 ? [`${skipped} skipped`] : []),
  ].join(" · ");

  return (
    <div className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={summary}
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        {total > 0
          ? segments.map((segment) => (
              <span
                key={segment.key}
                className={cn("h-full", segment.className)}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))
          : null}
      </div>
      <p
        aria-hidden="true"
        className="numeric mt-1.5 text-[0.7rem] text-muted-foreground"
      >
        {summary}
      </p>
    </div>
  );
}
