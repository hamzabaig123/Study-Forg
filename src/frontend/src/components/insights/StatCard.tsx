import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  /** Short supporting line, e.g. "across 6 classes". */
  hint?: string;
  /** Emphasise the first card in a row with the ember gradient. */
  featured?: boolean;
  index: number;
}

/**
 * A single dashboard metric. The value uses tabular mono figures so a row of
 * cards aligns cleanly, and the label follows the design system's uppercase
 * tracked label treatment.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  featured = false,
  index,
}: StatCardProps) {
  return (
    <Card
      data-ocid={`dashboard.stat_card.${index}`}
      className={cn(
        "group relative gap-0 overflow-hidden rounded-lg border-border/70 py-0 shadow-none transition-smooth hover:-translate-y-0.5 hover:shadow-elevated",
        featured && "border-primary/40",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-x-0 top-0 h-1 transition-smooth",
          featured
            ? "bg-gradient-primary"
            : "bg-border group-hover:bg-primary/40",
        )}
      />
      <div className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </p>
          <p className="numeric mt-3 text-3xl font-semibold leading-none text-foreground">
            {value}
          </p>
          {hint ? (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {hint}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg transition-smooth group-hover:scale-105",
            featured
              ? "bg-gradient-primary text-primary-foreground"
              : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}
