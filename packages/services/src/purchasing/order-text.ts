import type { PurchaseOrder, PurchaseOrderItem, Supplier } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";

import { formatPrice } from "../format";

type PurchaseOrderTextLine = Pick<
  PurchaseOrderItem,
  "productName" | "quantity" | "quantityType" | "packCost"
>;

type PurchaseOrderTextFormat = {
  readonly date: (value: number) => string;
  readonly quantity: (line: Pick<PurchaseOrderItem, "quantity" | "quantityType">) => string;
};

type PurchaseOrderTextInput = {
  readonly storeName: string | null;
  readonly order: Pick<
    PurchaseOrder,
    "orderNumber" | "createdAt" | "expectedAt" | "note" | "total"
  >;
  readonly lines: ReadonlyArray<PurchaseOrderTextLine>;
  readonly supplier: Pick<Supplier, "name"> | undefined;
  readonly format: PurchaseOrderTextFormat;
};

const present = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const purchaseOrderCostTotal = (
  order: Pick<PurchaseOrder, "total">,
  lines: ReadonlyArray<Pick<PurchaseOrderItem, "packCost">>,
): number | null =>
  lines.length > 0 && lines.every((line) => line.packCost !== null) ? order.total : null;

const headerLines = ({ storeName, order, supplier, format }: PurchaseOrderTextInput) => {
  const store = present(storeName);
  const to = present(supplier?.name);
  return [
    `Purchase order #${formatInvoiceNumber(order.orderNumber)}`,
    ...(store === null ? [] : [`From: ${store}`]),
    ...(to === null ? [] : [`To: ${to}`]),
    `Date: ${format.date(order.createdAt)}`,
    ...(order.expectedAt === null ? [] : [`Expected: ${format.date(order.expectedAt)}`]),
  ];
};

const numberedLine = (
  line: PurchaseOrderTextLine,
  index: number,
  format: PurchaseOrderTextFormat,
) => {
  const cost = line.packCost === null ? "" : ` @ ${formatPrice(line.packCost)} per pack`;
  return `${index + 1}. ${line.productName.trim()} - ${format.quantity(line)}${cost}`;
};

export const purchaseOrderText = (input: PurchaseOrderTextInput): string => {
  const total = purchaseOrderCostTotal(input.order, input.lines);
  const note = present(input.order.note);
  const sections = [
    headerLines(input),
    input.lines.map((line, index) => numberedLine(line, index, input.format)),
    ...(total === null ? [] : [[`Total: ${formatPrice(total)}`]]),
    ...(note === null ? [] : [[`Note: ${note}`]]),
  ];
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
};
