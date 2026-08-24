import * as Schema from "effect/Schema";

import { BatchId, CategoryId, InvoiceId, InvoiceItemId, ProductId } from "../ids";

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

export const LegacyInvoiceMigrationRow = Schema.Struct({
  id: InvoiceId,
  invoiceNumber: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  customerName: Schema.NullOr(Schema.String),
  total: NonNegativeInteger,
  ...rowTimestamps,
});
export type LegacyInvoiceMigrationRow = typeof LegacyInvoiceMigrationRow.Type;

export const LegacyInvoiceItemMigrationRow = Schema.Struct({
  id: InvoiceItemId,
  invoiceId: InvoiceId,
  productId: ProductId,
  batchId: BatchId,
  productName: Schema.String.check(Schema.isMinLength(1)),
  batchNumber: Schema.NullOr(Schema.String),
  quantity: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  quantityType: Schema.Literals(["unit", "pack"]),
  baseUnitQuantity: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  salePrice: NonNegativeInteger,
  ...rowTimestamps,
});
export type LegacyInvoiceItemMigrationRow = typeof LegacyInvoiceItemMigrationRow.Type;

export const LegacyStockMovementMigrationRow = Schema.Struct({
  id: Identifier,
  productId: ProductId,
  batchId: BatchId,
  invoiceId: Schema.NullOr(InvoiceId),
  type: Schema.Literals(["stock_in", "sale", "open_pack", "adjustment"]),
  packDelta: Schema.Number.check(Schema.isInt()),
  unitDelta: Schema.Number.check(Schema.isInt()),
  note: Schema.NullOr(Schema.String),
  createdAt: Timestamp,
});
export type LegacyStockMovementMigrationRow = typeof LegacyStockMovementMigrationRow.Type;

export const MAX_LEGACY_MIGRATION_ROWS = 250;

export const legacyCatalogRowOperationId = (
  kind: LegacyCatalogMigrationCommand["kind"],
  rowId: string,
) => `legacy-row:v1:${kind}:${rowId}`;

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
  Schema.Struct({
    kind: Schema.Literal("invoices"),
    rows: Schema.Array(LegacyInvoiceMigrationRow).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_ROWS),
    ),
    ...commandFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("invoice-items"),
    rows: Schema.Array(LegacyInvoiceItemMigrationRow).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_ROWS),
    ),
    ...commandFields,
  }),
  Schema.Struct({
    kind: Schema.Literal("stock-movements"),
    rows: Schema.Array(LegacyStockMovementMigrationRow).check(
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

export const LegacyCatalogReconciliationCommand = Schema.Struct({
  deviceId: Identifier,
  occurredAt: PositiveTimestamp,
  categoryIds: Schema.Array(CategoryId).check(Schema.isMaxLength(5_000)),
  productIds: Schema.Array(ProductId).check(Schema.isMaxLength(5_000)),
  batchIds: Schema.Array(BatchId).check(Schema.isMaxLength(5_000)),
  invoiceIds: Schema.Array(InvoiceId).check(Schema.isMaxLength(5_000)),
  invoiceItemIds: Schema.Array(InvoiceItemId).check(Schema.isMaxLength(5_000)),
  stockMovementIds: Schema.Array(Identifier).check(Schema.isMaxLength(5_000)),
});
export type LegacyCatalogReconciliationCommand = typeof LegacyCatalogReconciliationCommand.Type;

export const LegacyCatalogReconciliationResult = Schema.Struct({
  deletedCategories: NonNegativeInteger,
  deletedProducts: NonNegativeInteger,
  deletedBatches: NonNegativeInteger,
  deletedInvoices: NonNegativeInteger,
  deletedInvoiceItems: NonNegativeInteger,
  deletedStockMovements: NonNegativeInteger,
  txid: PositiveTimestamp,
});
export type LegacyCatalogReconciliationResult = typeof LegacyCatalogReconciliationResult.Type;
