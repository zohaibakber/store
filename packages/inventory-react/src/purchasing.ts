import {
  decodePurchaseOrderSqliteRows,
  MAX_IN_VALUES,
  readLearnedSuppliers,
  readOpenOrderLines,
  type OpenOrderLines,
  type PurchaseOrderItemRow,
  type PurchaseOrderRow,
  type ReplicaSubsetReader,
  type ReplicaSummaryReader,
  type SubsetPredicate,
} from "@store/client-db";
import {
  isPurchaseOrderOpen,
  purchaseOrderLineRemaining,
  type PurchaseOrderStatus,
  type SupplierId,
} from "@store/contracts";
import * as Effect from "effect/Effect";

import { WorkspaceReadFailure } from "./errors";
import { allOf, countRows, readPageIds, type ListPage } from "./list-page";

export const PURCHASE_ORDER_TABS = ["open", "drafts", "closed"] as const;
export type PurchaseOrderTab = (typeof PURCHASE_ORDER_TABS)[number];

export const purchaseOrderTabStatuses = (
  tab: PurchaseOrderTab,
): ReadonlyArray<PurchaseOrderStatus> => {
  switch (tab) {
    case "open":
      return ["sent"];
    case "drafts":
      return ["draft"];
    case "closed":
      return ["closed", "cancelled"];
  }
};

export type ProductOrderLine = {
  readonly orderId: PurchaseOrderRow["id"];
  readonly orderNumber: number;
  readonly supplierId: SupplierId;
  readonly status: PurchaseOrderStatus;
  readonly sentAt: number | null;
  readonly expectedAt: number | null;
  readonly lineId: PurchaseOrderItemRow["id"];
  readonly quantity: number;
  readonly quantityType: PurchaseOrderItemRow["quantityType"];
  readonly orderedBaseUnits: number;
  readonly receivedBaseUnits: number;
  readonly remainingBaseUnits: number;
};

export type ProductOnOrder = {
  readonly onOrderBaseUnits: number;
  readonly lines: ReadonlyArray<ProductOrderLine>;
};

export const NOTHING_ON_ORDER: ProductOnOrder = { onOrderBaseUnits: 0, lines: [] };

export const productsOnOrder = (read: OpenOrderLines): ReadonlyMap<string, ProductOnOrder> => {
  const openOrders = new Map(
    read.orders
      .filter((order) => isPurchaseOrderOpen(order.status))
      .map((order) => [order.id, order]),
  );
  const byProduct = new Map<string, Array<ProductOrderLine>>();
  for (const line of read.lines) {
    const order = openOrders.get(line.purchaseOrderId);
    if (order === undefined) continue;
    const entry: ProductOrderLine = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      supplierId: order.supplierId,
      status: order.status,
      sentAt: order.sentAt,
      expectedAt: order.expectedAt,
      lineId: line.id,
      quantity: line.quantity,
      quantityType: line.quantityType,
      orderedBaseUnits: line.baseUnitQuantity,
      receivedBaseUnits: line.receivedBaseUnits,
      remainingBaseUnits: purchaseOrderLineRemaining(line),
    };
    const lines = byProduct.get(line.productId);
    if (lines) lines.push(entry);
    else byProduct.set(line.productId, [entry]);
  }
  return new Map(
    [...byProduct].map(([productId, lines]) => [
      productId,
      {
        onOrderBaseUnits: lines.reduce((sum, line) => sum + line.remainingBaseUnits, 0),
        lines: lines.sort(
          (left, right) =>
            left.orderNumber - right.orderNumber || left.lineId.localeCompare(right.lineId),
        ),
      },
    ]),
  );
};

const readFailure = () =>
  new WorkspaceReadFailure({ message: "Could not read purchase orders on this device." });

export const readProductsOnOrder = (
  reader: ReplicaSubsetReader,
  productIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, ProductOnOrder>, WorkspaceReadFailure> =>
  Effect.tryPromise({ try: () => readOpenOrderLines(reader, productIds), catch: readFailure }).pipe(
    Effect.map(productsOnOrder),
    Effect.withSpan("Purchasing.readProductsOnOrder"),
  );

export const readLearnedSupplierIds = (
  reader: ReplicaSubsetReader,
  productIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, SupplierId>, WorkspaceReadFailure> =>
  Effect.tryPromise({
    try: () => readLearnedSuppliers(reader, productIds),
    catch: readFailure,
  }).pipe(Effect.withSpan("Purchasing.readLearnedSuppliers"));

export const PURCHASE_ORDER_SORT_COLUMNS = ["createdAt", "orderNumber"] as const;
export type PurchaseOrderSortColumn = (typeof PURCHASE_ORDER_SORT_COLUMNS)[number];

export type PurchaseOrderListFilters = {
  readonly tab: PurchaseOrderTab;
  readonly supplierIds?: ReadonlyArray<string>;
};

export type PurchaseOrderListRequest = ListPage<PurchaseOrderSortColumn> & {
  readonly filters: PurchaseOrderListFilters;
};

const statusIs = (statuses: ReadonlyArray<PurchaseOrderStatus>): SubsetPredicate => {
  const [only, ...others] = statuses;
  return only !== undefined && others.length === 0
    ? { _tag: "compare", column: "status", op: "eq", value: only }
    : { _tag: "in", column: "status", values: statuses };
};

const supplierIn = (supplierIds: ReadonlyArray<string>): SubsetPredicate => {
  const chunks = Array.from({ length: Math.ceil(supplierIds.length / MAX_IN_VALUES) }, (_, index) =>
    supplierIds.slice(index * MAX_IN_VALUES, (index + 1) * MAX_IN_VALUES),
  ).map((values): SubsetPredicate => ({ _tag: "in", column: "supplierId", values }));
  const [only, ...others] = chunks;
  if (only === undefined) return { _tag: "in", column: "supplierId", values: [] };
  return others.length === 0 ? only : { _tag: "or", predicates: chunks };
};

const purchaseOrderListWhere = (filters: PurchaseOrderListFilters): SubsetPredicate | undefined =>
  allOf([
    statusIs(purchaseOrderTabStatuses(filters.tab)),
    ...(filters.supplierIds === undefined ? [] : [supplierIn(filters.supplierIds)]),
  ]);

export const readPurchaseOrderPageIds = (
  reader: ReplicaSubsetReader,
  request: PurchaseOrderListRequest,
): Effect.Effect<ReadonlyArray<string>, WorkspaceReadFailure> =>
  readPageIds(
    reader,
    "purchaseOrders",
    purchaseOrderListWhere(request.filters),
    request,
    decodePurchaseOrderSqliteRows,
    readFailure,
  ).pipe(Effect.withSpan("Purchasing.readOrderPage"));

export const countPurchaseOrders = (
  reader: ReplicaSummaryReader,
  filters: PurchaseOrderListFilters,
): Effect.Effect<number, WorkspaceReadFailure> =>
  countRows(reader, "purchaseOrders", purchaseOrderListWhere(filters), readFailure).pipe(
    Effect.withSpan("Purchasing.countOrders"),
  );

export const countSuppliers = (
  reader: ReplicaSummaryReader,
): Effect.Effect<number, WorkspaceReadFailure> =>
  countRows(reader, "suppliers", undefined, readFailure).pipe(
    Effect.withSpan("Purchasing.countSuppliers"),
  );
