import { createContext, use } from "react";
import type * as React from "react";

import { AsyncBoundary } from "@/components/app/error-boundary";
import { StatusLabel } from "@/components/insights/status-badge";
import { EMPTY } from "@/lib/format";
import { useProductInsight } from "@/lib/inventory";

import { formatStock } from "./stock";

const LiveInsightsContext = createContext(false);

export function LiveProductInsights({ children }: { readonly children: React.ReactNode }) {
  return <LiveInsightsContext value>{children}</LiveInsightsContext>;
}

const PLACEHOLDER = <span className="text-muted-foreground">{EMPTY}</span>;

function LiveStock({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  if (insight === null) return PLACEHOLDER;
  return (
    <span className={insight.onHandUnits === 0 ? "text-muted-foreground" : undefined}>
      {formatStock(insight.onHandUnits, insight.unitsPerPack, insight.tracksPacks)}
    </span>
  );
}

function LiveStatus({ productId }: { readonly productId: string }) {
  const insight = useProductInsight(productId);
  if (insight === null || insight.status === "inactive") return PLACEHOLDER;
  return <StatusLabel status={insight.status} />;
}

function InsightCell({ children }: { readonly children: React.ReactNode }) {
  const live = use(LiveInsightsContext);
  if (!live) return PLACEHOLDER;
  return <AsyncBoundary fallback={PLACEHOLDER}>{children}</AsyncBoundary>;
}

export function ProductStockCell({ productId }: { readonly productId: string }) {
  return (
    <InsightCell>
      <LiveStock productId={productId} />
    </InsightCell>
  );
}

export function ProductStatusCell({ productId }: { readonly productId: string }) {
  return (
    <InsightCell>
      <LiveStatus productId={productId} />
    </InsightCell>
  );
}
