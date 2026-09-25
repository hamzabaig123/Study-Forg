import { LoadingState } from "@/components/common/LoadingState";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "@tanstack/react-router";

/**
 * Component-level authentication guard for the signed-in shell.
 *
 * The guard lives in a component because it reads personal account state
 * through `useAuth`. Unverified accounts are restricted to the verification
 * page before they can access any private study route.
 */
export function RequireAuth() {
  const { isAuthenticated, isInitializing, isVerified } = useAuth();

  if (isInitializing) {
    return <LoadingState label="Restoring your session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  return <AppLayout />;
}
