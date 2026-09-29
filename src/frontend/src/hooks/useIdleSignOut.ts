import { useAuth } from "@/hooks/useAuth";
import { USE_SUPABASE } from "@/lib/authMode";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Sign out after this long without pointer or keyboard activity.
 *
 * Thirty minutes is the common default for accounts that hold study data on a
 * shared computer; a reader who scrolls or types stays signed in.
 */
const IDLE_TIMEOUT_MS = 30 * 60_000;

/**
 * Idle sign-out for the Supabase mode.
 *
 * The project's GoTrue `sessions_inactivity_timeout` is a second, server-side
 * ceiling on the same idea; this is the in-browser half that ends the session
 * the moment the tab goes quiet. Other modes need it less — the dev mock has
 * no real accounts and Internet Identity delegates session length to the
 * provider — so the hook no-ops there.
 */
export function useIdleSignOut() {
  const { isAuthenticated, signOut } = useAuth();
  useEffect(() => {
    if (!USE_SUPABASE || !isAuthenticated) {
      return;
    }
    let timer = 0;
    const expire = () => {
      toast.info("Signed out after 30 minutes without activity.");
      signOut();
    };
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(expire, IDLE_TIMEOUT_MS);
    };
    // Scrolling and pointer movement cover reading and studying; keydown covers
    // typing in any focused field. None of these bubble-cancel anything, so
    // passive listeners are enough.
    const events = ["pointerdown", "pointermove", "keydown", "scroll"];
    for (const event of events) {
      window.addEventListener(event, reset, { passive: true });
    }
    reset();
    return () => {
      window.clearTimeout(timer);
      for (const event of events) {
        window.removeEventListener(event, reset);
      }
    };
  }, [isAuthenticated, signOut]);
}
