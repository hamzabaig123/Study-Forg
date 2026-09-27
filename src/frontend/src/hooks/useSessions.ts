import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type {
  Id,
  Result,
  Result_1,
  Result_5,
  SessionMode,
  SessionScope,
  StartSessionRequest,
  SubmitAnswerRequest,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Start a practice session or timed test. */
export function useStartSession() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: StartSessionRequest): Promise<Result_1> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.startSession(request);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.history,
      });
    },
  });
}

/** Fetch a live session, including its questions (answers withheld). */
export function useSession(sessionId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.sessions.detail(sessionId ?? 0n),
    queryFn: async () => {
      if (!actor || sessionId === null) return null;
      return actor.getSession(sessionId);
    },
    enabled: !!actor && !isFetching && sessionId !== null,
  });
}

/** Submit one answer and receive immediate feedback. */
export function useSubmitAnswer() {
  const { actor } = useBackend();
  return useMutation({
    mutationFn: async (request: SubmitAnswerRequest): Promise<Result> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.submitAnswer(request);
    },
  });
}

/** Finish a session (or let a timed test auto-submit) and record its result. */
export function useCompleteSession() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: Id): Promise<Result_5> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.completeSession(sessionId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessions.history,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.stats,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.analytics.breakdown,
      });
    },
  });
}

/** Fetch a recorded session result. */
export function useSessionResult(sessionId: Id | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.sessions.result(sessionId ?? 0n),
    queryFn: async () => {
      if (!actor || sessionId === null) return null;
      return actor.getSessionResult(sessionId);
    },
    enabled: !!actor && !isFetching && sessionId !== null,
  });
}

/** Practice and test attempt history, newest first. */
export function useAttemptHistory() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.sessions.history,
    queryFn: async () => {
      if (!actor) return [];
      return (await actor.getAttemptHistory()) ?? [];
    },
    enabled: !!actor && !isFetching,
  });
}

export type { SessionMode, SessionScope };
