import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";

export const CategoryRow = syncEntityRows.category.schema;
export type CategoryRow = SyncEntityRow<"category">;

export const ProductRow = syncEntityRows.product.schema;
export type ProductRow = SyncEntityRow<"product">;

export const BatchRow = syncEntityRows.batch.schema;
export type BatchRow = SyncEntityRow<"batch">;

export const InvoiceRow = syncEntityRows.invoice.schema;
export type InvoiceRow = SyncEntityRow<"invoice">;

export const InvoiceItemRow = syncEntityRows.invoiceItem.schema;
export type InvoiceItemRow = SyncEntityRow<"invoiceItem">;

export const StockMovementRow = syncEntityRows.stockMovement.schema;
export type StockMovementRow = SyncEntityRow<"stockMovement">;

export const SupplierRow = syncEntityRows.supplier.schema;
export type SupplierRow = SyncEntityRow<"supplier">;

export const PurchaseOrderRow = syncEntityRows.purchaseOrder.schema;
export type PurchaseOrderRow = SyncEntityRow<"purchaseOrder">;

export const PurchaseOrderItemRow = syncEntityRows.purchaseOrderItem.schema;
export type PurchaseOrderItemRow = SyncEntityRow<"purchaseOrderItem">;
