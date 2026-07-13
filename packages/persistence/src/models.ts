import type { Batch, Category, Invoice, Product, StockMovement } from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/schema";

export type ProductRow = typeof products.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type BatchRow = typeof batches.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceItemRow = typeof invoiceItems.$inferSelect;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type ProductWithRelations = ProductRow & { category: CategoryRow; batches: BatchRow[] };
export type InvoiceWithItems = InvoiceRow & { items: InvoiceItemRow[] };

export const toCategory = ({ deletedAt: _deletedAt, ...category }: CategoryRow): Category =>
  category;

export const toBatch = ({ deletedAt: _deletedAt, ...batch }: BatchRow): Batch => batch;

export const toProduct = ({
  deletedAt: _deletedAt,
  category,
  batches: batchRows,
  ...product
}: ProductWithRelations): Product => ({
  ...product,
  category: toCategory(category),
  batches: batchRows.map(toBatch),
});

export const toInvoice = ({
  deletedAt: _deletedAt,
  items,
  ...invoice
}: InvoiceWithItems): Invoice => ({
  ...invoice,
  items: items.map(({ deletedAt: _itemDeletedAt, ...item }) => item),
});

export const toStockMovement = (movement: StockMovementRow): StockMovement => movement;

// Batches without an expiry date are drawn from last.
export const byEarliestExpiry = (left: BatchRow, right: BatchRow) =>
  (left.expiresAt ?? Number.POSITIVE_INFINITY) - (right.expiresAt ?? Number.POSITIVE_INFINITY) ||
  left.createdAt - right.createdAt;
