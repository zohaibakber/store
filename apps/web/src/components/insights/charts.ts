import type { SalesDay } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { areaY, barY, d3Curve, defineChart, lineY, type ChartPoint } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { curveMonotoneX } from "d3-shape";
import { format } from "date-fns";

import { chartTheme, chartTooltip } from "@/components/ui/chart";
import { formatCount } from "@/lib/format";

import { WEEKDAY_SHORT } from "./presentation";

const dayLabel = (date: number) => format(date, "d MMM");

const axisTicks = <Value>(formatValue: (value: Value) => string) => ({
  line: false,
  ticks: { size: 0, padding: 8, format: formatValue },
});

const revenueTooltip = (points: readonly ChartPoint<SalesDay>[]) => {
  const point = points[0];
  if (!point) return { rows: [] };
  const day = point.datum;
  return {
    title: dayLabel(day.date),
    rows: [
      {
        color: "var(--chart-1)",
        label: "Revenue",
        value: `${formatPrice(day.revenue)} · ${formatCount(day.invoices, "sale")}`,
      },
      {
        color: "var(--muted-foreground)",
        label: "Previous period",
        value: formatPrice(day.previousRevenue),
      },
    ],
  };
};

export function createRevenueTrendChart(rows: ReadonlyArray<SalesDay>) {
  return defineChart(
    {
      marks: [
        areaY(rows, {
          id: "revenue-area",
          x: (row) => String(row.day),
          y: "revenue",
          key: (row) => `area-${row.day}`,
          curve: d3Curve(curveMonotoneX),
          fill: "var(--chart-1)",
          fillOpacity: 0.08,
        }),
        lineY(rows, {
          id: "revenue",
          x: (row) => String(row.day),
          y: "revenue",
          key: (row) => String(row.day),
          curve: d3Curve(curveMonotoneX),
          stroke: "var(--chart-1)",
          strokeWidth: 2,
        }),
        lineY(rows, {
          id: "previous",
          x: (row) => String(row.day),
          y: "previousRevenue",
          key: (row) => `previous-${row.day}`,
          curve: d3Curve(curveMonotoneX),
          stroke: "var(--muted-foreground)",
          strokeOpacity: 0.6,
          strokeWidth: 1.5,
          strokeDasharray: "4 4",
        }),
      ],
      scales: {
        x: {
          scale: () => scalePoint<string>().padding(0.1),
          axis: {
            ...axisTicks((value: string) => {
              const row = rows.find((candidate) => String(candidate.day) === value);
              return row ? dayLabel(row.date) : "";
            }),
            tickLabels: { thin: { minGap: 32, priority: "ends" } },
          },
        },
        y: {
          scale: scaleLinear,
          nice: true,
          grid: true,
          axis: axisTicks((value: number) => formatPrice(value)),
        },
      },
      theme: chartTheme,
    },
    { svgAnimation: false, focus: "group-x", tooltip: chartTooltip(revenueTooltip) },
  );
}

type WeekdayRow = { readonly weekday: number; readonly revenue: number; readonly peak: boolean };

export function createWeekdayChart(rows: ReadonlyArray<WeekdayRow>) {
  return defineChart(
    {
      marks: [
        barY(rows, {
          id: "weekday",
          x: (row) => WEEKDAY_SHORT[row.weekday] ?? "",
          y: "revenue",
          key: (row) => String(row.weekday),
          fill: (row) =>
            row.peak ? "var(--chart-1)" : "color-mix(in srgb, var(--chart-1) 40%, transparent)",
          maxThickness: 28,
          radius: 4,
        }),
      ],
      scales: {
        x: {
          scale: () => scaleBand<string>().paddingInner(0.24).paddingOuter(0.08),
          axis: axisTicks((value: string) => value),
        },
        y: { scale: scaleLinear, nice: true, grid: true, axis: false },
      },
      theme: chartTheme,
    },
    {
      svgAnimation: false,
      focus: "group-x",
      tooltip: chartTooltip((points: readonly ChartPoint<WeekdayRow>[]) => {
        const point = points[0];
        if (!point) return { rows: [] };
        return {
          title: WEEKDAY_SHORT[point.datum.weekday] ?? "",
          rows: [
            {
              color: point.color,
              label: "Average",
              value: formatPrice(Math.round(point.datum.revenue)),
            },
          ],
        };
      }),
    },
  );
}
