import type { Invoice, Product } from "@store/contracts";
import type { StockPolicy, StockReport } from "@store/services/stock-recommendations";
import { Result } from "effect";
import { useEffect, useState } from "react";

import { reportError } from "@/lib/report-error";

import { useCatalogReplica } from "./provider";

export type RecommendationState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly report: StockReport }
  | { readonly _tag: "Error"; readonly message: string };

export function useStockRecommendations(
  products: ReadonlyArray<Product>,
  invoices: ReadonlyArray<Invoice>,
  policy: StockPolicy,
  refresh: number,
): RecommendationState {
  const inventory = useCatalogReplica();
  const [completed, setCompleted] = useState<{
    products: ReadonlyArray<Product>;
    invoices: ReadonlyArray<Invoice>;
    policy: StockPolicy;
    inventory: typeof inventory;
    refresh: number;
    state: RecommendationState;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void inventory.recommendStock({ products, invoices, policy }, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        const state: RecommendationState = Result.isSuccess(result)
          ? { _tag: "Ready", report: result.success }
          : { _tag: "Error", message: result.failure.message };
        setCompleted({ products, invoices, policy, inventory, refresh, state });
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        reportError(cause, { op: "stock-recommendations" });
        setCompleted({
          products,
          invoices,
          policy,
          inventory,
          refresh,
          state: {
            _tag: "Error",
            message: "Could not analyze saved inventory. Try refreshing the dashboard.",
          },
        });
      },
    );
    return () => controller.abort();
  }, [inventory, products, invoices, policy, refresh]);
  // Never expose a prior organization's report or let an older policy's buy list be exported.
  return completed?.products === products &&
    completed.invoices === invoices &&
    completed.policy === policy &&
    completed.inventory === inventory &&
    completed.refresh === refresh
    ? completed.state
    : { _tag: "Loading" };
}
