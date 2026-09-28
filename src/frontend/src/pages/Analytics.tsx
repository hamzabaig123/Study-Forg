import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { AccuracyChart } from "@/components/insights/AccuracyChart";
import { AttemptHistoryList } from "@/components/insights/AttemptHistoryList";
import { Button } from "@/components/ui/button";
import { useMergedBreakdown, useStudyProgress } from "@/hooks/useStudyProgress";
import type { AttemptSummary } from "@/types";
import { Link } from "@tanstack/react-router";
import { BarChart3, Timer } from "lucide-react";
import { useMemo } from "react";

export default function Analytics() {
  const { breakdown, isLoading, isError, refetch } = useMergedBreakdown();
  const progress = useStudyProgress();

  const hasBreakdown =
    breakdown.byClass.length > 0 ||
    breakdown.bySubject.length > 0 ||
    breakdown.byQuestionType.length > 0;

  const history = useMemo<AttemptSummary[]>(() => {
    return progress.attempts.map((attempt) => ({
      // The history list keys on the id, so uniqueness is all it is used for.
      id: BigInt(0),
      completedAt: BigInt(Math.round(attempt.completedAtMs) * 1_000_000),
      total: BigInt(attempt.total),
      mode: attempt.mode,
      scopeLabel: attempt.scopeLabel,
      score: BigInt(attempt.score),
    }));
  }, [progress.attempts]);

  const uniqueHistory = useMemo<AttemptSummary[]>(() => {
    // AttemptSummary.id is a bigint with no natural value for merged local
    // attempts; the list only needs a stable unique key per row.
    return history.map((attempt, index) => ({
      ...attempt,
      id: BigInt(index + 1),
    }));
  }, [history]);

  return (
    <div data-ocid="analytics.page" className="space-y-8">
      <PageHeader
        eyebrow="Analytics"
        title="Where your accuracy stands"
        description="Accuracy broken down by class, subject, and question type, plus every attempt you've recorded — custom tests included."
        actions={
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/test-builder" data-ocid="analytics.classes_link">
              <Timer className="size-4" aria-hidden="true" />
              Build a test
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <LoadingState variant="cards" rows={3} label="Loading analytics…" />
      ) : isError ? (
        <ErrorState
          title="Couldn't load analytics"
          description="Something went wrong while fetching your accuracy breakdown."
          onRetry={() => void refetch()}
        />
      ) : !hasBreakdown ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics yet"
          description="Complete a practice session or a timed test and your accuracy breakdown will appear here."
          action={
            <Button
              asChild
              className="rounded-full bg-gradient-primary text-primary-foreground"
            >
              <Link
                to="/test-builder"
                data-ocid="analytics.empty_state.classes_link"
              >
                Build your first test
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="stagger grid grid-cols-1 gap-6 lg:grid-cols-2">
          <AccuracyChart
            title="By class"
            description="Accuracy across each of your classes"
            buckets={breakdown.byClass}
            ocid="by_class"
            index={1}
          />
          <AccuracyChart
            title="By subject"
            description="Accuracy across each subject"
            buckets={breakdown.bySubject}
            ocid="by_subject"
            index={2}
          />
          <AccuracyChart
            title="By question type"
            description="Where the format itself trips you up"
            buckets={breakdown.byQuestionType}
            ocid="by_question_type"
            index={3}
            className="lg:col-span-2"
          />
        </div>
      )}

      <AttemptHistoryList attempts={uniqueHistory} />
    </div>
  );
}
