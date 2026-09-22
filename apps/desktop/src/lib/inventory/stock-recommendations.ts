import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { Invoice, Product } from "@store/contracts";
import type { StockPolicy } from "@store/services/stock-recommendations";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect } from "react";

import { useCatalogReplica } from "./provider";

export type RecommendationState =
  | { readonly _tag: "Loading" }
  | {
      readonly _tag: "Ready";
      readonly report: import("@store/services/stock-recommendations").StockReport;
    }
  | { readonly _tag: "Error"; readonly message: string };

export function useStockRecommendations(
  products: ReadonlyArray<Product>,
  invoices: ReadonlyArray<Invoice>,
  policy: StockPolicy,
  refresh: number,
): RecommendationState {
  const inventory = useCatalogReplica();
  const setArg = useAtomSet(inventory.atoms.stockRecommendations);
  const result = useAtomValue(inventory.atoms.stockRecommendations);

  useEffect(() => {
    setArg({ products, invoices, policy, refresh });
  }, [inventory, products, invoices, policy, refresh, setArg]);

  return AsyncResult.matchWithWaiting(result, {
    onWaiting: () => ({ _tag: "Loading" }),
    onSuccess: (success) => ({ _tag: "Ready", report: success.value }),
    onError: (message) => ({ _tag: "Error", message }),
    onDefect: () => ({
      _tag: "Error",
      message: "Could not analyze saved inventory. Try refreshing the dashboard.",
    }),
  });
}
