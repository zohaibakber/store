import { FrameCard } from "@/components/frame-card";
import type { DashboardAnalytics } from "@store/contracts";
import { ChartBarLineIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { formatPrice } from "@/lib/format";

const topProductsConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TopProducts({ products }: { products: DashboardAnalytics["topProducts"] }) {
  return (
    <FrameCard description="Highest revenue over the last 30 days." title="Top products">
      {products.length === 0 ? (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon aria-hidden="true" icon={ChartBarLineIcon} />
            </EmptyMedia>
            <EmptyTitle>No sales yet</EmptyTitle>
            <EmptyDescription>Create an invoice to see your best sellers here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ChartContainer className="aspect-auto h-56 w-full" config={topProductsConfig}>
          <BarChart
            data={products as Array<DashboardAnalytics["topProducts"][number]>}
            layout="vertical"
            margin={{ right: 72 }}
          >
            <XAxis dataKey="revenue" hide type="number" />
            <YAxis
              axisLine={false}
              dataKey="productName"
              tickLine={false}
              tickMargin={8}
              type="category"
              width={120}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => {
                    const units = (item?.payload as { unitsSold?: number } | undefined)?.unitsSold;
                    return `${formatPrice(Number(value))} · ${units ?? 0} units`;
                  }}
                />
              }
              cursor={false}
            />
            <Bar barSize={24} dataKey="revenue" fill="var(--color-revenue)" radius={4}>
              <LabelList
                className="fill-foreground"
                dataKey="revenue"
                formatter={(value) => formatPrice(Number(value))}
                offset={8}
                position="right"
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      )}
    </FrameCard>
  );
}
