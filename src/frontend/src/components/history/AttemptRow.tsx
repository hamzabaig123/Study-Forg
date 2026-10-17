import { OutcomeBar } from "@/components/history/OutcomeBar";
import {
  formatAttemptDate,
  formatTimeLimit,
  modeLabel,
  scoreTone,
} from "@/components/history/format";
import { Badge } from "@/components/ui/badge";
import { formatDuration, formatPercent } from "@/lib/format";
import {
  type TestAttempt,
  attemptCounts,
  attemptDurationSeconds,
  attemptPercent,
} from "@/lib/testHistory";
import { cn } from "@/lib/utils";
import { SessionMode } from "@/types";
import { Link } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, Target, Timer } from "lucide-react";

interface AttemptRowProps {
  attempt: TestAttempt;
  index: number;
}

/** One finished test in the history list; the whole row opens its review. */
export function AttemptRow({ attempt, index }: AttemptRowProps) {
  const percent = attemptPercent(attempt);
  const counts = attemptCounts(attempt);
  const duration = attemptDurationSeconds(attempt);
  const isTimed = attempt.mode === SessionMode.timedTest;
  const ModeIcon = isTimed ? Timer : Target;
  const context = [...attempt.subjects, ...attempt.classes].join(" · ");

  return (
    <li>
      <Link
        to="/history/$kind/$id"
        params={{ kind: attempt.kind, id: attempt.id }}
        data-ocid={`history.attempt.${index + 1}`}
        aria-label={`${attempt.title}, ${modeLabel(attempt.mode)}, ${formatPercent(percent)}, ${formatAttemptDate(attempt.completedAtMs)}`}
        className="group flex items-start gap-4 px-5 py-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:items-center"
      >
        <span
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full sm:mt-0",
            isTimed ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary",
          )}
          aria-hidden="true"
        >
          <ModeIcon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p
              dir="auto"
              className="min-w-0 truncate text-sm font-semibold text-foreground"
            >
              {attempt.title}
            </p>
            <Badge variant="outline" className="font-normal">
              {modeLabel(attempt.mode)}
            </Badge>
            {attempt.kind === "custom" ? (
              <Badge variant="secondary" className="font-normal">
                Test Builder
              </Badge>
            ) : null}
            {attempt.contentRemoved ? (
              <Badge
                variant="outline"
                className="border-warning/50 font-normal text-warning"
              >
                Content removed
              </Badge>
            ) : null}
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden="true" />
              {formatAttemptDate(attempt.completedAtMs)}
            </span>
            {duration !== null ? (
              <span className="numeric">{formatDuration(duration)}</span>
            ) : null}
            {attempt.timeLimitSeconds ? (
              <span>{formatTimeLimit(attempt.timeLimitSeconds)}</span>
            ) : null}
            {context ? (
              <span dir="auto" className="min-w-0 truncate">
                {context}
              </span>
            ) : null}
          </p>

          <OutcomeBar
            correct={counts.correct}
            wrong={counts.wrong}
            skipped={counts.skipped}
            className="mt-2.5 max-w-sm"
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <p
              className={cn(
                "numeric text-lg font-semibold leading-none",
                scoreTone(percent),
              )}
            >
              {formatPercent(percent)}
            </p>
            <p className="numeric mt-1 text-xs text-muted-foreground">
              {attempt.score}/{attempt.total}
            </p>
          </div>
          <ChevronRight
            className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </div>
      </Link>
    </li>
  );
}
