import type { Invoice, InvoiceItem } from "@store/contracts";
import { formatInvoiceNumber } from "@store/contracts/store-helpers";

import { formatCount, formatDateTime } from "../format";

export const invoiceTitle = (invoiceNumber: number) =>
  `Invoice ${formatInvoiceNumber(invoiceNumber)}`;

export const itemCountLabel = (count: number) =>
  `${formatCount(count)} ${count === 1 ? "item" : "items"}`;

export const invoiceSubtitle = (invoice: Pick<Invoice, "createdAt" | "customerName" | "items">) =>
  [
    formatDateTime(invoice.createdAt),
    itemCountLabel(invoice.items.length),
    invoice.customerName?.trim(),
  ]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");

const quantityUnit = (item: Pick<InvoiceItem, "quantity" | "quantityType">) => {
  if (item.quantityType === "pack") return item.quantity === 1 ? "pack" : "packs";
  return item.quantity === 1 ? "unit" : "units";
};

export const invoiceItemQuantity = (item: Pick<InvoiceItem, "quantity" | "quantityType">) =>
  `${formatCount(item.quantity)} ${quantityUnit(item)}`;
