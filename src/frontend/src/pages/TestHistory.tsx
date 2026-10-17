import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { AttemptRow } from "@/components/history/AttemptRow";
import { monthLabel } from "@/components/history/format";
import { StatCard } from "@/components/insights/StatCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTestHistory } from "@/hooks/useTestHistory";
import { formatPercent } from "@/lib/format";
import {
  DEFAULT_HISTORY_FILTERS,
  type HistoryFilters,
  type HistoryModeFilter,
  type HistorySort,
  type TestAttempt,
  attemptKey,
  filterAttempts,
  historySubjects,
  summarizeHistory,
} from "@/lib/testHistory";
import { SessionMode } from "@/types";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Award,
  ClipboardList,
  History,
  ListChecks,
  Search,
  SearchX,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";

const ALL_SUBJECTS = "__all__";

const SORT_LABELS: Record<HistorySort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  best: "Highest score",
  worst: "Lowest score",
};

interface MonthGroup {
  label: string;
  attempts: TestAttempt[];
}

/** Consecutive runs that share a month, in the list's own order. */
function groupByMonth(attempts: readonly TestAttempt[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const attempt of attempts) {
    const label = monthLabel(attempt.completedAtMs);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.attempts.push(attempt);
    else groups.push({ label, attempts: [attempt] });
  }
  return groups;
}

/**
 * Every finished test — topic and chapter sessions and Test Builder runs —
 * with its score, searchable and sortable, each opening a full review.
 */
export default function TestHistory() {
  const { attempts, isLoading, error, refetch } = useTestHistory();
  const [filters, setFilters] = useState<HistoryFilters>(
    DEFAULT_HISTORY_FILTERS,
  );

  const stats = useMemo(() => summarizeHistory(attempts), [attempts]);
  const subjects = useMemo(() => historySubjects(attempts), [attempts]);
  const visible = useMemo(
    () => filterAttempts(attempts, filters),
    [attempts, filters],
  );
  // Month headings only make sense while the list runs in date order.
  const groups = useMemo<MonthGroup[]>(
    () =>
      filters.sort === "newest" || filters.sort === "oldest"
        ? groupByMonth(visible)
        : [{ label: "", attempts: visible }],
    [visible, filters.sort],
  );

  const update = (patch: Partial<HistoryFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));
  const isFiltered =
    filters.query.trim() !== "" ||
    filters.mode !== "all" ||
    filters.subject !== null;

  const header = (
    <PageHeader
      eyebrow="History"
      title="Test history"
      description="Every practice session and timed test you've finished, with the score and a question-by-question review of what you got right and wrong."
      actions={
        <Button
          asChild
          className="rounded-full bg-gradient-primary text-primary-foreground hover:opacity-90"
        >
          <Link to="/test-builder" data-ocid="history.build_test_link">
            <ListChecks className="size-4" aria-hidden="true" />
            Build a test
          </Link>
        </Button>
      }
    />
  );

  if (attempts.length === 0) {
    return (
      <div data-ocid="history.page" className="space-y-8">
        {header}
        {isLoading ? (
          <LoadingState
            variant="list"
            rows={4}
            label="Loading your test history…"
          />
        ) : error ? (
          <ErrorState
            title="Couldn't load your test history"
            description="Your finished tests couldn't be fetched. Check your connection and try again."
            onRetry={refetch}
          />
        ) : (
          <EmptyState
            icon={History}
            title="No tests yet"
            description="Finish a practice session or a timed test and it will be kept here, with every question you answered."
            action={
              <Button
                asChild
                className="rounded-full bg-gradient-primary text-primary-foreground"
              >
                <Link
                  to="/test-builder"
                  data-ocid="history.empty_state.build_link"
                >
                  <ListChecks className="size-4" aria-hidden="true" />
                  Build your first test
                </Link>
              </Button>
            }
          />
        )}
      </div>
    );
  }

  return (
    <div data-ocid="history.page" className="space-y-8">
      {header}

      {error ? (
        <div
          data-ocid="history.partial_error"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
        >
          <AlertTriangle
            className="size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1">
            Only the tests saved on this device are shown — your account's
            history couldn't be loaded.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={refetch}
            data-ocid="history.partial_error.retry_button"
          >
            Try again
          </Button>
        </div>
      ) : null}

      <section
        aria-label="History totals"
        className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <StatCard
          index={0}
          marker="history.stat_card"
          featured
          label="Tests taken"
          value={String(stats.tests)}
          icon={ClipboardList}
        />
        <StatCard
          index={1}
          marker="history.stat_card"
          label="Average score"
          value={
            stats.averagePercent === null
              ? "—"
              : formatPercent(stats.averagePercent)
          }
          icon={TrendingUp}
        />
        <StatCard
          index={2}
          marker="history.stat_card"
          label="Best score"
          value={
            stats.bestPercent === null ? "—" : formatPercent(stats.bestPercent)
          }
          icon={Award}
        />
        <StatCard
          index={3}
          marker="history.stat_card"
          label="Questions answered"
          value={String(stats.questionsAnswered)}
          icon={ListChecks}
        />
      </section>

      <Card className="gap-0 rounded-lg border-border/70 py-0 shadow-none">
        <div className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={filters.query}
              onChange={(event) => update({ query: event.target.value })}
              placeholder="Search by test, subject or class"
              aria-label="Search tests"
              className="rounded-lg pl-9"
              data-ocid="history.search_input"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filters.mode}
              onValueChange={(value) =>
                update({ mode: value as HistoryModeFilter })
              }
            >
              <TabsList
                aria-label="Filter by mode"
                className="h-9 rounded-lg border border-border bg-muted/40 p-1"
              >
                <TabsTrigger
                  value="all"
                  className="rounded-md px-3 text-xs"
                  data-ocid="history.mode_tab.all"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value={SessionMode.practice}
                  className="rounded-md px-3 text-xs"
                  data-ocid="history.mode_tab.practice"
                >
                  Practice
                </TabsTrigger>
                <TabsTrigger
                  value={SessionMode.timedTest}
                  className="rounded-md px-3 text-xs"
                  data-ocid="history.mode_tab.timed"
                >
                  Timed
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {subjects.length > 0 ? (
              <Select
                value={filters.subject ?? ALL_SUBJECTS}
                onValueChange={(value) =>
                  update({ subject: value === ALL_SUBJECTS ? null : value })
                }
              >
                <SelectTrigger
                  aria-label="Filter by subject"
                  className="h-9 w-44 rounded-lg"
                  data-ocid="history.subject_select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_SUBJECTS}>All subjects</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject} value={subject}>
                      <span dir="auto">{subject}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            <Select
              value={filters.sort}
              onValueChange={(value) => update({ sort: value as HistorySort })}
            >
              <SelectTrigger
                aria-label="Sort tests"
                className="h-9 w-40 rounded-lg"
                data-ocid="history.sort_select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as HistorySort[]).map((sort) => (
                  <SelectItem key={sort} value={sort}>
                    {SORT_LABELS[sort]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
          <p
            className="numeric text-xs text-muted-foreground"
            aria-live="polite"
            data-ocid="history.result_count"
          >
            {isFiltered
              ? `${visible.length} of ${attempts.length} tests`
              : `${attempts.length} ${attempts.length === 1 ? "test" : "tests"}`}
          </p>
          {isFiltered ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full text-xs"
              onClick={() =>
                setFilters({ ...DEFAULT_HISTORY_FILTERS, sort: filters.sort })
              }
              data-ocid="history.clear_filters_button"
            >
              Clear filters
            </Button>
          ) : null}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No tests match"
            description="Try a different search, or clear the filters to see every test."
            className="border-0 bg-transparent py-10"
          />
        ) : (
          <div data-ocid="history.list" className="pb-2">
            {groups.map((group) => (
              <section
                key={group.label || "all"}
                aria-label={group.label || undefined}
              >
                {group.label ? (
                  <h2 className="px-5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {group.label}
                  </h2>
                ) : null}
                <ul className="divide-y divide-border/60">
                  {group.attempts.map((attempt) => (
                    <AttemptRow
                      key={attemptKey(attempt)}
                      attempt={attempt}
                      index={visible.indexOf(attempt)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
