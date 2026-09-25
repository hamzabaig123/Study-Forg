import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type {
  AnswerData,
  ChapterSummary,
  ClassSummary,
  Id,
  Question,
  QuestionType,
  SubjectSummary,
  TopicSummary,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

export function useClasses() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.classes.all,
    queryFn: async (): Promise<ClassSummary[]> => {
      if (!actor) return [];
      return actor.listClasses();
    },
    enabled: !!actor && !isFetching,
  });
}

export function useClass(classId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.classes.detail(classId ?? 0n),
    queryFn: async () => {
      if (!actor || classId === null) return null;
      return actor.getClass(classId);
    },
    enabled: !!actor && !isFetching && classId !== null,
  });
}

export function useSubjects(classId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.subjects.list(classId ?? 0n),
    queryFn: async (): Promise<SubjectSummary[]> => {
      if (!actor || classId === null) return [];
      return actor.listSubjects(classId);
    },
    enabled: !!actor && !isFetching && classId !== null,
  });
}

export function useSubject(subjectId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.subjects.detail(subjectId ?? 0n),
    queryFn: async () => {
      if (!actor || subjectId === null) return null;
      return actor.getSubject(subjectId);
    },
    enabled: !!actor && !isFetching && subjectId !== null,
  });
}

export function useChapters(subjectId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.chapters.list(subjectId ?? 0n),
    queryFn: async (): Promise<ChapterSummary[]> => {
      if (!actor || subjectId === null) return [];
      return actor.listChapters(subjectId);
    },
    enabled: !!actor && !isFetching && subjectId !== null,
  });
}

export function useChapter(chapterId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.chapters.detail(chapterId ?? 0n),
    queryFn: async () => {
      if (!actor || chapterId === null) return null;
      return actor.getChapter(chapterId);
    },
    enabled: !!actor && !isFetching && chapterId !== null,
  });
}

export function useTopics(chapterId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.topics.list(chapterId ?? 0n),
    queryFn: async (): Promise<TopicSummary[]> => {
      if (!actor || chapterId === null) return [];
      return actor.listTopics(chapterId);
    },
    enabled: !!actor && !isFetching && chapterId !== null,
  });
}

export function useTopic(topicId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.topics.detail(topicId ?? 0n),
    queryFn: async () => {
      if (!actor || topicId === null) return null;
      return actor.getTopic(topicId);
    },
    enabled: !!actor && !isFetching && topicId !== null,
  });
}

export function useTopicPath(topicId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.topics.path(topicId ?? 0n),
    queryFn: async () => {
      if (!actor || topicId === null) return null;
      return actor.getTopicPath(topicId);
    },
    enabled: !!actor && !isFetching && topicId !== null,
  });
}

export function useQuestions(topicId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.questions.list(topicId ?? 0n),
    queryFn: async (): Promise<Question[]> => {
      if (!actor || topicId === null) return [];
      return actor.listQuestions(topicId);
    },
    enabled: !!actor && !isFetching && topicId !== null,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

function useInvalidateContent() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.classes.all });
    void queryClient.invalidateQueries({ queryKey: ["subjects"] });
    void queryClient.invalidateQueries({ queryKey: ["chapters"] });
    void queryClient.invalidateQueries({ queryKey: ["topics"] });
    void queryClient.invalidateQueries({ queryKey: ["questions"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.stats });
  };
}

export function useCreateClass() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: { name: string; description: string | null }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.createClass(input.name, input.description);
      if (!res) throw new Error("Failed to create class");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRenameClass() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      classId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.renameClass(
        input.classId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to rename class");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteClass() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (classId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.deleteClass(classId);
      if (!res) throw new Error("Failed to delete class");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useCreateSubject() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      classId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.createSubject(
        input.classId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to create subject");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRenameSubject() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      subjectId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.renameSubject(
        input.subjectId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to rename subject");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteSubject() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (subjectId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.deleteSubject(subjectId);
      if (!res) throw new Error("Failed to delete subject");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useCreateChapter() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      subjectId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.createChapter(
        input.subjectId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to create chapter");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRenameChapter() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      chapterId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.renameChapter(
        input.chapterId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to rename chapter");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteChapter() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (chapterId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.deleteChapter(chapterId);
      if (!res) throw new Error("Failed to delete chapter");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useCreateTopic() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      chapterId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.createTopic(
        input.chapterId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to create topic");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useRenameTopic() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: {
      topicId: Id;
      name: string;
      description: string | null;
    }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.renameTopic(
        input.topicId,
        input.name,
        input.description,
      );
      if (!res) throw new Error("Failed to rename topic");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteTopic() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (topicId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.deleteTopic(topicId);
      if (!res) throw new Error("Failed to delete topic");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export interface QuestionInput {
  topicId: Id;
  prompt: string;
  questionType: QuestionType;
  answer: AnswerData;
  explanation: string | null;
}

export function useCreateQuestion() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: QuestionInput) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.createQuestion(
        input.topicId,
        input.prompt,
        input.questionType,
        input.answer,
        input.explanation,
      );
      if (!res) throw new Error("Failed to create question");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useUpdateQuestion() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (input: QuestionInput & { questionId: Id }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.updateQuestion(
        input.questionId,
        input.prompt,
        input.questionType,
        input.answer,
        input.explanation,
      );
      if (!res) throw new Error("Failed to update question");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}

export function useDeleteQuestion() {
  const { actor } = useBackend();
  const invalidate = useInvalidateContent();
  return useMutation({
    mutationFn: async (questionId: Id) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.deleteQuestion(questionId);
      if (!res) throw new Error("Failed to delete question");
      return res;
    },
    onSuccess: () => {
      invalidate();
    },
  });
}
