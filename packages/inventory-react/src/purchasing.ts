import type { PurchaseOrderItemRow, PurchaseOrderRow } from "@store/client-db";
import {
  isPurchaseOrderOpen,
  purchaseOrderLineRemaining,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type StockMovement,
  type SupplierId,
} from "@store/contracts";

import type { ListPage, PurchaseOrderSortColumn, PurchaseOrderTab } from "./list-request";

type ProductOrderLine = {
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

type OpenOrderLines = {
  readonly orders: ReadonlyArray<PurchaseOrderRow>;
  readonly lines: ReadonlyArray<PurchaseOrderItemRow>;
};

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

export type PurchaseOrderListFilters = {
  readonly tab: PurchaseOrderTab;
  readonly supplierIds?: ReadonlyArray<string>;
};

export type PurchaseOrderListRequest = ListPage<PurchaseOrderSortColumn> & {
  readonly filters: PurchaseOrderListFilters;
};

export type PurchaseOrderDetail = {
  readonly order: PurchaseOrder | undefined;
  readonly deliveries: ReadonlyArray<StockMovement>;
};
