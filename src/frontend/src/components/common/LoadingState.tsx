import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  label?: string;
  /** Render layout-matched skeleton rows instead of a spinner. */
  variant?: "spinner" | "list" | "cards";
  rows?: number;
  className?: string;
}

export function LoadingState({
  label = "Loading…",
  variant = "spinner",
  rows = 4,
  className,
}: LoadingStateProps) {
  if (variant === "spinner") {
    return (
      <output
        className={cn(
          "flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground",
          className,
        )}
        aria-live="polite"
        data-ocid="loading_state"
      >
        <Loader2
          className="h-6 w-6 animate-spin text-primary"
          aria-hidden="true"
        />
        <p className="text-sm">{label}</p>
      </output>
    );
  }

  const ids = Array.from({ length: rows }, (_, i) => `skeleton-${i}`);

  if (variant === "cards") {
    return (
      <output
        className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}
        aria-live="polite"
        data-ocid="loading_state"
      >
        {ids.map((id) => (
          <div key={id} className="rounded-lg border border-border bg-card p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-8 w-16" />
            <Skeleton className="mt-3 h-3 w-28" />
          </div>
        ))}
      </output>
    );
  }

  return (
    <output
      className={cn("block space-y-3", className)}
      aria-live="polite"
      data-ocid="loading_state"
    >
      {ids.map((id) => (
        <div key={id} className="rounded-lg border border-border bg-card p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </div>
      ))}
    </output>
  );
}
