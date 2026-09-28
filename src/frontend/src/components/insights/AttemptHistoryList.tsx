import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatPercent, scorePercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SessionMode } from "@/types";
import type { AttemptSummary } from "@/types";
import { Link } from "@tanstack/react-router";
import { History, Timer, Trophy } from "lucide-react";

interface AttemptHistoryListProps {
  attempts: AttemptSummary[];
  /** Cap the rendered rows; omit to show every attempt. */
  limit?: number;
  className?: string;
}

function modeLabel(mode: SessionMode): string {
  return mode === SessionMode.timedTest ? "Timed test" : "Practice";
}

function scoreTone(percent: number): string {
  if (percent >= 80) return "text-success";
  if (percent >= 50) return "text-warning";
  return "text-destructive";
}

/**
 * Practice and test attempt history, newest first. Each row shows the scope,
 * mode, completion time, and score as a percentage of the questions answered.
 */
export function AttemptHistoryList({
  attempts,
  limit,
  className,
}: AttemptHistoryListProps) {
  const rows = typeof limit === "number" ? attempts.slice(0, limit) : attempts;

  return (
    <Card
      data-ocid="analytics.attempt_history"
      className={cn(
        "gap-0 rounded-lg border-border/70 py-0 shadow-none",
        className,
      )}
    >
      <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <CardTitle className="flex items-center gap-2 font-display text-base font-semibold">
          <History
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          Attempt history
        </CardTitle>
        {attempts.length > 0 ? (
          <span className="numeric text-xs text-muted-foreground">
            {attempts.length} {attempts.length === 1 ? "attempt" : "attempts"}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 py-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="No attempts yet"
            description="Start a practice session or a timed test and your scores will appear here over time."
            className="border-0 bg-transparent py-10"
            action={
              <Button asChild type="button" className="gap-2 rounded-full">
                <Link
                  to="/dashboard"
                  data-ocid="analytics.start_session_button"
                >
                  <Timer className="size-4" aria-hidden="true" />
                  Start a session
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="stagger divide-y divide-border/60">
            {rows.map((attempt, index) => {
              const percent = scorePercent(attempt.score, attempt.total);
              return (
                <li
                  key={attempt.id.toString()}
                  data-ocid={`analytics.attempt.${index}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      attempt.mode === SessionMode.timedTest
                        ? "bg-accent/10 text-accent"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {attempt.mode === SessionMode.timedTest ? (
                      <Timer className="size-4" aria-hidden="true" />
                    ) : (
                      <Trophy className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {attempt.scopeLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {modeLabel(attempt.mode)} ·{" "}
                      {formatDateTime(attempt.completedAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        "numeric text-sm font-semibold",
                        scoreTone(percent),
                      )}
                    >
                      {formatPercent(percent)}
                    </p>
                    <p className="numeric mt-0.5 text-xs text-muted-foreground">
                      {attempt.score.toString()}/{attempt.total.toString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
