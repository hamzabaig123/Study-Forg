import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { ErrorState } from "@/components/common/ErrorState";
import { LoadingState } from "@/components/common/LoadingState";
import { PageHeader } from "@/components/common/PageHeader";
import { QuestionCard } from "@/components/content/QuestionCard";
import {
  QuestionForm,
  type QuestionFormValues,
} from "@/components/content/QuestionForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  useCreateQuestion,
  useDeleteQuestion,
  useQuestions,
  useTopic,
  useTopicPath,
  useUpdateQuestion,
} from "@/hooks/useContent";
import { useStartSession } from "@/hooks/useSessions";
import { SessionMode } from "@/types";
import type { Question } from "@/types";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { HelpCircle, Pencil, Plus, Share2, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function TopicDetail() {
  const { topicId } = useParams({ from: "/app/topics/$topicId" });
  const navigate = useNavigate();
  const id = BigInt(topicId);

  const topicQuery = useTopic(id);
  const pathQuery = useTopicPath(id);
  const questionsQuery = useQuestions(id);
  const createQuestion = useCreateQuestion();
  const updateQuestion = useUpdateQuestion();
  const deleteQuestion = useDeleteQuestion();
  const startSession = useStartSession();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Question | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Question | null>(null);

  const questions = questionsQuery.data ?? [];
  const topic = topicQuery.data?.topic;
  const path = pathQuery.data;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(target: Question) {
    setEditing(target);
    setFormOpen(true);
  }

  function handleSubmit(values: QuestionFormValues) {
    const explanation =
      values.explanation.trim().length > 0 ? values.explanation : null;
    if (editing) {
      updateQuestion.mutate(
        {
          questionId: editing.id,
          topicId: id,
          prompt: values.prompt,
          questionType: values.questionType,
          answer: values.answer,
          explanation,
        },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Question updated");
          },
          onError: () =>
            toast.error("Couldn't update question. Please try again."),
        },
      );
    } else {
      createQuestion.mutate(
        {
          topicId: id,
          prompt: values.prompt,
          questionType: values.questionType,
          answer: values.answer,
          explanation,
        },
        {
          onSuccess: () => {
            setFormOpen(false);
            toast.success("Question added");
          },
          onError: () =>
            toast.error("Couldn't add question. Please try again."),
        },
      );
    }
  }

  function handleDelete() {
    if (!pendingDelete) return;
    deleteQuestion.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null);
        toast.success("Question deleted");
      },
      onError: () => toast.error("Couldn't delete question. Please try again."),
    });
  }

  function startPractice() {
    startSession.mutate(
      { mode: SessionMode.practice, scope: { __kind__: "topic", topic: id } },
      {
        onSuccess: (result) => {
          if (result.__kind__ === "err") {
            toast.error(
              result.err.__kind__ === "noQuestions"
                ? "Add at least one question before starting a session."
                : "Couldn't start the session.",
            );
            return;
          }
          void navigate({
            to: "/practice/$sessionId",
            params: { sessionId: result.ok.id.toString() },
          });
        },
        onError: () => toast.error("Couldn't start the session."),
      },
    );
  }

  function startTimedTest() {
    startSession.mutate(
      {
        mode: SessionMode.timedTest,
        scope: { __kind__: "topic", topic: id },
        durationSeconds: 600n,
        questionCount: BigInt(Math.min(questions.length, 20)),
      },
      {
        onSuccess: (result) => {
          if (result.__kind__ === "err") {
            toast.error(
              result.err.__kind__ === "noQuestions"
                ? "Add at least one question before starting a test."
                : "Couldn't start the test.",
            );
            return;
          }
          void navigate({
            to: "/test/$sessionId",
            params: { sessionId: result.ok.id.toString() },
          });
        },
        onError: () => toast.error("Couldn't start the test."),
      },
    );
  }

  if (topicQuery.isLoading) {
    return <LoadingState label="Loading topic…" />;
  }

  if (topicQuery.isError || !topic) {
    return (
      <ErrorState
        title="Topic not found"
        description="This topic may have been deleted, or the link is incorrect."
        onRetry={() => void topicQuery.refetch()}
      />
    );
  }

  const crumbs = path
    ? [
        { label: "Classes", to: "/classes" },
        { label: path.class.name, to: `/classes/${path.class.id.toString()}` },
        {
          label: path.subject.name,
          to: `/subjects/${path.subject.id.toString()}`,
        },
        {
          label: path.chapter.name,
          to: `/chapters/${path.chapter.id.toString()}`,
        },
        { label: path.topic.name },
      ]
    : [
        { label: "Classes", to: "/classes" },
        { label: "Chapter", to: `/chapters/${topic.chapterId.toString()}` },
        { label: topic.name },
      ];

  return (
    <div data-ocid="topic_detail.page" className="space-y-8">
      <Breadcrumbs items={crumbs} />

      <PageHeader
        eyebrow="Topic"
        title={topic.name}
        description={
          topic.description?.trim() ||
          "Author questions here, then drill them with practice or a timed test."
        }
        actions={
          <>
            <Button asChild variant="outline" className="rounded-full">
              <Link to="/share" data-ocid="topic_detail.share_link">
                <Share2 className="size-4" aria-hidden="true" />
                Share
              </Link>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-full"
              onClick={startPractice}
              disabled={startSession.isPending || questions.length === 0}
              data-ocid="topic_detail.practice_button"
            >
              <Timer className="size-4" aria-hidden="true" />
              Practice
            </Button>
            <Button
              type="button"
              className="rounded-full bg-gradient-primary text-primary-foreground"
              onClick={startTimedTest}
              disabled={startSession.isPending || questions.length === 0}
              data-ocid="topic_detail.timed_test_button"
            >
              <Timer className="size-4" aria-hidden="true" />
              Timed test
            </Button>
          </>
        }
      />

      <Card className="rounded-lg border-border/70 shadow-none">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HelpCircle className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="numeric text-2xl font-semibold leading-none text-foreground">
                {questions.length}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">
                {questions.length === 1 ? "Question" : "Questions"} in this
                topic
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="rounded-full"
            onClick={openCreate}
            data-ocid="topic_detail.create_question_button"
          >
            <Plus className="size-4" aria-hidden="true" />
            New question
          </Button>
        </CardContent>
      </Card>

      {questionsQuery.isLoading ? (
        <LoadingState variant="list" rows={4} label="Loading questions…" />
      ) : questionsQuery.isError ? (
        <ErrorState
          title="Couldn't load questions"
          description="Something went wrong while fetching this topic's questions."
          onRetry={() => void questionsQuery.refetch()}
        />
      ) : questions.length === 0 ? (
        <EmptyState
          icon={HelpCircle}
          title="No questions yet"
          description="Write a multiple choice, true/false, or short answer question — or generate a first draft with AI."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                className="rounded-full"
                onClick={openCreate}
                data-ocid="topic_detail.empty_state.create_question_button"
              >
                <Plus className="size-4" aria-hidden="true" />
                Write a question
              </Button>
              <Button asChild variant="outline" className="rounded-full">
                <Link
                  to="/ai-studio"
                  data-ocid="topic_detail.empty_state.ai_studio_link"
                >
                  Generate with AI
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <div className="space-y-3" data-ocid="questions.list">
          {questions.map((question, index) => (
            <QuestionCard
              key={question.id.toString()}
              question={question}
              index={index}
              onEdit={openEdit}
              onDelete={setPendingDelete}
            />
          ))}
        </div>
      )}

      <QuestionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        question={editing}
        pending={createQuestion.isPending || updateQuestion.isPending}
        errorMessage={
          createQuestion.isError || updateQuestion.isError
            ? "Couldn't save the question. Please try again."
            : null
        }
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        trigger={<span className="hidden" aria-hidden="true" />}
        title="Delete this question?"
        description="This permanently removes the question from the topic. This cannot be undone."
        confirmLabel="Delete question"
        destructive
        onConfirm={handleDelete}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Pencil className="size-3.5" aria-hidden="true" />
        <span>Edit any question with the pencil action on its card.</span>
        <Trash2 className="size-3.5" aria-hidden="true" />
        <span>Deleting a question cannot be undone.</span>
      </div>
    </div>
  );
}
