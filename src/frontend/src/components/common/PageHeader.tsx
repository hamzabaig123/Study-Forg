import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "relative flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
      data-ocid="page_header"
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span
              aria-hidden="true"
              className="inline-block h-px w-6 bg-gradient-primary"
            />
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
      {/* Hairline that warms toward the right — a quiet signature under every
          page title, hand-set so it never fights the border above it. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-1px] left-0 h-px w-40 bg-gradient-to-r from-primary/50 to-transparent"
      />
    </header>
  );
}
