import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomSuspense,
  useAtomValue,
} from "@effect/atom-react";
import type {
  AnalyticsStatus,
  InsightsSummary,
  ProductId,
  ProductInsight,
  RestockPageRead,
  RestockPageRequest,
} from "@store/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { stockPolicyAtom } from "./atoms";
import { useCatalogReplica } from "./provider";

type InventoryInsights = {
  readonly summary: InsightsSummary | null;
  readonly status: AnalyticsStatus;
  readonly refreshing: boolean;
};

export const useInventoryInsights = (): InventoryInsights => {
  const result = useAtomSuspense(useCatalogReplica().atoms.insights);
  const { summary, status } = result.value;
  return { summary, status, refreshing: result.waiting || status.state !== "idle" };
};

export const useProductInsight = (productId: ProductId): ProductInsight | null =>
  useAtomSuspense(useCatalogReplica().atoms.productInsight(productId)).value;

export const useRestockPage = (request: RestockPageRequest): RestockPageRead =>
  useAtomSuspense(useCatalogReplica().atoms.restockPage(request)).value;

export const useRestockExport = () => {
  const { exportBuyList } = useCatalogReplica().atoms;
  return {
    exporting: AsyncResult.isWaiting(useAtomValue(exportBuyList)),
    run: useAtomSet(exportBuyList, { mode: "promiseExit" }),
  };
};

export const useRefreshInventoryInsights = () => useAtomRefresh(useCatalogReplica().atoms.insights);

export const useStockPolicy = () => useAtom(stockPolicyAtom);
