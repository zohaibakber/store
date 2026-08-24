import * as Schema from "effect/Schema";

import { BatchId, CategoryId, ProductId } from "../ids";

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200));
const Timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const PositiveTimestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const commandFields = {
  commandId: Identifier,
  deviceId: Identifier,
  occurredAt: PositiveTimestamp,
};

const rowTimestamps = {
  createdAt: Timestamp,
  updatedAt: Timestamp,
};

export const LegacyCategoryMigrationRow = Schema.Struct({
  id: CategoryId,
  name: Schema.String.check(Schema.isMinLength(1)),
  tracksPacks: Schema.Boolean,
  ...rowTimestamps,
});
export type LegacyCategoryMigrationRow = typeof LegacyCategoryMigrationRow.Type;

export const LegacyProductMigrationRow = Schema.Struct({
  id: ProductId,
  name: Schema.String.check(Schema.isMinLength(1)),
  categoryId: CategoryId,
  aisle: Schema.NullOr(Schema.String),
  composition: Schema.NullOr(Schema.String),
  strength: Schema.NullOr(Schema.String),
  unitsPerPack: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  packPrice: Schema.NullOr(NonNegativeInteger),
  unitPrice: Schema.NullOr(NonNegativeInteger),
  visible: Schema.Boolean,
  ...rowTimestamps,
});
export type LegacyProductMigrationRow = typeof LegacyProductMigrationRow.Type;

export const LegacyBatchMigrationRow = Schema.Struct({
  id: BatchId,
  productId: ProductId,
  batchNumber: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Timestamp),
  packQuantity: NonNegativeInteger,
  unitQuantity: NonNegativeInteger,
  ...rowTimestamps,
});
export type LegacyBatchMigrationRow = typeof LegacyBatchMigrationRow.Type;

export const MAX_LEGACY_MIGRATION_ROWS = 250;

export const LegacyCatalogMigrationCommand = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("categories"),
    rows: Schema.Array(LegacyCategoryMigrationRow).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_ROWS),
    ),
    ...commandFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("products"),
    rows: Schema.Array(LegacyProductMigrationRow).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_ROWS),
    ),
    ...commandFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("batches"),
    rows: Schema.Array(LegacyBatchMigrationRow).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_ROWS),
    ),
    ...commandFields,
  }),
]);
export type LegacyCatalogMigrationCommand = typeof LegacyCatalogMigrationCommand.Type;

export const LegacyCatalogMigrationResult = Schema.Struct({
  imported: NonNegativeInteger,
  skipped: NonNegativeInteger,
  txid: PositiveTimestamp,
});
export type LegacyCatalogMigrationResult = typeof LegacyCatalogMigrationResult.Type;
