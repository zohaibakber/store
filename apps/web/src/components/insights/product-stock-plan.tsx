import type { ProductInsight } from "@store/contracts";
import { formatPrice } from "@store/services/format";
import { serviceLevelFor, type StockPolicy } from "@store/services/insights";
import { Link } from "@tanstack/react-router";
import * as React from "react";

import { AppErrorBoundary, AsyncBoundary } from "@/components/app/error-boundary";
import {
  formatOrderNumber,
  PROGRESS_META,
  supplierNamesOf,
  UNKNOWN_SUPPLIER,
} from "@/components/purchases/presentation";
import { FrameCard } from "@/components/shared/frame-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EMPTY, formatCount } from "@/lib/format";
import { formatDate } from "@/lib/format-date";
import {
  useProductInsight,
  useStockPolicy,
  useSuspenseProductOnOrder,
  useSuspenseSuppliers,
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
  const suppliers = useSuspenseSuppliers();
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

const PLAN_LABELS = [
  "Demand",
  "Usable stock",
  "Cover",
  "Runs out",
  "Safety stock",
  "Reorder point",
  "Suggested order",
  "Class",
] as const;

type PlanLabel = (typeof PLAN_LABELS)[number];

const planValues = (insight: ProductInsight, policy: StockPolicy) =>
  ({
    Demand: `${formatRate(insight.demand.dailyRate)} / day`,
    "Usable stock": formatCount(insight.usableUnits, "unit"),
    Cover: formatStockCover(insight),
    "Runs out": insight.stockoutAt === null ? EMPTY : formatDate(insight.stockoutAt),
    "Safety stock": formatCount(insight.safetyStock, "unit"),
    "Reorder point": formatCount(insight.reorderPoint, "unit"),
    "Suggested order":
      insight.order === null
        ? EMPTY
        : `${formatOrder(insight.order)}${insight.order.cost === null ? "" : ` · ${formatPrice(insight.order.cost)}`}`,
    Class: `${insight.abc} · ${formatShare(serviceLevelFor(policy, insight.abc))} service level`,
  }) satisfies Record<PlanLabel, string>;

function PlanRows({ children }: { readonly children: (label: PlanLabel) => React.ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
      {PLAN_LABELS.map((label) => (
        <div className="flex h-6 items-center justify-between gap-4" key={label}>
          <dt className="truncate text-muted-foreground">{label}</dt>
          {children(label)}
        </div>
      ))}
    </dl>
  );
}

const pendingValue = () => (
  <dd>
    <Skeleton className="h-4 w-16" />
  </dd>
);

function PlanStatus({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  return insight === null ? null : <StatusBadge status={insight.status} />;
}

function PlanDemand({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  return insight === null ? null : describeDemand(insight.demand);
}

function PlanBody({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  const [policy] = useStockPolicy();
  const values = insight === null ? null : planValues(insight, policy);
  return (
    <>
      <PlanRows>
        {(label) => {
          const value = values === null ? EMPTY : values[label];
          return (
            <dd
              className={
                value === EMPTY
                  ? "text-right whitespace-nowrap text-muted-foreground tabular-nums"
                  : "text-right whitespace-nowrap tabular-nums"
              }
            >
              {value}
            </dd>
          );
        }}
      </PlanRows>
      {insight !== null && (insight.expiryRiskUnits > 0 || insight.expiredUnits > 0) ? (
        <p className="text-xs text-muted-foreground">
          {insight.expiredUnits > 0
            ? `${formatCount(insight.expiredUnits, "unit")} already expired. `
            : ""}
          {insight.expiryRiskUnits > 0
            ? `${formatCount(insight.expiryRiskUnits, "unit")} will likely expire before ${insight.expiryRiskUnits === 1 ? "it sells" : "they sell"}, so ${insight.expiryRiskUnits === 1 ? "it doesn't" : "they don't"} count as usable stock.`
            : ""}
        </p>
      ) : null}
    </>
  );
}

export function ProductStockPlan({ productId }: { readonly productId: string }) {
  return (
    <AppErrorBoundary fallback={null}>
      <FrameCard
        action={
          <React.Suspense fallback={null}>
            <PlanStatus productId={productId} />
          </React.Suspense>
        }
        description={
          <React.Suspense fallback={null}>
            <PlanDemand productId={productId} />
          </React.Suspense>
        }
        flush
        title="Stock plan"
      >
        <div className="flex flex-col gap-2 px-4 py-3">
          <React.Suspense fallback={<PlanRows>{pendingValue}</PlanRows>}>
            <PlanBody productId={productId} />
          </React.Suspense>
        </div>
        <AsyncBoundary fallback={null}>
          <OnOrder productId={productId} />
        </AsyncBoundary>
      </FrameCard>
    </AppErrorBoundary>
  );
}
