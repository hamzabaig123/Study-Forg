import { BlurFade } from "@/components/motion/blur-fade";
import { ConfettiBurst } from "@/components/motion/confetti-burst";
import { NumberTicker } from "@/components/motion/number-ticker";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Target, Timer, Trophy } from "lucide-react";

interface ScoreSummaryProps {
  percent: number;
  score: number;
  total: number;
  /** Wall-clock time from session start to completion. */
  durationSeconds: number;
  /** One-line reaction under the score, e.g. "Strong work." */
  message?: string;
  /** Deterministic-test marker. */
  marker?: string;
}

/**
 * The score ring with correct/missed/time stats, shared by the backend results
 * page and the custom-test results page.
 */
export function ScoreSummary({
  percent,
  score,
  total,
  durationSeconds,
  message,
  marker = "results",
}: ScoreSummaryProps) {
  return (
    <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      {/* 75 is where `scoreMessage` starts saying "strong work", so the paper
          and the words celebrate the same result or neither does. */}
      {percent >= 75 ? <ConfettiBurst /> : null}
      <div className="flex flex-col items-center">
        <div className="relative flex size-32 items-center justify-center">
          <svg
            viewBox="0 0 120 120"
            className="absolute inset-0 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              strokeWidth="10"
              className="stroke-muted"
            />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 52}
              strokeDashoffset={2 * Math.PI * 52 * (1 - percent / 100)}
              className={cn(
                "score-ring-fg",
                percent >= 75
                  ? "stroke-success"
                  : percent >= 50
                    ? "stroke-primary"
                    : "stroke-destructive",
              )}
            />
          </svg>
          <div className="flex flex-col items-center">
            <span
              data-ocid={`${marker}.score`}
              className="numeric text-3xl font-semibold"
            >
              <NumberTicker value={percent} suffix="%" duration={1.1} />
            </span>
            <span className="text-muted-foreground text-[0.65rem] font-medium tracking-widest uppercase">
              score
            </span>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 text-center sm:text-left">
        <p className="font-display text-lg font-semibold">
          {score} of {total} correct
        </p>
        {message ? (
          <p className="text-muted-foreground mt-1 text-sm">{message}</p>
        ) : null}
        <Progress
          value={percent}
          className="mt-4 h-2"
          aria-label={`Score ${percent.toFixed(0)} percent`}
        />
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            icon={<Trophy className="size-3.5" aria-hidden="true" />}
            label="Correct"
            value={`${score}`}
          />
          <Stat
            icon={<Target className="size-3.5" aria-hidden="true" />}
            label="Missed"
            value={`${Math.max(0, total - score)}`}
          />
          <Stat
            icon={<Timer className="size-3.5" aria-hidden="true" />}
            label="Time"
            value={formatDuration(durationSeconds)}
          />
        </dl>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2">
      <dt className="text-muted-foreground flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wider uppercase">
        {icon}
        {label}
      </dt>
      <dd className="numeric mt-0.5 text-base font-semibold">{value}</dd>
    </div>
  );
}
