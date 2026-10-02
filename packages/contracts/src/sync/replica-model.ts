import * as Schema from "effect/Schema";

import {
  CategoryRow,
  ProductRow,
  BatchRow,
  InvoiceRow,
  InvoiceItemRow,
  StockMovementRow,
  SupplierRow,
  PurchaseOrderRow,
  PurchaseOrderItemRow,
  syncEntityRows,
  type SyncEntityRow,
} from "./entity-rows";
import { SyncEntity } from "./schema";

export const ReplicaCategoryRow = CategoryRow;
export type ReplicaCategoryRow = SyncEntityRow<"category">;

export const ReplicaProductRow = ProductRow;
export type ReplicaProductRow = SyncEntityRow<"product">;

export const ReplicaBatchRow = BatchRow;
export type ReplicaBatchRow = SyncEntityRow<"batch">;

export const ReplicaInvoiceRow = InvoiceRow;
export type ReplicaInvoiceRow = SyncEntityRow<"invoice">;

export const ReplicaInvoiceItemRow = InvoiceItemRow;
export type ReplicaInvoiceItemRow = SyncEntityRow<"invoiceItem">;

export const ReplicaStockMovementRow = StockMovementRow;
export type ReplicaStockMovementRow = SyncEntityRow<"stockMovement">;

export const ReplicaSupplierRow = SupplierRow;
export type ReplicaSupplierRow = SyncEntityRow<"supplier">;

export const ReplicaPurchaseOrderRow = PurchaseOrderRow;
export type ReplicaPurchaseOrderRow = SyncEntityRow<"purchaseOrder">;

export const ReplicaPurchaseOrderItemRow = PurchaseOrderItemRow;
export type ReplicaPurchaseOrderItemRow = SyncEntityRow<"purchaseOrderItem">;

export const replicaEntitySchemas = {
  category: ReplicaCategoryRow,
  product: ReplicaProductRow,
  batch: ReplicaBatchRow,
  invoice: ReplicaInvoiceRow,
  invoiceItem: ReplicaInvoiceItemRow,
  stockMovement: ReplicaStockMovementRow,
  supplier: ReplicaSupplierRow,
  purchaseOrder: ReplicaPurchaseOrderRow,
  purchaseOrderItem: ReplicaPurchaseOrderItemRow,
} as const satisfies Record<SyncEntity, (typeof syncEntityRows)[SyncEntity]["schema"]>;

export const CommandStatus = Schema.Literals([
  "pending",
  "sending",
  "accepted_awaiting_integration",
  "integrated",
  "rejected",
]);
export type CommandStatus = typeof CommandStatus.Type;

export const ReplicaReadStamp = Schema.Struct({
  generationId: Schema.NonEmptyString,
  localCommitVersion: Schema.Natural,
});
export type ReplicaReadStamp = typeof ReplicaReadStamp.Type;

export const ReplicaCommitNotice = Schema.Struct({
  databaseIdentity: Schema.NonEmptyString,
  generationId: Schema.NonEmptyString,
  localCommitVersion: Schema.Natural,
  touchedEntities: Schema.Array(SyncEntity),
  touchedKeys: Schema.Array(Schema.String),
  fullInvalidation: Schema.optionalKey(Schema.Boolean),
  overflowedEntities: Schema.optionalKey(Schema.Array(SyncEntity)),
});
export type ReplicaCommitNotice = typeof ReplicaCommitNotice.Type;

export type Committed<A> = {
  readonly value: A;
  readonly notice: ReplicaCommitNotice | undefined;
};
