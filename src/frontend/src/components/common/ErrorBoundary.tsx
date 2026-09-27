import { Button } from "@/components/ui/button";
import { AlertTriangle, Flame, RotateCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence against a white screen.
 *
 * A render error anywhere below this boundary used to leave the visitor with an
 * empty page and a console stack they have no reason to open. The fallback
 * names the failure, offers a reload (which is the fix for the common case: a
 * chunk that failed to arrive over a flaky connection), and keeps the brand
 * mark so the screen is recognisably the app rather than a dead tab.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is where a stack is actually readable; nothing here reports
    // to a third party, so no study content leaves the device.
    console.error("StudyForge failed to render", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
        <div
          className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-subtle sm:p-8"
          role="alert"
          data-ocid="error_boundary"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
              <Flame className="size-5" aria-hidden="true" />
            </span>
            <p className="text-muted-foreground text-sm">StudyForge</p>
          </div>

          <h1 className="font-display mt-6 text-xl font-semibold leading-tight">
            Something went wrong
          </h1>
          <p className="text-muted-foreground mt-1.5 flex items-start gap-2 text-sm leading-relaxed">
            <AlertTriangle
              className="text-destructive mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              This page failed while rendering, so nothing was lost — reloading
              starts it again from the beginning.
            </span>
          </p>

          <p className="bg-muted mt-4 rounded-md p-3 font-mono text-xs break-words">
            {error.message || error.name}
          </p>

          <Button
            type="button"
            className="mt-6 gap-2 rounded-full"
            onClick={this.reload}
            data-ocid="error_boundary.reload_button"
          >
            <RotateCw className="size-4" aria-hidden="true" />
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
