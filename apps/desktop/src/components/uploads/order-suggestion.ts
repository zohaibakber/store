import {
  formatInvoiceNumber,
  purchaseOrderLineRemaining,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type Supplier,
} from "@store/contracts";

import { parseExpiryDate } from "@/lib/format";
import type { ReceiveDeliveryLineInput } from "@/lib/inventory";

import type { ProposedChange } from "./context";

const MIN_PARTIAL_NAME_LENGTH = 4;

const MAX_INVOICE_REFERENCE_LENGTH = 64;

const canonicalName = (name: string) =>
  name
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const single = <Value>(values: ReadonlyArray<Value>): Value | undefined =>
  values.length === 1 ? values[0] : undefined;

export const matchSupplier = (
  name: string | null,
  suppliers: ReadonlyArray<Supplier>,
): Supplier | undefined => {
  const wanted = canonicalName(name ?? "");
  if (wanted === "") return undefined;
  const exact = suppliers.filter((supplier) => canonicalName(supplier.name) === wanted);
  if (exact.length > 0) return single(exact);
  if (wanted.length < MIN_PARTIAL_NAME_LENGTH) return undefined;
  return single(
    suppliers.filter((supplier) => {
      const known = canonicalName(supplier.name);
      return (
        known.length >= MIN_PARTIAL_NAME_LENGTH &&
        (wanted.includes(known) || known.includes(wanted))
      );
    }),
  );
};

export type OrderMatchLine = {
  readonly change: ProposedChange;
  readonly item: PurchaseOrderItem;
};

export type OrderMatch = {
  readonly order: PurchaseOrder;
  readonly lines: ReadonlyArray<OrderMatchLine>;
};

const lineFor = (order: PurchaseOrder, productId: string): PurchaseOrderItem | undefined => {
  const items = order.items.filter((item) => item.productId === productId);
  return items.find((item) => purchaseOrderLineRemaining(item) > 0) ?? items[0];
};

const statusRank = (order: PurchaseOrder) => (order.status === "sent" ? 0 : 1);

export const matchOrders = (
  changes: ReadonlyArray<ProposedChange>,
  orders: ReadonlyArray<PurchaseOrder>,
  supplier: Supplier | undefined,
): ReadonlyArray<OrderMatch> =>
  orders
    .filter((order) => supplier === undefined || order.supplierId === supplier.id)
    .map((order) => ({
      order,
      lines: changes.flatMap((change) => {
        const item = change.productId === undefined ? undefined : lineFor(order, change.productId);
        return item === undefined ? [] : [{ change, item }];
      }),
    }))
    .filter((match) => match.lines.length > 0)
    .sort(
      (left, right) =>
        right.lines.length - left.lines.length ||
        statusRank(left.order) - statusRank(right.order) ||
        right.order.createdAt - left.order.createdAt,
    );

export const receivePrefillOf = (match: OrderMatch): ReadonlyArray<ReceiveDeliveryLineInput> =>
  match.lines.map(({ change, item }) => ({
    purchaseOrderItemId: item.id,
    batchNumber: change.batchNumber,
    expiresAt: parseExpiryDate(change.expiresAt),
    packQuantity: change.packQuantity,
    unitQuantity: change.unitQuantity,
    ...(change.packPrice === null ? null : { purchasePrice: change.packPrice }),
  }));

export const deliveryNoteOf = (
  orderNumber: number,
  invoiceNumber: string | null,
): string | null => {
  const reference = invoiceNumber?.trim().slice(0, MAX_INVOICE_REFERENCE_LENGTH);
  return reference
    ? `Purchase order #${formatInvoiceNumber(orderNumber)} · Invoice ${reference}`
    : null;
};
