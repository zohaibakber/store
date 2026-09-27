import { useAtom, useAtomValue } from "@effect/atom-react";
import type { InsightsReport, ProductInsight } from "@store/services/insights";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as React from "react";

import { stockPolicyAtom } from "./atoms";
import { useCatalogReplica } from "./provider";

export type InsightsState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Ready"; readonly report: InsightsReport; readonly refreshing: boolean }
  | { readonly _tag: "Error"; readonly message: string };

const DEFECT_MESSAGE = "Could not analyze inventory on this device. Try again in a moment.";

export const useInventoryInsights = (): InsightsState => {
  const inventory = useCatalogReplica();
  const result = useAtomValue(inventory.atoms.insights);
  return AsyncResult.matchWithError(result, {
    onInitial: (): InsightsState => ({ _tag: "Loading" }),
    onSuccess: (success): InsightsState => ({
      _tag: "Ready",
      report: success.value,
      refreshing: success.waiting,
    }),
    onError: (error): InsightsState => ({ _tag: "Error", message: error.message }),
    onDefect: (): InsightsState => ({ _tag: "Error", message: DEFECT_MESSAGE }),
  });
};

const insightIndexes = new WeakMap<InsightsReport, ReadonlyMap<string, ProductInsight>>();

const indexOf = (report: InsightsReport) => {
  const cached = insightIndexes.get(report);
  if (cached) return cached;
  const index = new Map(report.products.map((insight) => [insight.productId, insight]));
  insightIndexes.set(report, index);
  return index;
};

export const useProductInsight = (productId: string): ProductInsight | null => {
  const state = useInventoryInsights();
  const report = state._tag === "Ready" ? state.report : null;
  return React.useMemo(
    () => (report === null ? null : (indexOf(report).get(productId) ?? null)),
    [report, productId],
  );
};

export const useProductInsightIndex = (): ReadonlyMap<string, ProductInsight> | null => {
  const state = useInventoryInsights();
  return state._tag === "Ready" ? indexOf(state.report) : null;
};

export const useStockPolicy = () => useAtom(stockPolicyAtom);
