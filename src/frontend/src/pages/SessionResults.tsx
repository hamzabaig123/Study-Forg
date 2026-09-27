import { ResultReview } from "@/components/session/ResultReview";
import { ScoreSummary } from "@/components/session/ScoreSummary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSessionResult } from "@/hooks/useSessions";
import { scorePercent } from "@/lib/format";
import { type Id, SessionMode } from "@/types";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, RotateCcw } from "lucide-react";

const MARKER = "results";

function parseId(value: unknown): Id | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function scoreMessage(percent: number): string {
  if (percent >= 90) return "Outstanding — you have this down.";
  if (percent >= 75) return "Strong work. A quick review will lock it in.";
  if (percent >= 50) return "Solid start. Review the misses below.";
  return "Keep going — the review below is where the learning happens.";
}

/**
 * Results summary: score, correct out of total, and a per-question review.
 */
export default function SessionResults() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const sessionId = parseId(params.sessionId);
  const resultQuery = useSessionResult(sessionId);
  const result = resultQuery.data ?? null;

  if (resultQuery.isLoading) {
    return (
      <div
        data-ocid={`${MARKER}.loading_state`}
        className="mx-auto w-full max-w-3xl px-4 py-10"
      >
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="mt-6 grid gap-3">
          {Array.from({ length: 3 }, (_, i) => `skeleton-${i}`).map((id) => (
            <div key={id} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!sessionId || !result) {
    return (
      <div
        data-ocid={`${MARKER}.empty_state`}
        className="mx-auto w-full max-w-3xl px-4 py-16 text-center"
      >
        <h1 className="font-display text-2xl font-semibold">
          No results to show
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          Finish a practice session or timed test and its summary will appear
          here.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button
            asChild
            className="bg-gradient-primary text-primary-foreground hover:opacity-90"
          >
            <Link to="/dashboard" data-ocid={`${MARKER}.link`}>
              Back to dashboard <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/classes">Browse classes</Link>
          </Button>
        </div>
      </div>
    );
  }

  const total = Number(result.total);
  const score = Number(result.score);
  const percent = scorePercent(result.score, result.total);
  const isTimed = result.mode === SessionMode.timedTest;
  const durationSeconds = Math.max(
    0,
    Math.floor(
      (Number(result.completedAt) - Number(result.startedAt)) / 1_000_000_000,
    ),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {isTimed ? "Timed test results" : "Practice results"}
        </p>
        <h1 className="font-display mt-1 text-2xl font-semibold">
          {result.scope.__kind__ === "topic" ? "Topic" : "Chapter"} complete
        </h1>
      </header>

      <Card
        data-ocid={`${MARKER}.summary`}
        className="surface-glass shadow-elevated overflow-hidden"
      >
        <div className="bg-gradient-primary h-1.5 w-full" aria-hidden="true" />
        <CardContent className="pt-6">
          <ScoreSummary
            percent={percent}
            score={score}
            total={total}
            durationSeconds={durationSeconds}
            message={scoreMessage(percent)}
            marker={MARKER}
          />
        </CardContent>
      </Card>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">
            Question review
          </h2>
          <span className="text-muted-foreground numeric text-xs">
            {result.results.length} questions
          </span>
        </div>
        <ResultReview results={result.results} marker={MARKER} />
      </section>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button
          asChild
          className="bg-gradient-primary text-primary-foreground hover:opacity-90"
        >
          <Link to="/dashboard" data-ocid={`${MARKER}.primary_button`}>
            <RotateCcw className="size-4" /> Practice again
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/classes">Browse classes</Link>
        </Button>
      </div>
    </div>
  );
}
