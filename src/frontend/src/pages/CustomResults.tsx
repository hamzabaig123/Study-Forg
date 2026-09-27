import { ResultReview } from "@/components/session/ResultReview";
import { ScoreSummary } from "@/components/session/ScoreSummary";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { scorePercent } from "@/lib/format";
import { getLocalSession, subscribeLocalSessions } from "@/lib/localSessions";
import { type QuestionResult, SessionMode } from "@/types";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useSyncExternalStore } from "react";

const MARKER = "custom_results";

function scoreMessage(percent: number): string {
  if (percent >= 90) return "Outstanding — you have this down.";
  if (percent >= 75) return "Strong work. A quick review will lock it in.";
  if (percent >= 50) return "Solid start. Review the misses below.";
  return "Keep going — the review below is where the learning happens.";
}

/** Results for a test assembled by the test builder, stored on this device. */
export default function CustomResults() {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : null;

  const session = useSyncExternalStore(
    subscribeLocalSessions,
    () => getLocalSession(sessionId),
    () => getLocalSession(sessionId),
  );

  if (!session || session.status !== "completed") {
    return (
      <div
        data-ocid={`${MARKER}.missing_state`}
        className="mx-auto w-full max-w-3xl px-4 py-16 text-center"
      >
        <h1 className="font-display text-2xl font-semibold">
          No results to show
        </h1>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
          This test hasn't been finished on this device.
        </p>
        <Button asChild type="button" className="mt-6 rounded-full">
          <Link to="/test-builder" data-ocid={`${MARKER}.rebuild_link`}>
            Build a test
          </Link>
        </Button>
      </div>
    );
  }

  const percent = scorePercent(BigInt(session.score), BigInt(session.total));
  const isTimed = session.mode === SessionMode.timedTest;
  const durationSeconds = Math.max(
    0,
    Math.floor(
      ((session.completedAtMs ?? session.startedAtMs) - session.startedAtMs) /
        1000,
    ),
  );

  const review: QuestionResult[] = session.results.map((result) => ({
    questionId: BigInt(result.questionId),
    prompt: result.prompt,
    questionType: result.questionType,
    submitted: result.submitted ?? undefined,
    correct: result.correct,
    correctAnswer: result.correctAnswer,
    explanation: result.explanation ?? undefined,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <header className="mb-6">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {isTimed ? "Timed test results" : "Practice results"}
        </p>
        <h1 className="font-display mt-1 truncate text-2xl font-semibold">
          {session.scopeLabel}
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
            score={session.score}
            total={session.total}
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
            {session.results.length} questions
          </span>
        </div>
        <ResultReview results={review} marker={MARKER} />
      </section>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button
          asChild
          className="bg-gradient-primary text-primary-foreground hover:opacity-90"
        >
          <Link to="/test-builder" data-ocid={`${MARKER}.again_button`}>
            <RotateCcw className="size-4" /> Build another test
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/analytics" data-ocid={`${MARKER}.analytics_button`}>
            See analytics <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
