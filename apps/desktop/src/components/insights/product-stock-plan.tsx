import { formatPrice } from "@store/services/format";
import { serviceLevelFor } from "@store/services/insights";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { AppErrorBoundary } from "@/components/app/error-boundary";
import { LoadingSpinner } from "@/components/app/loading-spinner";
import {
  formatOrderNumber,
  PROGRESS_META,
  supplierNamesOf,
  UNKNOWN_SUPPLIER,
} from "@/components/purchases/presentation";
import { FrameCard } from "@/components/shared/frame-card";
import { EMPTY, formatCount, formatDate } from "@/lib/format";
import {
  useProductInsight,
  useStockPolicy,
  useSuppliers,
  useSuspenseProductOnOrder,
} from "@/lib/inventory";

import {
  describeDemand,
  formatOrder,
  formatRate,
  formatShare,
  formatStockCover,
} from "./presentation";
import { StatusBadge } from "./status-badge";

function OnOrder({ productId }: { readonly productId: string }) {
  const onOrder = useSuspenseProductOnOrder(productId);
  const suppliers = useSuppliers().data;
  if (onOrder.lines.length === 0) return null;
  const names = supplierNamesOf(suppliers);
  return (
    <div className="flex flex-col gap-1.5 border-t px-4 py-3 text-sm">
      <div className="flex h-6 items-center justify-between gap-4">
        <span className="text-muted-foreground">On order</span>
        <span className="tabular-nums">{formatCount(onOrder.onOrderBaseUnits, "unit")}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {onOrder.lines.map((line) => (
          <li className="flex items-center justify-between gap-4 text-xs" key={line.lineId}>
            <Link
              className="min-w-0 truncate font-medium outline-none hover:underline focus-visible:underline"
              params={{ orderId: line.orderId }}
              to="/purchases/$orderId"
            >
              Order <span className="tabular-nums">{formatOrderNumber(line.orderNumber)}</span> ·{" "}
              {names.get(line.supplierId) ?? UNKNOWN_SUPPLIER}
            </Link>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {PROGRESS_META[line.status].label} · {formatCount(line.remainingBaseUnits, "unit")}{" "}
              due
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
      <AppErrorBoundary fallback={null}>
        <React.Suspense fallback={null}>
          <OnOrder productId={productId} />
        </React.Suspense>
      </AppErrorBoundary>
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
