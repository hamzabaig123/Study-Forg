import { useBackend } from "@/hooks/useBackend";
import { queryKeys } from "@/lib/queryKeys";
import type {
  DeviceType,
  EditToken,
  LinkDetail,
  ResolveResult,
  ScanStats,
  ShortCode,
} from "@/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a short code for the scan redirect. Anonymous callers are allowed,
 * so this runs without an identity. `device` and `country` are the only scan
 * context the backend records — never a raw IP address.
 *
 * `resolveCode` is a non-idempotent update that appends a scan record, so this
 * query must never refetch on its own: no window-focus refetch, no reconnect
 * refetch, and no stale-time refetch. The scan is logged exactly once per
 * mount, and the page's explicit retry button is the only way to re-run it.
 */
export function useResolveCode(
  code: string | null,
  device: DeviceType,
  country: string | null,
) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.links.resolve(code ?? "", device, country),
    queryFn: async (): Promise<ResolveResult | null> => {
      if (!actor || !code) return null;
      return actor.resolveCode(code, device, country);
    },
    enabled: !!actor && !isFetching && !!code,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Link detail by secret edit token. Anonymous, token-gated. */
export function useLinkDetail(editToken: string | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.links.detail(editToken ?? ""),
    queryFn: async (): Promise<LinkDetail | null> => {
      if (!actor || !editToken) return null;
      return actor.getLinkByToken(editToken);
    },
    enabled: !!actor && !isFetching && !!editToken,
    retry: false,
  });
}

/** Scan statistics for one link by secret edit token. */
export function useScanStats(editToken: string | null) {
  const { actor, isFetching } = useBackend();
  return useQuery({
    queryKey: queryKeys.links.stats(editToken ?? ""),
    queryFn: async (): Promise<ScanStats | null> => {
      if (!actor || !editToken) return null;
      return actor.getScanStats(editToken);
    },
    enabled: !!actor && !isFetching && !!editToken,
    retry: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/** Create a short link. Anonymous callers are allowed. */
export function useCreateLink() {
  const { actor } = useBackend();
  return useMutation({
    mutationFn: async (targetUrl: string) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.createLink(targetUrl);
    },
  });
}

/** Change the target URL of a link by secret edit token. */
export function useUpdateLinkTarget() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { editToken: EditToken; targetUrl: string }) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.updateTarget(input.editToken, input.targetUrl);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.links.detail(variables.editToken),
      });
    },
  });
}

/** Pause or unpause a link by secret edit token. */
export function useSetLinkStatus() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { editToken: EditToken; paused: boolean }) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.setPaused(input.editToken, input.paused);
    },
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.links.detail(variables.editToken),
      });
    },
  });
}

/** Soft-delete a link by secret edit token. */
export function useDeleteLink() {
  const { actor } = useBackend();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (editToken: EditToken) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.deleteLink(editToken);
    },
    onSuccess: (_result, editToken) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.links.detail(editToken),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.links.stats(editToken),
      });
    },
  });
}

/** Report a short link as abusive. */
export function useReportAbuse() {
  const { actor } = useBackend();
  return useMutation({
    mutationFn: async (input: { code: ShortCode; reason: string }) => {
      if (!actor) throw new Error("Backend is not ready");
      return actor.reportAbuse(input.code, input.reason);
    },
  });
}
