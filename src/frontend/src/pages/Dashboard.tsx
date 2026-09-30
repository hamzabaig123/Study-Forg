import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { ProgressHero } from "@/components/insights/ProgressHero";
import { StatCard } from "@/components/insights/StatCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardStats, useRecentActivity } from "@/hooks/useAnalytics";
import { useDisplayName } from "@/hooks/useDisplayName";
import { useStudyProgress } from "@/hooks/useStudyProgress";
import {
  formatCompactCount,
  formatCount,
  formatRelativeTime,
} from "@/lib/format";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  FileText,
  FolderTree,
  GraduationCap,
  Layers,
  ListChecks,
  Plus,
  Sparkles,
  Timer,
} from "lucide-react";

const QUICK_ACTIONS = [
  {
    to: "/test-builder",
    label: "Build a test",
    detail: "Mix subjects, set time, count, and shuffle",
    icon: ListChecks,
    ocid: "dashboard.build_test_button",
  },
  {
    to: "/classes",
    label: "Create content",
    detail: "Add a class, subject, chapter, or topic",
    icon: Plus,
    ocid: "dashboard.create_content_button",
  },
  {
    to: "/ai-studio",
    label: "Extract questions",
    detail: "Turn a PDF or image into a question bank",
    icon: Sparkles,
    ocid: "dashboard.ai_studio_button",
  },
  {
    to: "/analytics",
    label: "Review analytics",
    detail: "See accuracy by class and subject",
    icon: Activity,
    ocid: "dashboard.analytics_button",
  },
] as const;

export default function Dashboard() {
  const displayName = useDisplayName();
  const statsQuery = useDashboardStats();
  const activityQuery = useRecentActivity(8);
  const progress = useStudyProgress();

  const stats = statsQuery.data;
  const activity = activityQuery.data ?? [];
  const hasContent = stats
    ? stats.classCount > 0n || stats.topicCount > 0n
    : false;

  const statCards = [
    {
      label: "Classes",
      value: stats?.classCount ?? 0n,
      icon: GraduationCap,
      hint: "Top-level groups",
    },
    {
      label: "Subjects",
      value: stats?.subjectCount ?? 0n,
      icon: BookOpen,
      hint: "Across all classes",
    },
    {
      label: "Chapters",
      value: stats?.chapterCount ?? 0n,
      icon: FolderTree,
      hint: "Teaching units",
    },
    {
      label: "Topics",
      value: stats?.topicCount ?? 0n,
      icon: Layers,
      hint: "Question banks",
    },
    {
      label: "Questions authored",
      value: stats?.questionCount ?? 0n,
      icon: ListChecks,
      hint: "Ready to practise",
    },
  ];

  return (
    <div className="space-y-8" data-ocid="dashboard.page">
      <PageHeader
        eyebrow="Overview"
        title={
          displayName ? `Welcome back, ${displayName}` : "Your study workspace"
        }
        description="Track what you have authored, pick up recent work, and jump straight into a practice session."
        actions={
          <>
            <Button
              asChild
              type="button"
              variant="outline"
              className="gap-2 rounded-full"
            >
              <Link
                to="/analytics"
                data-ocid="dashboard.header_analytics_button"
              >
                <Activity className="size-4" aria-hidden="true" />
                Analytics
              </Link>
            </Button>
            <Button asChild type="button" className="gap-2 rounded-full">
              <Link to="/classes" data-ocid="dashboard.header_create_button">
                <Plus className="size-4" aria-hidden="true" />
                New content
              </Link>
            </Button>
          </>
        }
      />

      <ProgressHero
        accuracyPercent={progress.accuracy.percent}
        answeredTotal={progress.accuracy.total}
        streakDays={progress.streak.current}
        bestStreakDays={progress.streak.best}
        attemptsToday={progress.attemptsToday}
        attemptCount={progress.attempts.length}
        loading={false}
      />

      {statsQuery.isError ? (
        <ErrorState
          title="Couldn't load your stats"
          description="The dashboard metrics failed to load. Try again in a moment."
          onRetry={() => void statsQuery.refetch()}
        />
      ) : statsQuery.isLoading ? (
        <LoadingState variant="cards" rows={5} label="Loading your stats…" />
      ) : (
        <section
          aria-label="Content totals"
          className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          {statCards.map((card, index) => (
            <StatCard
              key={card.label}
              index={index}
              label={card.label}
              value={formatCompactCount(card.value)}
              icon={card.icon}
              hint={card.hint}
              featured={index === 0}
            />
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          data-ocid="dashboard.activity_card"
          className="gap-0 rounded-lg border-border/70 py-0 shadow-none lg:col-span-2"
        >
          <CardHeader className="flex-row items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <CardTitle className="flex items-center gap-2 font-display text-base font-semibold">
              <Activity
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
              Recent activity
            </CardTitle>
            {activity.length > 0 ? (
              <span className="numeric text-xs text-muted-foreground">
                {activity.length} recent
              </span>
            ) : null}
          </CardHeader>
          <CardContent className="px-0 py-0">
            {activityQuery.isError ? (
              <ErrorState
                title="Couldn't load activity"
                description="Your recent activity feed failed to load."
                onRetry={() => void activityQuery.refetch()}
                className="m-5"
              />
            ) : activityQuery.isLoading ? (
              <LoadingState
                variant="list"
                rows={4}
                className="p-5"
                label="Loading activity…"
              />
            ) : activity.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="Nothing here yet"
                description="Create your first class and your authoring activity will show up here."
                className="border-0 bg-transparent py-10"
                action={
                  <Button asChild type="button" className="gap-2 rounded-full">
                    <Link
                      to="/classes"
                      data-ocid="dashboard.empty_create_button"
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      Create a class
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="stagger divide-y divide-border/60">
                {activity.map((item, index) => (
                  <li
                    key={`${item.kind}-${item.at.toString()}-${index}`}
                    data-ocid={`dashboard.activity.${index}`}
                    className="flex items-start gap-3 px-5 py-3.5"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <FileText className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                        {item.kind} · {formatRelativeTime(item.at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card
            data-ocid="dashboard.quick_actions_card"
            className="gap-0 rounded-lg border-border/70 py-0 shadow-none"
          >
            <CardHeader className="border-b border-border/60 px-5 py-4">
              <CardTitle className="font-display text-base font-semibold">
                Quick actions
              </CardTitle>
            </CardHeader>
            <CardContent className="stagger space-y-2 px-3 py-3">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.to}
                    to={action.to}
                    data-ocid={action.ocid}
                    className="group flex items-center gap-3 rounded-lg px-3 py-3 transition-smooth hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform duration-200 ease-out group-hover:scale-110">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                        {action.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {action.detail}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </CardContent>
          </Card>

          {!hasContent && stats ? (
            <Card
              data-ocid="dashboard.getting_started_card"
              className="gap-0 rounded-lg border-primary/30 bg-primary/5 py-0 shadow-none"
            >
              <CardContent className="space-y-3 px-5 py-5">
                <span className="flex size-10 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                  <Timer className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-display text-base font-semibold text-foreground">
                  Start your first study set
                </h3>
                <p className="text-sm text-muted-foreground">
                  Build a class, add a subject and chapter, then author
                  questions in a topic. You can also let AI draft them from your
                  notes.
                </p>
                <Button
                  asChild
                  type="button"
                  className="w-full gap-2 rounded-full"
                >
                  <Link
                    to="/classes"
                    data-ocid="dashboard.getting_started_button"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Create a class
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {stats && stats.questionCount > 0n ? (
        <p className="text-xs text-muted-foreground">
          {formatCount(stats.questionCount)} questions across{" "}
          {formatCount(stats.topicCount)}{" "}
          {stats.topicCount === 1n ? "topic" : "topics"} —{" "}
          <Link
            to="/test-builder"
            className="font-medium text-accent underline-offset-4 hover:underline"
            data-ocid="dashboard.footer_builder_link"
          >
            build a test
          </Link>{" "}
          from any mix of them.
        </p>
      ) : null}
    </div>
  );
}
