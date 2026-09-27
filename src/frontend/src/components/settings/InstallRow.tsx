import { Button } from "@/components/ui/button";
import { installState, promptInstall, subscribeToInstall } from "@/lib/pwa";
import { Check, MonitorSmartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * The install affordance.
 *
 * Whether the browser will even offer an install is not something the app can
 * ask for: Chrome fires `beforeinstallprompt` once per visit and only for a
 * page that is served over HTTPS with a worker and a valid manifest, and iOS
 * Safari fires nothing at all — its "Add to Home Screen" is a user action in the
 * share sheet. So the row has three states, and the middle one is the honest
 * instruction rather than a button that does nothing.
 */
export function InstallRow() {
  const [state, setState] = useState(installState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeToInstall(() => setState(installState())), []);

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    setState(installState());
    if (outcome === "accepted") {
      toast.success("StudyForge is on your home screen.");
    } else if (outcome === "dismissed") {
      toast.info("Not now — you can install it from this row any time.");
    }
  };

  if (state.installed) {
    return (
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-4">
        <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Installed on this device. It opens full screen and keeps your library
          readable without a connection.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="flex items-center gap-2 font-display text-base text-card-foreground">
          <MonitorSmartphone
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          Install StudyForge
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {state.available
            ? "Puts it on your home screen with its own window, and keeps the library readable offline."
            : "Your browser has not offered an install yet. On iPhone: Share → Add to Home Screen. On Chrome or Edge: the menu → Install app."}
        </p>
      </div>
      {state.available ? (
        <Button
          type="button"
          variant="outline"
          size="action"
          disabled={busy}
          onClick={install}
          className="shrink-0"
          data-ocid="settings.install.button"
        >
          Install app
        </Button>
      ) : null}
    </div>
  );
}
