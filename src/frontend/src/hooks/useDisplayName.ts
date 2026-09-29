import { useAuth } from "@/hooks/useAuth";
import { useMySettings } from "@/hooks/useSettings";

/**
 * The name the app greets the owner with.
 *
 * Two records hold a name: the sign-in account (`useAuth`, whose `displayName`
 * comes from the local account row or GoTrue's `user_metadata.full_name`) and
 * the profile saved by Settings → Account (`user_settings.display_name`). Only
 * the second one has a screen that writes it, so it wins; the sign-in name is
 * the fallback for an account that has never saved its settings. Reading the
 * wrong half made the Display name field save successfully and change nothing
 * on screen.
 */
export function useDisplayName(): string | null {
  const { displayName } = useAuth();
  const settingsQuery = useMySettings();
  const profileName = settingsQuery.data?.displayName?.trim();
  return profileName || displayName || null;
}
