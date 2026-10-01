import type { SyncProtocolCode } from "../sync/protocol";

export const PURCHASE_ORDER_STATUSES = ["draft", "sent", "closed", "cancelled"] as const;
type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const PURCHASE_ORDER_QUANTITY_TYPES = ["unit", "pack"] as const;
type PurchaseOrderQuantityType = (typeof PURCHASE_ORDER_QUANTITY_TYPES)[number];

export const PURCHASING_SCHEMA_VERSION = 2;

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
      return line.quantity * unitsPerPack;
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

export const receivedBaseUnitsOf = (
  batch: { readonly packQuantity: number; readonly unitQuantity: number },
  unitsPerPack: number,
): number => batch.packQuantity * unitsPerPack + batch.unitQuantity;

type PurchaseOrderLineReceipt = {
  readonly baseUnitQuantity: number;
  readonly receivedBaseUnits: number;
};

export const purchaseOrderLineRemaining = (line: PurchaseOrderLineReceipt): number =>
  Math.max(0, line.baseUnitQuantity - line.receivedBaseUnits);

export const PURCHASE_ORDER_PROGRESSES = [
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
  supplierHasOrders: {
    code: "SUPPLIER_HAS_ORDERS",
    message: "This supplier has purchase orders and cannot be deleted.",
  },
  orderTransitionInvalid: {
    code: "PURCHASE_ORDER_TRANSITION_INVALID",
    message: "This purchase order cannot move to that status.",
  },
  orderNotOpen: {
    code: "PURCHASE_ORDER_NOT_OPEN",
    message: "This purchase order is closed or cancelled and can no longer change.",
  },
  orderNotDraft: {
    code: "PURCHASE_ORDER_NOT_DRAFT",
    message: "Only a draft purchase order can be deleted.",
  },
  orderHasItems: {
    code: "PURCHASE_ORDER_HAS_ITEMS",
    message: "Remove the lines from this purchase order before deleting it.",
  },
  itemQuantityInvalid: {
    code: "PURCHASE_ORDER_ITEM_QUANTITY_INVALID",
    message: "The order line quantity does not match the product's units per pack.",
  },
  itemReceived: {
    code: "PURCHASE_ORDER_ITEM_RECEIVED",
    message: "This order line has received stock and cannot be removed or moved.",
  },
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
    message: `Update Store on ${deviceLabel ?? "another device"} before using suppliers and purchase orders.`,
  }) as const satisfies { readonly code: SyncProtocolCode; readonly message: string };

export const purchasingBlockedByStaleReplica = (
  lowestActiveSchemaVersion: number | undefined,
): boolean =>
  lowestActiveSchemaVersion !== undefined && lowestActiveSchemaVersion < PURCHASING_SCHEMA_VERSION;
