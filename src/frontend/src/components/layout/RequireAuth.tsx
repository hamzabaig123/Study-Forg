import { LoadingState } from "@/components/common/LoadingState";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/hooks/useAuth";
import { useBackend } from "@/hooks/useBackend";
import { Navigate } from "@tanstack/react-router";

/**
 * Component-level authentication guard for the signed-in shell.
 *
 * The guard lives in a component because it reads session state through
 * `useAuth`, which is a hook: local accounts in the dev mock app, the Internet
 * Identity principal against a real canister. Unverified accounts are
 * restricted to the verification page before they can access any private study
 * route.
 */
export function RequireAuth() {
  const { isAuthenticated, isInitializing, isVerified, awaitsNewPassword } =
    useAuth();
  const { actor } = useBackend();

  if (isInitializing) {
    return <LoadingState label="Restoring your session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // A session that came from a reset link has proved the address is reachable and
  // nothing else, so it is not yet an account allowed to read its own rows. It
  // reads like a signed-in visitor everywhere else in this app, which is exactly
  // why the gate has to be here rather than on the page that asks for the
  // password.
  if (awaitsNewPassword) {
    return <Navigate to="/reset-password" replace />;
  }

  if (!isVerified) {
    return <Navigate to="/verify-email" replace />;
  }

  // Page queries disable themselves without an actor, and a disabled query
  // reads as "loaded, nothing found" — so the shell waits for the backend
  // instead of letting every route flash an empty state first.
  if (!actor) {
    return <LoadingState label="Loading your workspace…" />;
  }

  return <AppLayout />;
}
