import {
  purchaseOrderLineTotal,
  purchaseOrderProgress,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseOrderProgress,
  type Supplier,
} from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";

import type { Tone } from "@/components/insights/presentation";
import { formatCount } from "@/lib/format";

export const PROGRESS_META = {
  draft: { label: "Draft", tone: "secondary", hint: "Not sent to the supplier yet" },
  sent: { label: "Sent", tone: "info", hint: "Waiting for the delivery" },
  partlyReceived: { label: "Partly received", tone: "warning", hint: "Some lines are still due" },
  received: { label: "Received", tone: "success", hint: "Every line has arrived" },
  closed: { label: "Closed", tone: "secondary", hint: "Finished; no more deliveries" },
  cancelled: { label: "Cancelled", tone: "error", hint: "Cancelled before it was completed" },
} satisfies Record<
  PurchaseOrderProgress,
  { readonly label: string; readonly tone: Tone; readonly hint: string }
>;

export const PROGRESS_RANK = {
  draft: 0,
  sent: 1,
  partlyReceived: 2,
  received: 3,
  closed: 4,
  cancelled: 5,
} satisfies Record<PurchaseOrderProgress, number>;

export const formatOrderNumber = (orderNumber: number) => `#${formatInvoiceNumber(orderNumber)}`;

export const orderProgress = (order: Pick<PurchaseOrder, "status" | "items">) =>
  purchaseOrderProgress(order.status, order.items);

type LineQuantity = Pick<PurchaseOrderItem, "quantity" | "quantityType">;

export const quantityNoun = (quantityType: LineQuantity["quantityType"]) => {
  switch (quantityType) {
    case "pack":
      return "pack";
    case "unit":
      return "unit";
  }
};

export const formatLineQuantity = (line: LineQuantity) =>
  formatCount(line.quantity, quantityNoun(line.quantityType));

export const byProductName = (
  left: Pick<PurchaseOrderItem, "id" | "productName">,
  right: Pick<PurchaseOrderItem, "id" | "productName">,
) => left.productName.localeCompare(right.productName) || left.id.localeCompare(right.id);

export const orderUnits = (
  items: ReadonlyArray<Pick<PurchaseOrderItem, "baseUnitQuantity" | "receivedBaseUnits">>,
) =>
  items.reduce(
    (sum, item) => ({
      ordered: sum.ordered + item.baseUnitQuantity,
      received: sum.received + item.receivedBaseUnits,
    }),
    { ordered: 0, received: 0 },
  );

export const supplierNamesOf = (suppliers: ReadonlyArray<Supplier>): ReadonlyMap<string, string> =>
  new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));

export const UNKNOWN_SUPPLIER = "Unknown supplier";

export type DraftLine = {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly quantityType: LineQuantity["quantityType"];
  readonly unitsPerPack: number;
  readonly tracksPacks: boolean;
  readonly packCost: number | null;
};

export const draftLineCost = (
  line: Pick<DraftLine, "quantityType" | "unitsPerPack" | "packCost">,
  quantity: number,
) =>
  purchaseOrderLineTotal(
    { quantity, quantityType: line.quantityType, packCost: line.packCost },
    line.unitsPerPack,
  );
