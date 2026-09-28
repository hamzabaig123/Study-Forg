import { EmptyState } from "@/components/common/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AccuracyBucket } from "@/types";
import { BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface AccuracyChartProps {
  title: string;
  description?: string;
  buckets: AccuracyBucket[];
  /** ocid suffix so each breakdown chart is addressable. */
  ocid: string;
  index: number;
  /** Extra classes for the wrapping Card, e.g. a grid span. */
  className?: string;
}

/** Chart palette pulled from the design tokens so all three themes stay legible. */
const BAR_COLORS = [
  "oklch(var(--chart-1))",
  "oklch(var(--chart-2))",
  "oklch(var(--chart-3))",
  "oklch(var(--chart-4))",
  "oklch(var(--chart-5))",
];

interface ChartDatum {
  label: string;
  accuracy: number;
  correct: number;
  total: number;
}

function toDatum(bucket: AccuracyBucket): ChartDatum {
  return {
    label: bucket.bucketLabel,
    accuracy: Math.round(bucket.accuracyPercent * 10) / 10,
    correct: Number(bucket.correct),
    total: Number(bucket.total),
  };
}

export function AccuracyChart({
  title,
  description,
  buckets,
  ocid,
  index,
  className,
}: AccuracyChartProps) {
  const data = buckets.map(toDatum);

  return (
    <Card
      data-ocid={`analytics.${ocid}.${index}`}
      className={cn(
        "gap-0 rounded-lg border-border/70 py-0 shadow-none",
        className,
      )}
    >
      <CardHeader className="border-b border-border/60 px-5 py-4">
        <CardTitle className="font-display text-base font-semibold">
          {title}
        </CardTitle>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="px-5 py-5">
        {data.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No data yet"
            description="Complete a practice session or test and this breakdown will fill in."
            className="border-0 bg-transparent py-8"
          />
        ) : (
          <div
            className="h-64 w-full"
            data-ocid={`analytics.${ocid}.chart.${index}`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                margin={{ top: 8, right: 8, bottom: 4, left: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="oklch(var(--border))"
                  strokeDasharray="3 3"
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{
                    fill: "oklch(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                  interval={0}
                  height={48}
                  angle={-18}
                  textAnchor="end"
                />
                <YAxis
                  domain={[0, 100]}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tick={{
                    fill: "oklch(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                  tickFormatter={(value: number) => `${value}%`}
                />
                <Tooltip
                  cursor={{ fill: "oklch(var(--muted) / 0.5)" }}
                  contentStyle={{
                    background: "oklch(var(--popover))",
                    border: "1px solid oklch(var(--border))",
                    borderRadius: "var(--radius)",
                    color: "oklch(var(--popover-foreground))",
                    fontSize: 12,
                  }}
                  formatter={(value: number, _name, item) => {
                    const datum = item.payload as ChartDatum;
                    return [
                      `${formatPercent(value, 1)} (${datum.correct}/${datum.total})`,
                      "Accuracy",
                    ];
                  }}
                />
                <Bar dataKey="accuracy" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {data.map((datum, i) => (
                    <Cell
                      key={datum.label}
                      fill={BAR_COLORS[i % BAR_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
