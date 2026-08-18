import type { DashboardAnalytics } from "@store/contracts";
import type { ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { FrameCard } from "@/components/shared/frame-card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatPrice } from "@/lib/format";
import { isNumber, isString } from "@/lib/predicates";

const revenueChartConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

// Dates are UTC day keys (YYYY-MM-DD) from the analytics query; parse them as
// UTC so the tick label never slips a day in negative-offset timezones.
const dayLabel = (value: ReactNode) =>
  new Date(
    `${isString(value) || isNumber(value) ? String(value) : ""}T00:00:00Z`,
  ).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

export function RevenueChart({ data }: { data: DashboardAnalytics["revenueByDay"] }) {
  return (
    <FrameCard description="Daily sales over the last 30 days." title="Revenue">
      <ChartContainer className="aspect-auto h-56 w-full" config={revenueChartConfig}>
        <AreaChart data={[...data]}>
          <CartesianGrid vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="date"
            interval="preserveStartEnd"
            minTickGap={24}
            tickFormatter={dayLabel}
            tickLine={false}
            tickMargin={8}
          />
          <YAxis
            axisLine={false}
            tickFormatter={(value: number) => formatPrice(value)}
            tickLine={false}
            tickMargin={8}
            width={80}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, _name, item) => {
                  const invoices: number | undefined = item?.payload?.invoices;
                  return `${formatPrice(Number(value))} · ${invoices ?? 0} ${
                    invoices === 1 ? "invoice" : "invoices"
                  }`;
                }}
                labelFormatter={dayLabel}
              />
            }
            cursor={false}
          />
          <Area
            dataKey="revenue"
            fill="var(--color-revenue)"
            fillOpacity={0.1}
            isAnimationActive={false}
            stroke="var(--color-revenue)"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ChartContainer>
    </FrameCard>
  );
}
