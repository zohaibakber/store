import { formatPrice } from "@store/services/format";
import { serviceLevelFor } from "@store/services/insights";
import * as React from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { LoadingSpinner } from "@/components/app/loading-spinner";
import { FrameCard } from "@/components/shared/frame-card";
import { EMPTY, formatCount, formatDate } from "@/lib/format";
import { useProductInsight, useStockPolicy } from "@/lib/inventory";

import {
  describeDemand,
  formatOrder,
  formatRate,
  formatShare,
  formatStockCover,
} from "./presentation";
import { StatusBadge } from "./status-badge";

function StockPlanCard({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  const [policy] = useStockPolicy();
  if (insight === null) return null;
  const rows: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    {
      label: "Demand",
      value: `${formatRate(insight.demand.dailyRate)} / day`,
    },
    { label: "Usable stock", value: formatCount(insight.usableUnits, "unit") },
    { label: "Cover", value: formatStockCover(insight) },
    {
      label: "Runs out",
      value: insight.stockoutAt === null ? EMPTY : formatDate(insight.stockoutAt),
    },
    { label: "Safety stock", value: formatCount(insight.safetyStock, "unit") },
    { label: "Reorder point", value: formatCount(insight.reorderPoint, "unit") },
    {
      label: "Suggested order",
      value:
        insight.order === null
          ? EMPTY
          : `${formatOrder(insight.order)}${insight.order.cost === null ? "" : ` · ${formatPrice(insight.order.cost)}`}`,
    },
    {
      label: "Class",
      value: `${insight.abc} · ${formatShare(serviceLevelFor(policy, insight.abc))} service level`,
    },
  ];
  return (
    <FrameCard
      action={<StatusBadge status={insight.status} />}
      description={describeDemand(insight.demand)}
      flush
      title="Stock plan"
    >
      <div className="flex flex-col gap-2 px-4 py-3">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
          {rows.map((row) => (
            <div className="flex h-6 items-center justify-between gap-4" key={row.label}>
              <dt className="truncate text-muted-foreground">{row.label}</dt>
              <dd
                className={
                  row.value === EMPTY
                    ? "text-right whitespace-nowrap text-muted-foreground tabular-nums"
                    : "text-right whitespace-nowrap tabular-nums"
                }
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
        {insight.expiryRiskUnits > 0 || insight.expiredUnits > 0 ? (
          <p className="text-xs text-muted-foreground">
            {insight.expiredUnits > 0
              ? `${formatCount(insight.expiredUnits, "unit")} already expired. `
              : ""}
            {insight.expiryRiskUnits > 0
              ? `${formatCount(insight.expiryRiskUnits, "unit")} will likely expire before ${insight.expiryRiskUnits === 1 ? "it sells" : "they sell"}, so ${insight.expiryRiskUnits === 1 ? "it doesn't" : "they don't"} count as usable stock.`
              : ""}
          </p>
        ) : null}
      </div>
    </FrameCard>
  );
}

export function ProductStockPlan({ productId }: { readonly productId: string }) {
  return (
    <AppErrorBoundary fallback={null}>
      <React.Suspense fallback={<LoadingSpinner className="h-48" />}>
        <StockPlanCard productId={productId} />
      </React.Suspense>
    </AppErrorBoundary>
  );
}
