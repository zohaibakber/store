import type { DashboardAnalytics } from "@store/contracts";
import { areaY, d3Curve, defineChart, type ChartPoint } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { curveMonotoneX } from "d3-shape";
import { useMemo } from "react";

import { FrameCard } from "@/components/shared/frame-card";
import {
  Chart,
  ChartContainer,
  CHART_HEIGHT,
  chartTheme,
  chartTooltip,
} from "@/components/ui/chart";
import { formatPrice } from "@/lib/format";

type RevenueDay = DashboardAnalytics["revenueByDay"][number];

const dayTick = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const dayLabel = (value: string) => dayTick.format(new Date(`${value}T00:00:00Z`));

const revenueTooltip = (points: readonly ChartPoint<RevenueDay>[]) => {
  const point = points[0];
  if (!point) return { rows: [] };
  const invoices = point.datum.invoices;
  return {
    title: dayLabel(String(point.xValue ?? "")),
    rows: [
      {
        color: point.color,
        label: "Revenue",
        value: `${formatPrice(Number(point.yValue ?? 0))} · ${invoices} ${
          invoices === 1 ? "invoice" : "invoices"
        }`,
      },
    ],
  };
};

export function createRevenueChart(rows: readonly RevenueDay[]) {
  return defineChart(
    {
      marks: [
        areaY(rows, {
          id: "revenue-area",
          x: "date",
          y: "revenue",
          key: "date",
          curve: d3Curve(curveMonotoneX),
          fill: "var(--chart-1)",
          fillOpacity: 0.1,
          stroke: "var(--chart-1)",
          strokeWidth: 2,
        }),
      ],
      x: {
        scale: () => scalePoint<string>().padding(0.1),
        axis: {
          line: false,
          ticks: {
            size: 0,
            padding: 8,
            format: (value: string) => dayLabel(value),
          },
          tickLabels: {
            thin: { minGap: 24, priority: "ends" },
          },
        },
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
        axis: {
          line: false,
          ticks: {
            size: 0,
            padding: 8,
            format: (value: number) => formatPrice(value),
          },
        },
      },
      theme: chartTheme,
    },
    {
      svgAnimation: false,
      focus: "group-x",
      tooltip: chartTooltip(revenueTooltip),
    },
  );
}

export function RevenueChart({ data }: { data: DashboardAnalytics["revenueByDay"] }) {
  const definition = useMemo(() => createRevenueChart(data), [data]);

  return (
    <FrameCard description="Daily sales over the last 30 days." title="Revenue">
      <ChartContainer className="aspect-auto h-56 w-full">
        <Chart
          ariaLabel="Daily revenue over the last 30 days"
          className="w-full"
          definition={definition}
          height={CHART_HEIGHT}
        />
      </ChartContainer>
    </FrameCard>
  );
}
