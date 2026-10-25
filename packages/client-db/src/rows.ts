import { PositiveInt } from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import {
  BatchId,
  CategoryId,
  InvoiceId,
  InvoiceItemId,
  ProductId,
  PurchaseOrderId,
} from "@store/contracts/ids";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

const mutableEntityFields = {
  id: NonEmptyString,
  organizationId: NonEmptyString,
  createdByUserId: NonEmptyString,
  updatedByUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  rowVersion: PositiveInt,
  createdAt: Schema.Natural,
  updatedAt: Schema.Natural,
};

export const CategoryRow = Schema.Struct({
  ...mutableEntityFields,
  id: CategoryId,
  name: NonEmptyString,
  tracksPacks: Schema.Boolean,
});
export type CategoryRow = typeof CategoryRow.Type;

export const ProductRow = Schema.Struct({
  ...mutableEntityFields,
  id: ProductId,
  name: NonEmptyString,
  categoryId: CategoryId,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: PositiveInt,
  purchasePrice: Schema.NullOr(Schema.Natural),
  retailPrice: Schema.NullOr(Schema.Natural),
  unitPrice: Schema.NullOr(Schema.Natural),
  visible: Schema.Boolean,
});
export type ProductRow = typeof ProductRow.Type;

export const BatchRow = Schema.Struct({
  ...mutableEntityFields,
  id: BatchId,
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Natural),
  packQuantity: Schema.Natural,
  unitQuantity: Schema.Natural,
});
export type BatchRow = typeof BatchRow.Type;

export const InvoiceRow = Schema.Struct({
  ...mutableEntityFields,
  id: InvoiceId,
  invoiceNumber: PositiveInt,
  customerName: Schema.NullOr(Schema.String),
  total: Schema.Natural,
});
export type InvoiceRow = typeof InvoiceRow.Type;

export const InvoiceItemRow = Schema.Struct({
  ...mutableEntityFields,
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
  productName: NonEmptyString,
  batchNumber: Schema.NullOr(Schema.String),
  quantity: PositiveInt,
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: PositiveInt,
  salePrice: Schema.Natural,
});
export type InvoiceItemRow = typeof InvoiceItemRow.Type;

export const StockMovementRow = Schema.Struct({
  id: NonEmptyString,
  productId: ProductId,
  batchId: BatchId,
  invoiceId: Schema.NullOr(InvoiceId),
  purchaseOrderId: Schema.NullOr(PurchaseOrderId).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: Schema.Int,
  unitDelta: Schema.Int,
  note: Schema.NullOr(Schema.String),
  organizationId: NonEmptyString,
  actorUserId: NonEmptyString,
  deviceId: NonEmptyString,
  operationId: NonEmptyString,
  createdAt: Schema.Natural,
});
export type StockMovementRow = typeof StockMovementRow.Type;

export const SupplierRow = syncEntityRows.supplier.schema;
export type SupplierRow = SyncEntityRow<"supplier">;

export const PurchaseOrderRow = syncEntityRows.purchaseOrder.schema;
export type PurchaseOrderRow = SyncEntityRow<"purchaseOrder">;

export const PurchaseOrderItemRow = syncEntityRows.purchaseOrderItem.schema;
export type PurchaseOrderItemRow = SyncEntityRow<"purchaseOrderItem">;
