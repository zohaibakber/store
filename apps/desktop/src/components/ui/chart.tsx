import type { ChartPoint, ChartTheme, ChartTooltipContent } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { tooltip } from "@tanstack/charts/tooltip";
import { portal } from "@tanstack/charts/tooltip/portal";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export { Chart };

/** Matches `h-56` on the dashboard and product chart cards. */
export const CHART_HEIGHT = 224;

export const chartTheme = {
  background: "transparent",
  foreground: "var(--muted-foreground)",
  grid: "color-mix(in srgb, var(--border) 50%, transparent)",
} satisfies Partial<ChartTheme>;

export function chartTooltip<TDatum>(
  content: (points: readonly ChartPoint<TDatum>[]) => ChartTooltipContent,
) {
  return {
    use: tooltip,
    portal,
    className: "ts-chart-tooltip",
    anchor: "group-center" as const,
    placement: "auto" as const,
    content,
  };
}

export function ChartContainer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="chart"
      className={cn("flex aspect-video w-full justify-center text-xs", className)}
      {...props}
    />
  );
}
