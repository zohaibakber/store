import {
  readLearnedSuppliers,
  readOpenOrderLines,
  type InventorySubsetSummarySpec,
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

const statusIn = (statuses: ReadonlyArray<PurchaseOrderStatus>): SubsetPredicate => ({
  _tag: "in",
  column: "status",
  values: statuses,
});

export const countPurchaseOrders = (
  reader: ReplicaSummaryReader,
  tab: PurchaseOrderTab,
): Effect.Effect<number, WorkspaceReadFailure> => {
  const spec: InventorySubsetSummarySpec = {
    source: "purchaseOrders",
    where: statusIn(purchaseOrderTabStatuses(tab)),
    distinct: [],
  };
  return Effect.tryPromise({ try: () => reader.summarizeSubset(spec), catch: readFailure }).pipe(
    Effect.map((read) => read.summary.count),
    Effect.withSpan("Purchasing.countOrders"),
  );
};
