import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * Drops the query cache when the signed-in identity changes.
 *
 * Query keys are not namespaced by account, so signing out and signing in again
 * in the same tab would otherwise paint the previous account's classes, notes
 * and share links from cache until each query refetched.
 */
export function useAccountCacheScope(): void {
  const queryClient = useQueryClient();
  const { account, principal } = useAuth();
  const scope = account?.id ?? principal ?? null;
  const previous = useRef(scope);

  useEffect(() => {
    if (previous.current === scope) return;
    previous.current = scope;
    queryClient.clear();
  }, [scope, queryClient]);
}
