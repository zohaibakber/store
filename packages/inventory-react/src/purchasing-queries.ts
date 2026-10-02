import { useAtomSuspense, useAtomValue } from "@effect/atom-react";
import type { PurchaseOrderItemRow, PurchaseOrderRow, SupplierRow } from "@store/client-db";
import {
  OPEN_PURCHASE_ORDER_STATUSES,
  purchasingBlockedByStaleReplica,
  staleReplicaRejection,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type StockMovement,
  type Supplier,
  type SupplierId,
} from "@store/contracts";
import {
  eq,
  inArray,
  toArray,
  useLiveSuspenseQuery,
  type InitialQueryBuilder,
  type Ref,
} from "@tanstack/react-db";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as React from "react";

import type { ReplicaAuthority } from "./host";
import { inPageOrder } from "./list-page";
import type { PurchaseOrderTab } from "./list-request";
import { sharedLiveQuery } from "./live-collection";
import { useCatalogReplica, useInventorySyncActivity } from "./provider";
import {
  NOTHING_ON_ORDER,
  type ProductOnOrder,
  type PurchaseOrderListFilters,
  type PurchaseOrderListRequest,
} from "./purchasing";
import { HISTORY_PAGE_SIZE, inAnyOf, stockMovementFields, useLatestSuccess } from "./queries";
import type { Inventory } from "./types";

const supplierFields = (supplier: Ref<SupplierRow>) => ({
  id: supplier.id,
  name: supplier.name,
  phone: supplier.phone,
  note: supplier.note,
  organizationId: supplier.organizationId,
  createdByUserId: supplier.createdByUserId,
  updatedByUserId: supplier.updatedByUserId,
  deviceId: supplier.deviceId,
  operationId: supplier.operationId,
  rowVersion: supplier.rowVersion,
  createdAt: supplier.createdAt,
  updatedAt: supplier.updatedAt,
});

const purchaseOrderItemFields = (item: Ref<PurchaseOrderItemRow>) => ({
  id: item.id,
  purchaseOrderId: item.purchaseOrderId,
  productId: item.productId,
  productName: item.productName,
  quantity: item.quantity,
  quantityType: item.quantityType,
  baseUnitQuantity: item.baseUnitQuantity,
  packCost: item.packCost,
  receivedBaseUnits: item.receivedBaseUnits,
  organizationId: item.organizationId,
  createdByUserId: item.createdByUserId,
  updatedByUserId: item.updatedByUserId,
  deviceId: item.deviceId,
  operationId: item.operationId,
  rowVersion: item.rowVersion,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const purchaseOrderFields = (
  query: InitialQueryBuilder,
  inventory: Pick<Inventory, "purchaseOrderItems">,
  order: Ref<PurchaseOrderRow>,
) => ({
  id: order.id,
  orderNumber: order.orderNumber,
  supplierId: order.supplierId,
  status: order.status,
  note: order.note,
  sentAt: order.sentAt,
  expectedAt: order.expectedAt,
  total: order.total,
  organizationId: order.organizationId,
  createdByUserId: order.createdByUserId,
  updatedByUserId: order.updatedByUserId,
  deviceId: order.deviceId,
  operationId: order.operationId,
  rowVersion: order.rowVersion,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
  items: toArray(
    query
      .from({ item: inventory.purchaseOrderItems })
      .where(({ item }) => eq(item.purchaseOrderId, order.id))
      .select(({ item }) => purchaseOrderItemFields(item)),
  ),
});

const hasStatus = (order: Ref<PurchaseOrderRow>, statuses: ReadonlyArray<PurchaseOrderStatus>) => {
  const [only, ...others] = statuses;
  return only !== undefined && others.length === 0
    ? eq(order.status, only)
    : inArray(order.status, [...statuses]);
};

const suppliersQuery = (inventory: Inventory) => (query: InitialQueryBuilder) =>
  query
    .from({ supplier: inventory.suppliers })
    .orderBy(({ supplier }) => supplier.name, { direction: "asc", stringSort: "locale" })
    .select(({ supplier }) => supplierFields(supplier));

const purchaseOrdersQuery =
  (inventory: Inventory, statuses: ReadonlyArray<PurchaseOrderStatus>) =>
  (query: InitialQueryBuilder) =>
    query
      .from({ order: inventory.purchaseOrders })
      .where(({ order }) => hasStatus(order, statuses))
      .orderBy(({ order }) => order.createdAt, "desc")
      .select(({ order }) => purchaseOrderFields(query, inventory, order));

const purchaseOrdersByIdQuery =
  (inventory: Inventory, orderIds: ReadonlyArray<string>) => (query: InitialQueryBuilder) =>
    query
      .from({ order: inventory.purchaseOrders })
      .where(({ order }) => inAnyOf(order.id, orderIds))
      .select(({ order }) => purchaseOrderFields(query, inventory, order));

const purchaseOrderQuery =
  (inventory: Inventory, orderId: string) => (query: InitialQueryBuilder) =>
    query
      .from({ order: inventory.purchaseOrders })
      .where(({ order }) => eq(order.id, orderId))
      .select(({ order }) => purchaseOrderFields(query, inventory, order))
      .findOne();

const purchaseOrderDeliveriesQuery =
  (inventory: Inventory, orderId: string) => (query: InitialQueryBuilder) =>
    query
      .from({ movement: inventory.stockMovements })
      .where(({ movement }) => eq(movement.purchaseOrderId, orderId))
      .orderBy(({ movement }) => movement.createdAt, "desc")
      .select(({ movement }) => stockMovementFields(movement));

const openPurchaseOrdersQuery =
  (inventory: Inventory, limit: number) => (query: InitialQueryBuilder) =>
    purchaseOrdersQuery(inventory, OPEN_PURCHASE_ORDER_STATUSES)(query).limit(limit);

export const liveSuppliers = sharedLiveQuery(suppliersQuery);

export const livePurchaseOrdersById = sharedLiveQuery(purchaseOrdersByIdQuery);

const liveOpenPurchaseOrders = sharedLiveQuery(openPurchaseOrdersQuery);

export const livePurchaseOrder = sharedLiveQuery(purchaseOrderQuery);

export const livePurchaseOrderDeliveries = sharedLiveQuery(purchaseOrderDeliveriesQuery);

export const useSuspenseSuppliers = (): ReadonlyArray<Supplier> =>
  useLiveSuspenseQuery(liveSuppliers(useCatalogReplica())).data;

export const useSuspensePurchaseOrderPage = (
  request: PurchaseOrderListRequest,
): ReadonlyArray<PurchaseOrder> => {
  const inventory = useCatalogReplica();
  const ids = React.useDeferredValue(
    useAtomSuspense(inventory.atoms.purchaseOrderPage(request)).value,
  );
  const orders: ReadonlyArray<PurchaseOrder> = useLiveSuspenseQuery(
    livePurchaseOrdersById(inventory, ids),
  ).data;
  return React.useMemo(() => inPageOrder(ids, orders), [ids, orders]);
};

export const useSuspensePurchaseOrderListCount = (filters: PurchaseOrderListFilters): number =>
  React.useDeferredValue(
    useAtomSuspense(useCatalogReplica().atoms.purchaseOrderListCount(filters)).value,
  );

export const useSuspenseOpenPurchaseOrders = (
  limit = HISTORY_PAGE_SIZE,
): ReadonlyArray<PurchaseOrder> =>
  useLiveSuspenseQuery(liveOpenPurchaseOrders(useCatalogReplica(), limit)).data;

export const useSuspensePurchaseOrder = (orderId: string): PurchaseOrder | undefined =>
  useLiveSuspenseQuery(livePurchaseOrder(useCatalogReplica(), orderId)).data;

export const useSuspensePurchaseOrderDeliveries = (orderId: string): ReadonlyArray<StockMovement> =>
  useLiveSuspenseQuery(livePurchaseOrderDeliveries(useCatalogReplica(), orderId)).data;

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
