import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type {
  ExportFormat,
  Id,
  Result_3,
  Result_4,
  ShareTarget,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** The caller's share links. */
export function useShares() {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.shares.all,
    queryFn: async () => {
      if (!actor) return [];
      return actor.listShares();
    },
    enabled: !!actor && !isFetching,
  });
}

/** Create (or return the existing) public read-only share link. */
export function useCreateShare() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (target: ShareTarget): Promise<Result_4> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.createShare(target);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}

/** Revoke a share link; it no longer resolves afterwards. */
export function useRevokeShare() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.revokeShare(token);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares.all });
    },
  });
}

/** Export a topic or chapter as a downloadable file. */
export function useExportContent() {
  const { actor } = useBackend();
  return useMutation({
    mutationFn: async (input: {
      target: ShareTarget;
      format: ExportFormat;
    }): Promise<Result_3> => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.exportContent(input.target, input.format);
    },
  });
}

export type { Id };
