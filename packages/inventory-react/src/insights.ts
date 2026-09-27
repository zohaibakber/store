import { useAtom, useAtomRefresh, useAtomSuspense } from "@effect/atom-react";
import type { InsightsReport, ProductInsight } from "@store/services/insights";

import { stockPolicyAtom } from "./atoms";
import { useCatalogReplica } from "./provider";

export type InventoryInsights = {
  readonly report: InsightsReport;
  readonly refreshing: boolean;
};

export const useInventoryInsights = (): InventoryInsights => {
  const result = useAtomSuspense(useCatalogReplica().atoms.insights);
  return { report: result.value, refreshing: result.waiting };
};

export const useProductInsight = (productId: string): ProductInsight | null =>
  useAtomSuspense(useCatalogReplica().atoms.productInsight(productId)).value;

export const useRefreshInventoryInsights = () => useAtomRefresh(useCatalogReplica().atoms.insights);

export const useStockPolicy = () => useAtom(stockPolicyAtom);
