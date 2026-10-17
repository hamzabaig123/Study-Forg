import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ErrorState } from "@/components/common/ErrorState";
import {
  formatAttemptDate,
  formatTimeLimit,
  modeLabel,
} from "@/components/history/format";
import { ResultReview } from "@/components/session/ResultReview";
import { ScoreSummary } from "@/components/session/ScoreSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeleteTestAttempt, useTestAttempt } from "@/hooks/useTestHistory";
import {
  type ItemStatus,
  type TestKind,
  attemptDurationSeconds,
  attemptPercent,
  canDeleteAttempt,
  itemStatus,
  toQuestionResult,
} from "@/lib/testHistory";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  RotateCcw,
  Timer,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const MARKER = "history_detail";

type ReviewFilter = "all" | ItemStatus;

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: "All",
  wrong: "Wrong",
  skipped: "Skipped",
  correct: "Correct",
};

const EMPTY_FILTER_COPY: Record<ItemStatus, string> = {
  wrong: "No wrong answers in this test.",
  skipped: "Every question in this test was answered.",
  correct:
    "No correct answers in this test yet — the review is where it starts.",
};

function parseKind(value: unknown): TestKind | null {
  return value === "session" || value === "custom" ? value : null;
}

/** The router hands over `/history/session/12` with the id as a string or number. */
function parseId(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id.length > 0 && id.length <= 128 ? id : null;
}

function scoreMessage(percent: number): string {
  if (percent >= 90) return "Outstanding — you had this down.";
  if (percent >= 75) return "Strong work. Review the few misses below.";
  if (percent >= 50) return "Solid start. The misses below are worth a look.";
  return "The review below is where the learning happens.";
}

/** One finished test, reopened: the score, then every question with its verdict. */
export default function TestHistoryDetail() {
  const params = useParams({ strict: false }) as {
    kind?: unknown;
    id?: unknown;
  };
  const kind = parseKind(params.kind);
  const id = parseId(params.id);
  const { attempt, isLoading, error, refetch } = useTestAttempt(kind, id);
  const deletion = useDeleteTestAttempt();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ReviewFilter>("all");

  const numbered = useMemo(
    () =>
      (attempt?.items ?? []).map((item, index) => ({
        item,
        number: index + 1,
        status: itemStatus(item),
      })),
    [attempt],
  );
  const counts = useMemo(() => {
    const tally: Record<ReviewFilter, number> = {
      all: numbered.length,
      wrong: 0,
      skipped: 0,
      correct: 0,
    };
    for (const entry of numbered) tally[entry.status] += 1;
    return tally;
  }, [numbered]);
  const shown = useMemo(
    () =>
      filter === "all"
        ? numbered
        : numbered.filter((entry) => entry.status === filter),
    [numbered, filter],
  );

  const backLink = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-full">
      <Link to="/history" data-ocid={`${MARKER}.back_link`}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        All tests
      </Link>
    </Button>
  );

  if (kind && id && isLoading) {
    return (
      <div
        data-ocid={`${MARKER}.loading_state`}
        className="mx-auto w-full max-w-3xl"
        aria-busy="true"
      >
        <span className="sr-only">Loading the test…</span>
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
        <div className="mt-6 h-44 animate-pulse rounded-xl bg-muted" />
        <div className="mt-6 grid gap-3">
          {["a", "b", "c"].map((key) => (
            <div key={key} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (kind && id && error) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {backLink}
        <ErrorState
          title="Couldn't open this test"
          description="The test's results couldn't be fetched. Check your connection and try again."
          onRetry={refetch}
        />
      </div>
    );
  }

  if (!kind || !id || !attempt) {
    return (
      <div
        data-ocid={`${MARKER}.missing_state`}
        className="mx-auto w-full max-w-3xl py-10 text-center"
      >
        <h1 className="font-display text-2xl font-semibold">
          This test isn't in your history
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          It may have been deleted, or it belongs to a different account.
        </p>
        <Button
          asChild
          className="mt-6 rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90"
        >
          <Link to="/history" data-ocid={`${MARKER}.history_link`}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to test history
          </Link>
        </Button>
      </div>
    );
  }

  const percent = attemptPercent(attempt);
  const duration = attemptDurationSeconds(attempt);
  const context = [...attempt.classes, ...attempt.subjects];

  const handleDelete = () => {
    deletion.mutate(
      { kind, id },
      {
        onSuccess: () => {
          toast.success("Test deleted from your history");
          void navigate({ to: "/history" });
        },
        onError: (cause) => {
          toast.error("Couldn't delete this test", {
            description:
              cause instanceof Error ? cause.message : "Try again in a moment.",
          });
        },
      },
    );
  };

  return (
    <div data-ocid={`${MARKER}.page`} className="mx-auto w-full max-w-3xl">
      {backLink}

      <header className="mt-3 mb-6">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {modeLabel(attempt.mode)}
          {attempt.kind === "custom" ? " · Test Builder" : ""}
        </p>
        <h1
          dir="auto"
          className="mt-1 font-display text-2xl font-semibold break-words"
        >
          {attempt.title}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {formatAttemptDate(attempt.completedAtMs)}
          </span>
          {attempt.timeLimitSeconds ? (
            <span className="inline-flex items-center gap-1.5">
              <Timer className="size-3.5" aria-hidden="true" />
              {formatTimeLimit(attempt.timeLimitSeconds)}
            </span>
          ) : null}
          {context.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {context.map((label) => (
                <Badge
                  key={label}
                  variant="outline"
                  dir="auto"
                  className="font-normal"
                >
                  {label}
                </Badge>
              ))}
            </span>
          ) : null}
        </div>
      </header>

      {attempt.contentRemoved ? (
        <div
          role="note"
          className="mb-6 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <p>
            The topic or chapter this test came from has since been deleted. The
            result is kept here as it was graded.
          </p>
        </div>
      ) : null}

      <Card
        data-ocid={`${MARKER}.summary`}
        className="surface-glass shadow-elevated overflow-hidden"
      >
        <div className="bg-gradient-primary h-1.5 w-full" aria-hidden="true" />
        <CardContent className="pt-6">
          <ScoreSummary
            percent={percent}
            score={attempt.score}
            total={attempt.total}
            durationSeconds={duration ?? 0}
            message={scoreMessage(percent)}
            marker={MARKER}
            celebrate={false}
          />
        </CardContent>
      </Card>

      <section className="mt-8" aria-labelledby="history-review-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2
            id="history-review-heading"
            className="font-display text-lg font-semibold"
          >
            Question review
          </h2>
          {numbered.length > 0 ? (
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as ReviewFilter)}
            >
              <TabsList
                aria-label="Show questions"
                className="h-9 rounded-lg border border-border bg-muted/40 p-1"
              >
                {(Object.keys(FILTER_LABELS) as ReviewFilter[])
                  .filter((key) => key !== "skipped" || counts.skipped > 0)
                  .map((key) => (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="gap-1.5 rounded-md px-3 text-xs"
                      data-ocid={`${MARKER}.filter_tab.${key}`}
                    >
                      {FILTER_LABELS[key]}
                      <span className="numeric text-muted-foreground">
                        {counts[key]}
                      </span>
                    </TabsTrigger>
                  ))}
              </TabsList>
            </Tabs>
          ) : null}
        </div>

        {numbered.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            The questions for this test are no longer on record.
          </p>
        ) : shown.length === 0 ? (
          <p
            data-ocid={`${MARKER}.filter_empty`}
            className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground"
          >
            {filter === "all" ? null : EMPTY_FILTER_COPY[filter]}
          </p>
        ) : (
          <ResultReview
            results={shown.map((entry) => toQuestionResult(entry.item))}
            numbers={shown.map((entry) => entry.number)}
            marker={MARKER}
          />
        )}
      </section>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button
          asChild
          className="bg-gradient-primary text-primary-foreground hover:opacity-90"
        >
          <Link to="/test-builder" data-ocid={`${MARKER}.retake_link`}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Take a new test
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/history" data-ocid={`${MARKER}.all_tests_link`}>
            All tests
          </Link>
        </Button>
        {canDeleteAttempt(kind) ? (
          <ConfirmDialog
            title="Delete this test?"
            description="Its score and question review are removed from your history, and from your analytics. This can't be undone."
            confirmLabel="Delete test"
            destructive
            onConfirm={handleDelete}
            trigger={
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={deletion.isPending}
                data-ocid={`${MARKER}.delete_button`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {deletion.isPending ? "Deleting…" : "Delete"}
              </Button>
            }
          />
        ) : null}
      </div>
    </div>
  );
}
