import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type { DraftQuestion, GenerateRequest, Id, Result_2 } from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** The caller's AI configuration state. Never returns the saved key. */
export function useAiConfig() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.ai.config,
    queryFn: async () => {
      if (!actor) return { hasPersonalKey: false };
      return actor.getAiConfig();
    },
    enabled: !!actor && !isFetching,
  });
}

/** Save (or replace) the caller's personal OpenAI key. */
export function useSaveAiKey() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.saveAiKey(key);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.config });
    },
  });
}

/** Remove the caller's personal OpenAI key. */
export function useRemoveAiKey() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.removeAiKey();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ai.config });
    },
  });
}

/** Generate draft questions for a topic. */
export function useGenerateDrafts() {
  const { actor } = useBackend();
  return useMutation({
    mutationFn: async (request: GenerateRequest): Promise<Result_2> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.generateDrafts(request);
    },
  });
}

/** Accept an AI-generated draft into a topic's question bank. */
export function useAcceptDraft() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { topicId: Id; draft: DraftQuestion }) => {
      if (!actor) throw new Error("Backend is not ready");
      const res = await actor.acceptDraft(input.topicId, input.draft);
      if (!res) throw new Error("Failed to accept draft question");
      return res;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.questions.list(variables.topicId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.stats,
      });
    },
  });
}
