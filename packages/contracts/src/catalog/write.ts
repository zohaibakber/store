import * as Schema from "effect/Schema";

import {
  BatchId,
  CategoryId,
  ProductId,
  PurchaseOrderId,
  PurchaseOrderItemId,
  SupplierId,
} from "../ids";
import { PositiveInt, SyncIdentifier } from "../schema-primitives";
import { PURCHASE_ORDER_QUANTITY_TYPES, PURCHASE_ORDER_STATUSES } from "./purchasing";

export const MAX_CATALOG_WRITE_ROWS = 1_000;

const CatalogName = Schema.NonEmptyString.check(Schema.isMaxLength(200));

const CatalogNote = Schema.String.check(Schema.isMaxLength(500));

const CatalogRowVersion = PositiveInt;

export const SupplierPhone = Schema.String.check(Schema.isPattern(/^[0-9]{1,20}$/u));

export const PurchaseOrderStatus = Schema.Literals(PURCHASE_ORDER_STATUSES);
export type PurchaseOrderStatus = typeof PurchaseOrderStatus.Type;

export const PurchaseOrderQuantityType = Schema.Literals(PURCHASE_ORDER_QUANTITY_TYPES);
export type PurchaseOrderQuantityType = typeof PurchaseOrderQuantityType.Type;

const CategoryWriteFields = Schema.Struct({
  name: CatalogName,
  tracksPacks: Schema.Boolean,
});

const ProductWriteFields = Schema.Struct({
  name: CatalogName,
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

const BatchWriteFields = Schema.Struct({
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(PositiveInt),
  packQuantity: Schema.Natural,
  unitQuantity: Schema.Natural,
});

const SupplierWriteFields = Schema.Struct({
  name: CatalogName,
  phone: Schema.NullOr(SupplierPhone),
  note: Schema.NullOr(CatalogNote),
});

const PurchaseOrderWriteFields = Schema.Struct({
  orderNumber: PositiveInt,
  supplierId: SupplierId,
  status: PurchaseOrderStatus,
  note: Schema.NullOr(CatalogNote),
  sentAt: Schema.NullOr(PositiveInt),
  expectedAt: Schema.NullOr(PositiveInt),
  total: Schema.Natural,
});

const PurchaseOrderItemWriteFields = Schema.Struct({
  purchaseOrderId: PurchaseOrderId,
  productId: ProductId,
  productName: CatalogName,
  quantity: PositiveInt,
  quantityType: PurchaseOrderQuantityType,
  baseUnitQuantity: PositiveInt,
  packCost: Schema.NullOr(Schema.Natural),
});

const BatchReceipt = Schema.Struct({
  purchaseOrderItemId: PurchaseOrderItemId,
});

const CategoryUpsertWrite = Schema.Struct({
  entity: Schema.Literal("category"),
  action: Schema.Literal("upsert"),
  id: CategoryId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: CategoryWriteFields,
});
type CategoryUpsertWrite = typeof CategoryUpsertWrite.Type;

const CategoryDeleteWrite = Schema.Struct({
  entity: Schema.Literal("category"),
  action: Schema.Literal("delete"),
  id: CategoryId,
  expectedRowVersion: CatalogRowVersion,
});

const ProductUpsertWrite = Schema.Struct({
  entity: Schema.Literal("product"),
  action: Schema.Literal("upsert"),
  id: ProductId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: ProductWriteFields,
});
type ProductUpsertWrite = typeof ProductUpsertWrite.Type;

const ProductDeleteWrite = Schema.Struct({
  entity: Schema.Literal("product"),
  action: Schema.Literal("delete"),
  id: ProductId,
  expectedRowVersion: CatalogRowVersion,
});

const BatchUpsertWrite = Schema.Struct({
  entity: Schema.Literal("batch"),
  action: Schema.Literal("upsert"),
  id: BatchId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  movementId: SyncIdentifier,
  note: Schema.NullOr(CatalogNote),
  row: BatchWriteFields,
  receipt: Schema.optionalKey(BatchReceipt),
});
type BatchUpsertWrite = typeof BatchUpsertWrite.Type;

const BatchDeleteWrite = Schema.Struct({
  entity: Schema.Literal("batch"),
  action: Schema.Literal("delete"),
  id: BatchId,
  expectedRowVersion: CatalogRowVersion,
});

const SupplierUpsertWrite = Schema.Struct({
  entity: Schema.Literal("supplier"),
  action: Schema.Literal("upsert"),
  id: SupplierId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: SupplierWriteFields,
});
type SupplierUpsertWrite = typeof SupplierUpsertWrite.Type;

const SupplierDeleteWrite = Schema.Struct({
  entity: Schema.Literal("supplier"),
  action: Schema.Literal("delete"),
  id: SupplierId,
  expectedRowVersion: CatalogRowVersion,
});

const PurchaseOrderUpsertWrite = Schema.Struct({
  entity: Schema.Literal("purchaseOrder"),
  action: Schema.Literal("upsert"),
  id: PurchaseOrderId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: PurchaseOrderWriteFields,
});
type PurchaseOrderUpsertWrite = typeof PurchaseOrderUpsertWrite.Type;

const PurchaseOrderDeleteWrite = Schema.Struct({
  entity: Schema.Literal("purchaseOrder"),
  action: Schema.Literal("delete"),
  id: PurchaseOrderId,
  expectedRowVersion: CatalogRowVersion,
});

const PurchaseOrderItemUpsertWrite = Schema.Struct({
  entity: Schema.Literal("purchaseOrderItem"),
  action: Schema.Literal("upsert"),
  id: PurchaseOrderItemId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: PurchaseOrderItemWriteFields,
});
type PurchaseOrderItemUpsertWrite = typeof PurchaseOrderItemUpsertWrite.Type;

const PurchaseOrderItemDeleteWrite = Schema.Struct({
  entity: Schema.Literal("purchaseOrderItem"),
  action: Schema.Literal("delete"),
  id: PurchaseOrderItemId,
  expectedRowVersion: CatalogRowVersion,
});

export const CatalogRowWrite = Schema.Union([
  CategoryUpsertWrite,
  CategoryDeleteWrite,
  ProductUpsertWrite,
  ProductDeleteWrite,
  BatchUpsertWrite,
  BatchDeleteWrite,
  SupplierUpsertWrite,
  SupplierDeleteWrite,
  PurchaseOrderUpsertWrite,
  PurchaseOrderDeleteWrite,
  PurchaseOrderItemUpsertWrite,
  PurchaseOrderItemDeleteWrite,
]);
export type CatalogRowWrite = typeof CatalogRowWrite.Type;

export const isPurchasingWrite = (write: CatalogRowWrite): boolean => {
  switch (write.entity) {
    case "supplier":
    case "purchaseOrder":
    case "purchaseOrderItem":
      return true;
    case "batch":
      return write.action === "upsert" && write.receipt !== undefined;
    case "category":
    case "product":
      return false;
  }
};

export const CatalogWriteCommand = Schema.Struct({
  commandId: SyncIdentifier,
  deviceId: SyncIdentifier,
  occurredAt: PositiveInt,
  writes: Schema.Array(CatalogRowWrite).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_CATALOG_WRITE_ROWS),
  ),
});
export type CatalogWriteCommand = typeof CatalogWriteCommand.Type;
