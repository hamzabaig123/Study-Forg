/**
 * React bindings for the test history: the merged list, one test's review, and
 * deleting a test. The device's own Test Builder runs are read from the local
 * store on every render, so a run finished a moment ago is listed before any
 * network round trip — and a deleted one disappears at once.
 */
import { useBackend } from "@/hooks/useBackend";
import {
  getLocalSession,
  listCompletedLocalSessions,
  subscribeLocalSessions,
} from "@/lib/localSessions";
import { queryKeys } from "@/lib/queryKeys";
import {
  type TestAttempt,
  type TestAttemptDetail,
  type TestKind,
  attemptFromLocal,
  deleteAttempt,
  detailFromLocal,
  loadAttemptDetail,
  loadRemoteAttempts,
  mergeAttempts,
} from "@/lib/testHistory";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";

export interface TestHistoryState {
  attempts: TestAttempt[];
  isLoading: boolean;
  /** The backend could not be read; the device's runs are still listed. */
  error: Error | null;
  refetch: () => void;
}

export function useTestHistory(): TestHistoryState {
  const { actor, isFetching } = useBackend();
  const local = useSyncExternalStore(
    subscribeLocalSessions,
    listCompletedLocalSessions,
    listCompletedLocalSessions,
  );
  const remote = useQuery({
    queryKey: queryKeys.testHistory.remote,
    queryFn: () => loadRemoteAttempts(actor),
    enabled: !!actor && !isFetching,
  });
  const attempts = useMemo(
    () => mergeAttempts(remote.data ?? [], local.map(attemptFromLocal)),
    [remote.data, local],
  );
  return {
    attempts,
    isLoading: remote.isLoading,
    error: remote.error,
    refetch: () => void remote.refetch(),
  };
}

export interface TestAttemptState {
  attempt: TestAttemptDetail | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useTestAttempt(kind: TestKind | null, id: string | null) {
  const { actor, isFetching } = useBackend();
  // A run still on this device answers without the network.
  const local = useSyncExternalStore(
    subscribeLocalSessions,
    () => (kind === "custom" ? getLocalSession(id) : null),
    () => (kind === "custom" ? getLocalSession(id) : null),
  );
  const localDetail = useMemo(
    () =>
      local && local.status === "completed" ? detailFromLocal(local) : null,
    [local],
  );
  const remote = useQuery({
    queryKey: queryKeys.testHistory.detail(kind ?? "", id ?? ""),
    queryFn: () =>
      kind && id ? loadAttemptDetail(actor, kind, id) : Promise.resolve(null),
    enabled: !localDetail && !!kind && !!id && !!actor && !isFetching,
  });
  return {
    attempt: localDetail ?? remote.data ?? null,
    isLoading: !localDetail && remote.isLoading,
    error: localDetail ? null : remote.error,
    refetch: () => void remote.refetch(),
  } satisfies TestAttemptState;
}

export function useDeleteTestAttempt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: TestKind; id: string }) =>
      deleteAttempt(kind, id),
    onSuccess: (_removed, { kind, id }) => {
      queryClient.removeQueries({
        queryKey: queryKeys.testHistory.detail(kind, id),
      });
      if (kind === "session" && /^\d{1,18}$/.test(id)) {
        queryClient.removeQueries({
          queryKey: queryKeys.sessions.result(BigInt(id)),
        });
      }
      // Everything that counts tests reads the row that just went.
      for (const queryKey of [
        queryKeys.testHistory.remote,
        ["custom-sessions", "server"],
        queryKeys.sessions.history,
        queryKeys.dashboard.stats,
        queryKeys.analytics.breakdown,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
