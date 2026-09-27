import { formatPrice } from "@store/services/format";
import { serviceLevelFor } from "@store/services/insights";
import * as React from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { FrameCard } from "@/components/shared/frame-card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useProductInsight, useStockPolicy } from "@/lib/inventory";

import {
  describeDemand,
  formatCount,
  formatCover,
  formatOrder,
  formatRate,
  formatShare,
  STATUS_META,
} from "./presentation";
import { StatusBadge } from "./status-badge";

function StockPlanCard({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  const [policy] = useStockPolicy();
  if (insight === null) return null;
  const meta = STATUS_META[insight.status];
  const rows: ReadonlyArray<{ readonly label: string; readonly value: React.ReactNode }> = [
    {
      label: "Demand",
      value: `${formatRate(insight.demand.dailyRate)} units/day`,
    },
    { label: "Usable stock", value: `${formatCount(insight.usableUnits)} units` },
    { label: "Cover", value: formatCover(insight.daysOfCover) },
    {
      label: "Runs out",
      value: insight.stockoutAt === null ? "—" : formatDate(insight.stockoutAt),
    },
    { label: "Safety stock", value: `${formatCount(insight.safetyStock)} units` },
    { label: "Reorder point", value: `${formatCount(insight.reorderPoint)} units` },
    {
      label: "Suggested order",
      value:
        insight.order === null
          ? "None"
          : `${formatOrder(insight.order)}${insight.order.cost === null ? "" : ` · ${formatPrice(insight.order.cost)}`}`,
    },
    {
      label: "Class",
      value: `${insight.abc} · ${formatShare(serviceLevelFor(policy, insight.abc))} service`,
    },
  ];
  return (
    <FrameCard
      action={<StatusBadge label={meta.label} tone={meta.tone} />}
      description={describeDemand(insight.demand)}
      title="Stock plan"
    >
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div className="flex items-baseline justify-between gap-4" key={row.label}>
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-right tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {insight.expiryRiskUnits > 0 || insight.expiredUnits > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {insight.expiredUnits > 0
            ? `${formatCount(insight.expiredUnits)} units already expired. `
            : ""}
          {insight.expiryRiskUnits > 0
            ? `${formatCount(insight.expiryRiskUnits)} units will likely expire before they sell, so they don't count as usable stock.`
            : ""}
        </p>
      ) : null}
    </FrameCard>
  );
}

export function ProductStockPlan({ productId }: { readonly productId: string }) {
  return (
    <AppErrorBoundary fallback={null}>
      <React.Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <StockPlanCard productId={productId} />
      </React.Suspense>
    </AppErrorBoundary>
  );
}
