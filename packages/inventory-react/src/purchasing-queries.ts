import { useAtomSuspense, useAtomValue } from "@effect/atom-react";
import {
  purchasingBlockedByStaleReplica,
  staleReplicaRejection,
  type PurchaseOrder,
  type StockMovement,
  type Supplier,
  type SupplierId,
} from "@store/contracts";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as React from "react";

import type { ReplicaAuthority } from "./host";
import type { PurchaseOrderTab } from "./list-request";
import { useCatalogReplica, useInventorySyncActivity } from "./provider";
import {
  NOTHING_ON_ORDER,
  type ProductOnOrder,
  type PurchaseOrderListFilters,
  type PurchaseOrderListRequest,
} from "./purchasing";
import { HISTORY_PAGE_SIZE, useLatestSuccess } from "./queries";

export const useSuspenseSuppliers = (): ReadonlyArray<Supplier> =>
  useAtomSuspense(useCatalogReplica().atoms.suppliers).value;

export const useSuspensePurchaseOrderPage = (
  request: PurchaseOrderListRequest,
): ReadonlyArray<PurchaseOrder> =>
  React.useDeferredValue(
    useAtomSuspense(useCatalogReplica().atoms.purchaseOrderPage(request)).value,
  );

export const useSuspensePurchaseOrderListCount = (filters: PurchaseOrderListFilters): number =>
  React.useDeferredValue(
    useAtomSuspense(useCatalogReplica().atoms.purchaseOrderListCount(filters)).value,
  );

export const useSuspenseOpenPurchaseOrders = (
  limit = HISTORY_PAGE_SIZE,
): ReadonlyArray<PurchaseOrder> =>
  useAtomSuspense(useCatalogReplica().atoms.openPurchaseOrders(limit)).value;

export const useSuspensePurchaseOrder = (orderId: string): PurchaseOrder | undefined =>
  useAtomSuspense(useCatalogReplica().atoms.purchaseOrderDetail(orderId)).value.order;

export const useSuspensePurchaseOrderDeliveries = (orderId: string): ReadonlyArray<StockMovement> =>
  useAtomSuspense(useCatalogReplica().atoms.purchaseOrderDetail(orderId)).value.deliveries;

export const useSuspensePurchaseOrderCount = (tab: PurchaseOrderTab): number =>
  useAtomSuspense(useCatalogReplica().atoms.purchaseOrderCount(tab)).value;

export const useSuspenseSupplierCount = (): number =>
  useAtomSuspense(useCatalogReplica().atoms.supplierCount).value;

const NO_PRODUCTS_ON_ORDER: ReadonlyMap<string, ProductOnOrder> = new Map();

const NO_LEARNED_SUPPLIERS: ReadonlyMap<string, SupplierId> = new Map();

const useLatest = <A, E>(result: AsyncResult.AsyncResult<A, E>, empty: A) => {
  const latest = useLatestSuccess(result);
  return {
    data: Option.getOrElse(latest, () => empty),
    isLoading: Option.isNone(latest) && !AsyncResult.isFailure(result),
    isError: AsyncResult.isFailure(result),
  };
};

export const useProductsOnOrder = (productIds: ReadonlyArray<string>) =>
  useLatest(
    useAtomValue(useCatalogReplica().atoms.productsOnOrder(productIds)),
    NO_PRODUCTS_ON_ORDER,
  );

export const useSuspenseProductOnOrder = (productId: string): ProductOnOrder =>
  useAtomSuspense(useCatalogReplica().atoms.productsOnOrder([productId])).value.get(productId) ??
  NOTHING_ON_ORDER;

export const useLearnedSuppliers = (productIds: ReadonlyArray<string>) =>
  useLatest(
    useAtomValue(useCatalogReplica().atoms.learnedSuppliers(productIds)),
    NO_LEARNED_SUPPLIERS,
  );

export type PurchasingGate =
  | { readonly blocked: false }
  | { readonly blocked: true; readonly message: string };

const PURCHASING_OPEN: PurchasingGate = { blocked: false };

const PURCHASING_BLOCKED: PurchasingGate = {
  blocked: true,
  message: staleReplicaRejection(null).message,
};

const purchasingGateOf = (
  authority: ReplicaAuthority,
  lowestActiveSchemaVersion: number | null,
): PurchasingGate => {
  switch (authority) {
    case "local":
      return PURCHASING_OPEN;
    case "remote":
      return purchasingBlockedByStaleReplica(lowestActiveSchemaVersion ?? undefined)
        ? PURCHASING_BLOCKED
        : PURCHASING_OPEN;
  }
};

export const usePurchasingGate = (): PurchasingGate =>
  purchasingGateOf(
    useCatalogReplica().authority,
    useInventorySyncActivity().lowestActiveSchemaVersion,
  );
