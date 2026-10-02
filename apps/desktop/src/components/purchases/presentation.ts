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
import type { PurchaseOrderSortColumn, PurchaseOrderTab } from "@/lib/inventory";

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

export const supplierIdsMatching = (
  suppliers: ReadonlyArray<Pick<Supplier, "id" | "name">>,
  term: string | undefined,
): ReadonlyArray<string> | undefined => {
  const wanted = (term ?? "").trim().toLowerCase();
  if (wanted === "") return undefined;
  return suppliers
    .filter((supplier) => supplier.name.toLowerCase().includes(wanted))
    .map((supplier) => supplier.id)
    .sort();
};

export const PURCHASE_ORDER_PAGE_SIZES = [25, 50, 100] as const;
export type PurchaseOrderPageSize = (typeof PURCHASE_ORDER_PAGE_SIZES)[number];

export type PurchaseOrderListView = {
  readonly tab: PurchaseOrderTab;
  readonly q?: string;
  readonly sort: PurchaseOrderSortColumn;
  readonly desc: boolean;
  readonly page: number;
  readonly size: PurchaseOrderPageSize;
};

export const DEFAULT_PURCHASE_ORDER_LIST_VIEW: PurchaseOrderListView = {
  tab: "open",
  sort: "createdAt",
  desc: true,
  page: 0,
  size: 50,
};

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
