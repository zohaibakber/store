import * as Schema from "effect/Schema";

import { BatchId, CategoryId, ProductId } from "../ids";
import { PositiveInt, SyncIdentifier } from "../schema-primitives";

export const MAX_CATALOG_WRITE_ROWS = 1_000;

const CatalogName = Schema.NonEmptyString.check(Schema.isMaxLength(200));

export const CatalogRowVersion = PositiveInt;
export type CatalogRowVersion = typeof CatalogRowVersion.Type;

export const CategoryWriteFields = Schema.Struct({
  name: CatalogName,
  tracksPacks: Schema.Boolean,
});
export type CategoryWriteFields = typeof CategoryWriteFields.Type;

export const ProductWriteFields = Schema.Struct({
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
export type ProductWriteFields = typeof ProductWriteFields.Type;

export const BatchWriteFields = Schema.Struct({
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(PositiveInt),
  packQuantity: Schema.Natural,
  unitQuantity: Schema.Natural,
});
export type BatchWriteFields = typeof BatchWriteFields.Type;

export const CategoryUpsertWrite = Schema.Struct({
  entity: Schema.Literal("category"),
  action: Schema.Literal("upsert"),
  id: CategoryId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: CategoryWriteFields,
});
export type CategoryUpsertWrite = typeof CategoryUpsertWrite.Type;

export const CategoryDeleteWrite = Schema.Struct({
  entity: Schema.Literal("category"),
  action: Schema.Literal("delete"),
  id: CategoryId,
  expectedRowVersion: CatalogRowVersion,
});
export type CategoryDeleteWrite = typeof CategoryDeleteWrite.Type;

export const ProductUpsertWrite = Schema.Struct({
  entity: Schema.Literal("product"),
  action: Schema.Literal("upsert"),
  id: ProductId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  row: ProductWriteFields,
});
export type ProductUpsertWrite = typeof ProductUpsertWrite.Type;

export const ProductDeleteWrite = Schema.Struct({
  entity: Schema.Literal("product"),
  action: Schema.Literal("delete"),
  id: ProductId,
  expectedRowVersion: CatalogRowVersion,
});
export type ProductDeleteWrite = typeof ProductDeleteWrite.Type;

export const BatchUpsertWrite = Schema.Struct({
  entity: Schema.Literal("batch"),
  action: Schema.Literal("upsert"),
  id: BatchId,
  expectedRowVersion: Schema.NullOr(CatalogRowVersion),
  movementId: SyncIdentifier,
  note: Schema.NullOr(Schema.String.check(Schema.isMaxLength(500))),
  row: BatchWriteFields,
});
export type BatchUpsertWrite = typeof BatchUpsertWrite.Type;

export const BatchDeleteWrite = Schema.Struct({
  entity: Schema.Literal("batch"),
  action: Schema.Literal("delete"),
  id: BatchId,
  expectedRowVersion: CatalogRowVersion,
});
export type BatchDeleteWrite = typeof BatchDeleteWrite.Type;

export const CatalogRowWrite = Schema.Union([
  CategoryUpsertWrite,
  CategoryDeleteWrite,
  ProductUpsertWrite,
  ProductDeleteWrite,
  BatchUpsertWrite,
  BatchDeleteWrite,
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

export const catalogWriteGuardedByRowVersion = (write: CatalogRowWrite): boolean =>
  write.action === "delete" || write.entity === "batch";
