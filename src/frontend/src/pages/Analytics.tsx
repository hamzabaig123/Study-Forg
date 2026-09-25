import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { AccuracyChart } from "@/components/insights/AccuracyChart";
import { AttemptHistoryList } from "@/components/insights/AttemptHistoryList";
import { Button } from "@/components/ui/button";
import { useAnalyticsBreakdown } from "@/hooks/useAnalytics";
import { useAttemptHistory } from "@/hooks/useSessions";
import { Link } from "@tanstack/react-router";
import { BarChart3, Timer } from "lucide-react";

export default function Analytics() {
  const breakdownQuery = useAnalyticsBreakdown();
  const historyQuery = useAttemptHistory();

  const breakdown = breakdownQuery.data;
  const history = historyQuery.data ?? [];

  const hasBreakdown =
    !!breakdown &&
    (breakdown.byClass.length > 0 ||
      breakdown.bySubject.length > 0 ||
      breakdown.byQuestionType.length > 0);

  return (
    <div data-ocid="analytics.page" className="space-y-8">
      <PageHeader
        eyebrow="Analytics"
        title="Where your accuracy stands"
        description="Accuracy broken down by class, subject, and question type, plus every attempt you've recorded."
        actions={
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/classes" data-ocid="analytics.classes_link">
              <Timer className="size-4" aria-hidden="true" />
              Run a session
            </Link>
          </Button>
        }
      />

      {breakdownQuery.isLoading ? (
        <LoadingState variant="cards" rows={3} label="Loading analytics…" />
      ) : breakdownQuery.isError ? (
        <ErrorState
          title="Couldn't load analytics"
          description="Something went wrong while fetching your accuracy breakdown."
          onRetry={() => void breakdownQuery.refetch()}
        />
      ) : !hasBreakdown ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics yet"
          description="Complete a practice session or a timed test and your accuracy breakdown will appear here."
          action={
            <Button asChild className="rounded-full">
              <Link
                to="/classes"
                data-ocid="analytics.empty_state.classes_link"
              >
                Choose a topic
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <AccuracyChart
            title="By class"
            description="Accuracy across each of your classes"
            buckets={breakdown?.byClass ?? []}
            ocid="by_class"
            index={1}
          />
          <AccuracyChart
            title="By subject"
            description="Accuracy across each subject"
            buckets={breakdown?.bySubject ?? []}
            ocid="by_subject"
            index={2}
          />
          <AccuracyChart
            title="By question type"
            description="Where the format itself trips you up"
            buckets={breakdown?.byQuestionType ?? []}
            ocid="by_question_type"
            index={3}
          />
        </div>
      )}

      <AttemptHistoryList attempts={history} />
    </div>
  );
}
