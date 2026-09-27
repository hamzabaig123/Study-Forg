import type { PublicQuestion } from "@/backend";
import { QuestionType } from "@/backend";
import { PublicLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBackend } from "@/hooks/useBackend";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  Lock,
  Share2,
  Sparkles,
} from "lucide-react";

const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  [QuestionType.multipleChoice]: "Multiple choice",
  [QuestionType.trueFalse]: "True / false",
  [QuestionType.shortAnswer]: "Short answer",
};

function QuestionTypeIcon({ type }: { type: QuestionType }) {
  if (type === QuestionType.multipleChoice) {
    return <ListChecks className="size-4" aria-hidden="true" />;
  }
  if (type === QuestionType.trueFalse) {
    return <CheckCircle2 className="size-4" aria-hidden="true" />;
  }
  return <BookOpen className="size-4" aria-hidden="true" />;
}

function SharedQuestionCard({
  question,
  index,
}: {
  question: PublicQuestion;
  index: number;
}) {
  const isMultipleChoice =
    question.questionType === QuestionType.multipleChoice;
  const isTrueFalse = question.questionType === QuestionType.trueFalse;

  return (
    <Card
      data-ocid={`shared.question.item.${index + 1}`}
      className="gap-4 rounded-xl border-border/70 shadow-subtle transition-smooth hover:border-primary/30"
    >
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <span className="numeric flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
            {index + 1}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <QuestionTypeIcon type={question.questionType} />
            {QUESTION_TYPE_LABEL[question.questionType]}
          </span>
        </div>

        <p className="font-display text-pretty text-lg leading-relaxed text-foreground">
          {question.prompt}
        </p>

        {isMultipleChoice && question.options.length > 0 && (
          <ul className="flex flex-col gap-2">
            {question.options.map((option, optionIndex) => (
              <li
                key={option.id.toString()}
                className="flex items-center gap-3 rounded-md border border-border bg-background/60 px-3 py-2.5 text-sm text-muted-foreground transition-smooth hover:border-primary/30 hover:text-foreground"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium">
                  {String.fromCharCode(65 + optionIndex)}
                </span>
                <span className="min-w-0 break-words">{option.text}</span>
              </li>
            ))}
          </ul>
        )}

        {isTrueFalse && (
          <div className="flex gap-2">
            <span className="flex-1 rounded-md border border-border bg-background/60 px-3 py-2 text-center text-sm text-muted-foreground sm:flex-none sm:px-8">
              True
            </span>
            <span className="flex-1 rounded-md border border-border bg-background/60 px-3 py-2 text-center text-sm text-muted-foreground sm:flex-none sm:px-8">
              False
            </span>
          </div>
        )}

        {!isMultipleChoice && !isTrueFalse && (
          <div className="rounded-md border border-dashed border-border bg-background/60 px-3 py-3 text-sm text-muted-foreground">
            Written response
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SharedViewSkeleton() {
  const ids = Array.from({ length: 3 }, (_, i) => `shared-skeleton-${i}`);
  return (
    <PublicLayout>
      <div
        data-ocid="shared.loading_state"
        className="mx-auto max-w-3xl px-4 py-16 sm:px-6"
        aria-busy="true"
        aria-live="polite"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-6 h-10 w-3/4" />
        <Skeleton className="mt-3 h-4 w-1/2" />
        <div className="mt-10 flex flex-col gap-4">
          {ids.map((id) => (
            <Skeleton key={id} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <span className="sr-only">Loading shared content…</span>
      </div>
    </PublicLayout>
  );
}

function SharedViewUnavailable() {
  return (
    <PublicLayout>
      <div
        data-ocid="shared.error_state"
        className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:px-6"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-3xl">This link is no longer available</h1>
        <p className="mt-4 text-muted-foreground">
          The share link may have been revoked by its owner, or the address may
          be incomplete. Ask the person who shared it for a fresh link.
        </p>
        <Button
          asChild
          className="mt-8 rounded-full bg-gradient-primary text-primary-foreground shadow-sm transition-smooth hover:opacity-90"
        >
          <Link to="/" data-ocid="shared.home_button">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to StudyForge
          </Link>
        </Button>
      </div>
    </PublicLayout>
  );
}

export default function SharedView() {
  const { token } = useParams({ strict: false }) as { token: string };
  const { actor, isFetching } = useBackend();

  const {
    data: shared,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["sharedContent", token],
    queryFn: async () => {
      if (!actor) return null;
      return actor.getSharedContent(token);
    },
    enabled: !!actor && !isFetching,
    retry: false,
  });

  if (isLoading || isFetching) {
    return <SharedViewSkeleton />;
  }

  if (isError || !shared) {
    return <SharedViewUnavailable />;
  }

  return (
    <PublicLayout>
      <div
        data-ocid="shared.page"
        className="mx-auto max-w-3xl animate-fade-up px-4 py-12 sm:px-6 sm:py-16"
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Share2 className="size-3.5" aria-hidden="true" />
            Shared content
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" />
            Read-only
          </span>
        </div>

        <h1 className="mt-4 text-balance font-display text-3xl sm:text-4xl">
          {shared.title}
        </h1>

        {shared.breadcrumb.length > 0 && (
          <nav
            aria-label="Breadcrumb"
            data-ocid="shared.breadcrumb"
            className="mt-5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
          >
            {shared.breadcrumb.map((crumb, index) => (
              <span
                key={crumb.id.toString()}
                className="inline-flex items-center gap-1.5"
              >
                {index > 0 && (
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                )}
                <span
                  className={
                    index === shared.breadcrumb.length - 1
                      ? "font-medium text-foreground"
                      : undefined
                  }
                >
                  {crumb.name}
                </span>
              </span>
            ))}
          </nav>
        )}

        <div className="mt-10 flex items-center justify-between gap-4 border-b border-border pb-4">
          <h2 className="font-display text-xl">
            {shared.questions.length}{" "}
            {shared.questions.length === 1 ? "question" : "questions"}
          </h2>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Answers hidden
          </span>
        </div>

        {shared.questions.length === 0 ? (
          <div
            data-ocid="shared.empty_state"
            className="mt-10 flex flex-col items-center rounded-lg border border-dashed border-border px-6 py-16 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <BookOpen className="size-5" aria-hidden="true" />
            </span>
            <h3 className="mt-5 font-display text-lg">
              No questions in this share yet
            </h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              The owner hasn't added any questions to this content. Check back
              later.
            </p>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-4">
            {shared.questions.map((question, index) => (
              <li key={question.id.toString()}>
                <SharedQuestionCard question={question} index={index} />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-12 rounded-xl border border-primary/20 bg-primary/5 p-6 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <p className="mt-3 font-display text-base font-semibold">
            Made your own study sets?
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            StudyForge turns your notes into practice questions, timed tests,
            and day-streaks.
          </p>
          <Button asChild variant="outline" className="mt-4 rounded-full">
            <Link to="/" data-ocid="shared.cta_button">
              Try StudyForge free
            </Link>
          </Button>
        </div>
      </div>
    </PublicLayout>
  );
}
