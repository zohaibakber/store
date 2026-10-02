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

export const MAX_CATALOG_NAME_LENGTH = 200;

const CatalogName = Schema.NonEmptyString.check(Schema.isMaxLength(MAX_CATALOG_NAME_LENGTH));

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

const upsertWrite = <const Entity extends string, Id extends Schema.Top, Row extends Schema.Top>(
  entity: Entity,
  id: Id,
  row: Row,
) =>
  Schema.Struct({
    entity: Schema.Literal(entity),
    action: Schema.Literal("upsert"),
    id,
    expectedRowVersion: Schema.NullOr(CatalogRowVersion),
    row,
  });

const deleteWrite = <const Entity extends string, Id extends Schema.Top>(entity: Entity, id: Id) =>
  Schema.Struct({
    entity: Schema.Literal(entity),
    action: Schema.Literal("delete"),
    id,
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

export const CatalogRowWrite = Schema.Union([
  upsertWrite("category", CategoryId, CategoryWriteFields),
  deleteWrite("category", CategoryId),
  upsertWrite("product", ProductId, ProductWriteFields),
  deleteWrite("product", ProductId),
  BatchUpsertWrite,
  deleteWrite("batch", BatchId),
  upsertWrite("supplier", SupplierId, SupplierWriteFields),
  deleteWrite("supplier", SupplierId),
  upsertWrite("purchaseOrder", PurchaseOrderId, PurchaseOrderWriteFields),
  deleteWrite("purchaseOrder", PurchaseOrderId),
  upsertWrite("purchaseOrderItem", PurchaseOrderItemId, PurchaseOrderItemWriteFields),
  deleteWrite("purchaseOrderItem", PurchaseOrderItemId),
]);
export type CatalogRowWrite = typeof CatalogRowWrite.Type;

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
