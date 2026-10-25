import * as Result from "effect/Result";

import { baseUnitsOf } from "../store/stock";
import type { SyncProtocolCode } from "../sync/protocol";
import { CATALOG_REFUSALS, CatalogRefusal } from "./refusal";

export const PURCHASE_ORDER_STATUSES = ["draft", "sent", "closed", "cancelled"] as const;
type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_QUANTITY_TYPES = ["unit", "pack"] as const;
type PurchaseOrderQuantityType = (typeof PURCHASE_ORDER_QUANTITY_TYPES)[number];

const PURCHASING_SCHEMA_VERSION = 2;

export const ACTIVE_REPLICA_WINDOW_MILLIS = 14 * 24 * 60 * 60_000;

const purchaseOrderTransitions = {
  draft: ["sent", "cancelled"],
  sent: ["closed", "cancelled"],
  closed: [],
  cancelled: [],
} as const satisfies Record<PurchaseOrderStatus, ReadonlyArray<PurchaseOrderStatus>>;

export const isPurchaseOrderOpen = (status: PurchaseOrderStatus): boolean => {
  switch (status) {
    case "draft":
    case "sent":
      return true;
    case "closed":
    case "cancelled":
      return false;
  }
};

export const OPEN_PURCHASE_ORDER_STATUSES: ReadonlyArray<PurchaseOrderStatus> =
  PURCHASE_ORDER_STATUSES.filter(isPurchaseOrderOpen);

export const canCreatePurchaseOrderAs = (status: PurchaseOrderStatus): boolean =>
  status === "draft";

export const canMovePurchaseOrder = (
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean =>
  from === to
    ? isPurchaseOrderOpen(from)
    : purchaseOrderTransitions[from].some((next) => next === to);

type PurchaseOrderLineQuantity = {
  readonly quantity: number;
  readonly quantityType: PurchaseOrderQuantityType;
};

export const purchaseOrderLineBaseUnits = (
  line: PurchaseOrderLineQuantity,
  unitsPerPack: number,
): number => {
  switch (line.quantityType) {
    case "pack":
      return baseUnitsOf({ packQuantity: line.quantity, unitQuantity: 0 }, unitsPerPack);
    case "unit":
      return line.quantity;
  }
};

export const purchaseOrderLineTotal = (
  line: PurchaseOrderLineQuantity & { readonly packCost: number | null },
  unitsPerPack: number,
): number | null => {
  if (line.packCost === null) return null;
  switch (line.quantityType) {
    case "pack":
      return line.quantity * line.packCost;
    case "unit":
      return Math.round((line.quantity * line.packCost) / unitsPerPack);
  }
};

export const purchaseOrderTotal = (lineTotals: Iterable<number | null>): number => {
  let total = 0;
  for (const lineTotal of lineTotals) total += lineTotal ?? 0;
  return total;
};

export const receivedBaseUnitsOf = baseUnitsOf;

type PurchaseOrderLineReceipt = {
  readonly baseUnitQuantity: number;
  readonly receivedBaseUnits: number;
};

export const purchaseOrderLineRemaining = (line: PurchaseOrderLineReceipt): number =>
  Math.max(0, line.baseUnitQuantity - line.receivedBaseUnits);

const PURCHASE_ORDER_PROGRESSES = [
  "draft",
  "sent",
  "partlyReceived",
  "received",
  "closed",
  "cancelled",
] as const;
export type PurchaseOrderProgress = (typeof PURCHASE_ORDER_PROGRESSES)[number];

export const purchaseOrderProgress = (
  status: PurchaseOrderStatus,
  lines: Iterable<PurchaseOrderLineReceipt>,
): PurchaseOrderProgress => {
  switch (status) {
    case "closed":
    case "cancelled":
      return status;
    case "draft":
    case "sent": {
      let lineCount = 0;
      let touched = 0;
      let complete = 0;
      for (const line of lines) {
        lineCount += 1;
        if (line.receivedBaseUnits > 0) touched += 1;
        if (line.receivedBaseUnits >= line.baseUnitQuantity) complete += 1;
      }
      if (touched === 0) return status;
      return complete === lineCount ? "received" : "partlyReceived";
    }
  }
};

export const purchasingRejection = {
  supplierHasOrders: CATALOG_REFUSALS.supplierHasOrders,
  orderTransitionInvalid: CATALOG_REFUSALS.orderTransitionInvalid,
  orderNotOpen: CATALOG_REFUSALS.orderNotOpen,
  orderNotDraft: CATALOG_REFUSALS.orderNotDraft,
  orderHasItems: CATALOG_REFUSALS.orderHasItems,
  itemQuantityInvalid: {
    code: "PURCHASE_ORDER_ITEM_QUANTITY_INVALID",
    message: "The order line quantity does not match the product's units per pack.",
  },
  itemReceived: CATALOG_REFUSALS.itemReceived,
  receiptProductMismatch: {
    code: "PURCHASE_ORDER_RECEIPT_PRODUCT_MISMATCH",
    message: "The delivered batch is for a different product than the order line.",
  },
  receiptOnExistingBatch: {
    code: "INVALID_OPERATION",
    message: "A delivery can only be recorded when its batch is created.",
  },
} as const satisfies Record<string, { readonly code: SyncProtocolCode; readonly message: string }>;

export const staleReplicaRejection = (deviceLabel: string | null) =>
  ({
    code: "REPLICA_SCHEMA_OUTDATED",
    message: `Update Tabaaq on ${deviceLabel ?? "another device"} before using suppliers and purchase orders.`,
  }) as const satisfies { readonly code: SyncProtocolCode; readonly message: string };

export const purchasingBlockedByStaleReplica = (
  lowestActiveSchemaVersion: number | undefined,
): boolean =>
  lowestActiveSchemaVersion !== undefined && lowestActiveSchemaVersion < PURCHASING_SCHEMA_VERSION;

export const checkCanDeleteSupplier = (
  orders: Iterable<{ readonly supplierId: string }>,
  supplierId: string,
) =>
  Result.gen(function* () {
    for (const order of orders) {
      if (order.supplierId === supplierId) {
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "supplierHasOrders",
            message: purchasingRejection.supplierHasOrders.message,
          }),
        );
      }
    }
  });

export const checkCanCreateOrder = (status: PurchaseOrderStatus) =>
  Result.gen(function* () {
    if (!canCreatePurchaseOrderAs(status)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderTransitionInvalid",
          message: purchasingRejection.orderTransitionInvalid.message,
        }),
      );
    }
  });

export const checkOrderOpen = (status: PurchaseOrderStatus) =>
  Result.gen(function* () {
    if (!isPurchaseOrderOpen(status)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderNotOpen",
          message: purchasingRejection.orderNotOpen.message,
        }),
      );
    }
  });

export const checkCanMoveOrder = (
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
  invalidMessage: string = purchasingRejection.orderTransitionInvalid.message,
) =>
  Result.gen(function* () {
    yield* checkOrderOpen(from);
    if (!canMovePurchaseOrder(from, to)) {
      return yield* Result.fail(
        new CatalogRefusal({ reason: "orderTransitionInvalid", message: invalidMessage }),
      );
    }
  });

export const checkLineUnreceived = (line: { readonly receivedBaseUnits: number }) =>
  Result.gen(function* () {
    if (line.receivedBaseUnits > 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "itemReceived",
          message: purchasingRejection.itemReceived.message,
        }),
      );
    }
  });

export const checkCanDeleteOrder = (
  order: { readonly status: PurchaseOrderStatus },
  lineCount: number,
) =>
  Result.gen(function* () {
    if (order.status !== "draft") {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderNotDraft",
          message: purchasingRejection.orderNotDraft.message,
        }),
      );
    }
    if (lineCount > 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "orderHasItems",
          message: purchasingRejection.orderHasItems.message,
        }),
      );
    }
  });
