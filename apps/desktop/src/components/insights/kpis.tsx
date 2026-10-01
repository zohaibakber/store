import type { InsightsSummary } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import type { SalesPeriod } from "@store/services/insights";

import { FrameCard } from "@/components/shared/frame-card";
import { Badge } from "@/components/ui/badge";
import { EMPTY, formatCount, formatNumber } from "@/lib/format";

import { changeTone, formatChange, formatShare } from "./presentation";

const SPARK_WIDTH = 120;
const SPARK_HEIGHT = 28;

function Sparkline({
  values,
  label,
}: {
  readonly values: ReadonlyArray<number>;
  readonly label: string;
}) {
  if (values.length < 2 || values.every((value) => value === 0)) return null;
  const max = Math.max(...values, 1);
  const step = SPARK_WIDTH / (values.length - 1);
  const points = values
    .map(
      (value, index) =>
        `${(index * step).toFixed(1)},${(SPARK_HEIGHT - (value / max) * SPARK_HEIGHT).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      aria-label={label}
      className="h-6 w-full text-chart-1"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 -1 ${SPARK_WIDTH} ${SPARK_HEIGHT + 2}`}
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Delta({ value }: { readonly value: number | null }) {
  const label = formatChange(value);
  if (label === null) return null;
  const tone = changeTone(value);
  return (
    <Badge variant={tone === "secondary" ? "secondary" : tone}>
      <span className="tabular-nums">{label}</span>
    </Badge>
  );
}

function Kpi({
  label,
  value,
  change,
  detail,
  children,
}: {
  readonly label: string;
  readonly value: string;
  readonly change?: number | null;
  readonly detail: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-muted-foreground">{label}</span>
        {change === undefined ? null : <Delta value={change} />}
      </div>
      <span className="truncate text-2xl font-medium tabular-nums">{value}</span>
      <span className="truncate text-xs text-muted-foreground">{detail}</span>
      {children}
    </div>
  );
}

export function KpiGrid({
  period,
  summary,
}: {
  readonly period: SalesPeriod;
  readonly summary: InsightsSummary;
}) {
  const span = `previous ${period.days} days`;
  const series = period.series.map((day) => day.revenue);
  return (
    <FrameCard aria-label="Key figures" flush role="region">
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          change={period.revenueChange}
          detail={`${formatPrice(period.previousRevenue)} in the ${span}`}
          label="Revenue"
          value={formatPrice(period.revenue)}
        >
          <Sparkline label={`Daily revenue, last ${period.days} days`} values={series} />
        </Kpi>
        <Kpi
          detail={
            period.grossProfit === null
              ? "Add purchase prices to see profit"
              : period.costCoverage < 0.995
                ? `Covers ${formatShare(period.costCoverage)} of sales with known costs`
                : "Revenue minus purchase cost"
          }
          label="Gross profit"
          value={period.grossProfit === null ? EMPTY : formatPrice(period.grossProfit)}
        >
          {period.margin === null ? null : (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatShare(period.margin)} margin
            </span>
          )}
        </Kpi>
        <Kpi
          change={period.invoicesChange}
          detail={
            period.averageBasket === null
              ? "No sales in this period"
              : `${formatPrice(period.averageBasket)} average sale`
          }
          label="Sales"
          value={formatNumber(period.invoices)}
        >
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatCount(summary.sales.today.invoices, "sale")} today ·{" "}
            {formatPrice(summary.sales.today.revenue)}
          </span>
        </Kpi>
        <Kpi
          detail={`${formatPrice(summary.inventory.valueAtRetail)} at retail`}
          label="Stock value"
          value={formatPrice(summary.inventory.valueAtCost)}
        >
          {summary.inventory.deadStockValue > 0 ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatPrice(summary.inventory.deadStockValue)} not selling
            </span>
          ) : null}
        </Kpi>
      </div>
    </FrameCard>
  );
}
