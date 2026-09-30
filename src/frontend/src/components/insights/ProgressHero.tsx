import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { Flame, ListChecks, Target, Zap } from "lucide-react";

interface ProgressHeroProps {
  /** 0–100 across every recorded attempt. */
  accuracyPercent: number;
  /** Question-weighted totals behind the accuracy figure. */
  answeredTotal: number;
  streakDays: number;
  bestStreakDays: number;
  attemptsToday: number;
  attemptCount: number;
  loading: boolean;
  /** True when the caller is still fetching history from the backend. */
}

/**
 * The dashboard's study-progress band: overall accuracy, day streak, and
 * today's activity, with a direct path into the test builder. Collapses to a
 * call-to-action strip before the first test exists.
 */
export function ProgressHero({
  accuracyPercent,
  answeredTotal,
  streakDays,
  bestStreakDays,
  attemptsToday,
  attemptCount,
  loading,
}: ProgressHeroProps) {
  const tone =
    accuracyPercent >= 75
      ? "text-success"
      : accuracyPercent >= 50
        ? "text-primary"
        : accuracyPercent > 0
          ? "text-warning"
          : "text-muted-foreground";

  return (
    <Card
      data-ocid="dashboard.progress_hero"
      className="relative gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 h-64 w-96 rounded-full bg-gradient-primary opacity-[0.07] blur-3xl"
      />
      <CardContent className="p-5 sm:p-6">
        {loading ? (
          <div className="grid gap-6 sm:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-20 animate-pulse rounded-lg bg-muted/70"
              />
            ))}
          </div>
        ) : attemptCount === 0 ? (
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Target className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold">
                  Your accuracy and streak start with one test
                </h3>
                <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">
                  Build a practice or timed test from any mix of your subjects —
                  accuracy, day streak, and history light up from your first
                  result.
                </p>
              </div>
            </div>
            <Button
              asChild
              type="button"
              className="shrink-0 gap-2 rounded-full bg-gradient-primary text-primary-foreground hover:shadow-elevated"
            >
              <Link to="/test-builder" data-ocid="dashboard.hero_build_button">
                <ListChecks className="size-4" aria-hidden="true" />
                Build a test
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="flex items-center gap-4 sm:border-r sm:border-border/60 sm:pr-5">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Target className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Accuracy
                </p>
                <p
                  data-ocid="dashboard.hero_accuracy"
                  className={cn(
                    "numeric text-2xl font-semibold leading-tight",
                    tone,
                  )}
                >
                  {accuracyPercent.toFixed(0)}%
                </p>
                <p className="numeric text-xs text-muted-foreground">
                  {answeredTotal.toLocaleString()} answered
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4 sm:border-r sm:border-border/60 sm:px-5">
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-xl",
                  streakDays > 0
                    ? "bg-warning/15 text-warning"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Flame className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Day streak
                </p>
                <p
                  data-ocid="dashboard.hero_streak"
                  className="numeric text-2xl font-semibold leading-tight"
                >
                  {streakDays}
                </p>
                <p className="text-xs text-muted-foreground">
                  Best streak {bestStreakDays} · {attemptsToday}{" "}
                  {attemptsToday === 1 ? "test today" : "tests today"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <div className="min-w-0 sm:hidden">
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Keep it going
                </p>
                <p className="text-sm text-muted-foreground">
                  One test keeps the flame alive.
                </p>
              </div>
              <Button
                asChild
                type="button"
                className="shrink-0 gap-2 rounded-full bg-gradient-primary text-primary-foreground hover:shadow-elevated"
              >
                <Link
                  to="/test-builder"
                  data-ocid="dashboard.hero_build_button"
                >
                  <Zap className="size-4" aria-hidden="true" />
                  Build a test
                </Link>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
