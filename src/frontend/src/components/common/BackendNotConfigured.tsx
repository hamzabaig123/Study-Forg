import { SUPABASE_PROBLEM } from "@/lib/supabase/env";
import { AlertTriangle, ExternalLink, Flame } from "lucide-react";

/**
 * Shown instead of the app when the chosen data backend is Supabase but the
 * project is not filled in.
 *
 * Without this the adapter mounts, every request answers 401, and the user sees
 * a blank page with a console error. The screen names the file, the two
 * variables and the exact complaint, so the fix is a paste rather than a
 * debugging session.
 */
export function BackendNotConfigured() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-subtle sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
            <Flame className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-xl font-semibold leading-tight">
              StudyForge
            </h1>
            <p className="text-muted-foreground text-sm">
              Supabase backend selected
            </p>
          </div>
        </div>

        <p className="mt-6 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            {SUPABASE_PROBLEM ??
              "The Supabase project is not configured, so no data can be loaded."}
          </span>
        </p>

        <ol className="mt-6 space-y-3 text-sm leading-relaxed">
          <li className="flex gap-3">
            <span className="text-muted-foreground shrink-0 font-mono">1</span>
            <span>
              Open{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                src/frontend/.env.local
              </code>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-muted-foreground shrink-0 font-mono">2</span>
            <span>
              Set{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                VITE_SUPABASE_URL
              </code>{" "}
              and{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
                VITE_SUPABASE_ANON_KEY
              </code>
              . The key must be the <em>publishable</em> one, copied whole — a
              truncated paste is the usual cause of this screen.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="text-muted-foreground shrink-0 font-mono">3</span>
            <span>
              Restart the dev server. Environment variables are read once at
              build time, so a reload alone keeps the old value.
            </span>
          </li>
        </ol>

        <p className="text-muted-foreground mt-6 border-t border-border/60 pt-4 text-xs leading-relaxed">
          To keep working offline meanwhile, set{" "}
          <code className="bg-muted rounded px-1.5 py-0.5 font-mono">
            VITE_DATA_BACKEND=mock
          </code>{" "}
          — that runs the whole app against the browser's own storage.
        </p>

        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="text-accent mt-4 inline-flex items-center gap-1.5 text-sm underline-offset-4 hover:underline"
          data-ocid="backend_not_configured.dashboard_link"
        >
          Open the Supabase dashboard
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
