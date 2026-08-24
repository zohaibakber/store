import { ChartBarLineIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { DashboardAnalytics } from "@store/contracts";
import { barX, defineChart, text, type ChartPoint } from "@tanstack/charts";
import { decorative } from "@tanstack/charts/mark/decorative";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { useMemo } from "react";

import { FrameCard } from "@/components/shared/frame-card";
import {
  Chart,
  ChartContainer,
  CHART_HEIGHT,
  chartTheme,
  chartTooltip,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatPrice } from "@/lib/format";

type TopProduct = DashboardAnalytics["topProducts"][number];

const topProductColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const truncateName = (value: string) => (value.length > 18 ? `${value.slice(0, 17)}…` : value);

const topProductsTooltip = (points: readonly ChartPoint<TopProduct>[]) => {
  const point = points[0];
  if (!point) return { rows: [] };
  const units = point.datum.unitsSold;
  return {
    title: point.datum.productName,
    rows: [
      {
        color: point.color,
        label: "Revenue",
        value: `${formatPrice(Number(point.xValue ?? 0))} · ${units} units`,
      },
    ],
  };
};

export function createTopProductsChart(rows: readonly TopProduct[]) {
  return defineChart(
    {
      marks: [
        barX(rows, {
          id: "product-bars",
          x: "revenue",
          y: "productName",
          key: (row) => row.productId,
          fill: (_row, context) => topProductColors[context.index % topProductColors.length],
          maxThickness: 24,
          radius: 4,
        }),
        decorative(
          text(rows, {
            id: "product-labels",
            x: "revenue",
            y: "productName",
            key: (row) => row.productId,
            text: (row) => formatPrice(row.revenue),
            dx: 8,
            anchor: "start",
            fill: "var(--foreground)",
            fontSize: 12,
            fontWeight: 500,
          }),
        ),
      ],
      x: { scale: scaleLinear, axis: false },
      y: {
        scale: () => scaleBand<string>().paddingInner(0.18).paddingOuter(0.08),
        axis: {
          line: false,
          ticks: {
            size: 0,
            padding: 8,
            format: (value: string) => truncateName(value),
          },
        },
      },
      margin: { right: 72 },
      theme: chartTheme,
    },
    {
      svgAnimation: false,
      focus: "group-y",
      tooltip: chartTooltip(topProductsTooltip),
    },
  );
}

export function TopProducts({ products }: { products: DashboardAnalytics["topProducts"] }) {
  const definition = useMemo(() => createTopProductsChart(products), [products]);

  return (
    <FrameCard description="Highest revenue over the last 30 days." title="Top products">
      {products.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={ChartBarLineIcon} />
            </EmptyMedia>
            <EmptyTitle>No sales yet</EmptyTitle>
            <EmptyDescription>Create an invoice and the leaders show up here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ChartContainer className="aspect-auto h-56 w-full">
          <Chart
            ariaLabel="Top products by revenue over the last 30 days"
            className="w-full"
            definition={definition}
            height={CHART_HEIGHT}
          />
        </ChartContainer>
      )}
    </FrameCard>
  );
}
