import { useAtom, useAtomRefresh, useAtomSuspense } from "@effect/atom-react";
import type {
  AnalyticsStatus,
  InsightsSummary,
  ProductInsight,
  RestockPageRead,
  RestockPageRequest,
} from "@store/contracts";

import { stockPolicyAtom } from "./atoms";
import { useCatalogReplica } from "./provider";

export type InventoryInsights = {
  readonly summary: InsightsSummary | null;
  readonly status: AnalyticsStatus;
  readonly refreshing: boolean;
};

export const useInventoryInsights = (): InventoryInsights => {
  const result = useAtomSuspense(useCatalogReplica().atoms.insights);
  const { summary, status } = result.value;
  return { summary, status, refreshing: result.waiting || status.state !== "idle" };
};

export const useProductInsight = (productId: string): ProductInsight | null =>
  useAtomSuspense(useCatalogReplica().atoms.productInsight(productId)).value;

export const useRestockPage = (request: RestockPageRequest): RestockPageRead =>
  useAtomSuspense(useCatalogReplica().atoms.restockPage(request)).value;

export const useRestockExport = () => useCatalogReplica().atoms.exportRestock;

export const useRefreshInventoryInsights = () => useAtomRefresh(useCatalogReplica().atoms.insights);

export const useStockPolicy = () => useAtom(stockPolicyAtom);
