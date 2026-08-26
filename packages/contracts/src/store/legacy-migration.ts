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
export const MAX_LEGACY_MIGRATION_TABLE_ROWS = 5_000;
/** Queue-consumer write size. Keep each Neon transaction inside the Worker CPU budget. */
export const LEGACY_MIGRATION_CHUNK_ROWS = 10;

export const LEGACY_ROW_OPERATION_PREFIX = "legacy-row:v1:";

export const legacyCatalogRowOperationId = (
  kind: LegacyCatalogMigrationCommand["kind"],
  rowId: string,
) => `${LEGACY_ROW_OPERATION_PREFIX}${kind}:${rowId}`;

export const chunkLegacyMigrationRows = <Value>(
  rows: ReadonlyArray<Value>,
  size: number = LEGACY_MIGRATION_CHUNK_ROWS,
): ReadonlyArray<ReadonlyArray<Value>> => {
  const chunks: Array<ReadonlyArray<Value>> = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

export const partitionLegacyMigrationRows = <Row extends { readonly id: string }>(
  kind: LegacyCatalogMigrationCommand["kind"],
  rows: ReadonlyArray<Row>,
  existingOperationIds: ReadonlySet<string>,
) => {
  // Client-side helper only. The API must still upsert rows when a receipt
  // exists: receipts can survive a rolled-back catalog write.
  const pending: Row[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (existingOperationIds.has(legacyCatalogRowOperationId(kind, row.id))) skipped += 1;
    else pending.push(row);
  }
  return { pending, skipped };
};

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

export const LegacyCatalogMigrationData = Schema.Struct({
  categories: Schema.Array(LegacyCategoryMigrationRow).check(
    Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
  ),
  products: Schema.Array(LegacyProductMigrationRow).check(
    Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
  ),
  batches: Schema.Array(LegacyBatchMigrationRow).check(
    Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
  ),
  invoices: Schema.Array(LegacyInvoiceMigrationRow).check(
    Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
  ),
  invoiceItems: Schema.Array(LegacyInvoiceItemMigrationRow).check(
    Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
  ),
  stockMovements: Schema.Array(LegacyStockMovementMigrationRow).check(
    Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
  ),
});
export type LegacyCatalogMigrationData = typeof LegacyCatalogMigrationData.Type;

export const LegacyCatalogMigrationStart = Schema.Struct({
  requestId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(250)),
  deviceId: Identifier,
  occurredAt: PositiveTimestamp,
  catalog: LegacyCatalogMigrationData,
});
export type LegacyCatalogMigrationStart = typeof LegacyCatalogMigrationStart.Type;

/** HTTP ingest only. Per-row schema runs later, 10 rows at a time, in the queue. */
export const LegacyCatalogMigrationStartRequest = Schema.Struct({
  requestId: LegacyCatalogMigrationStart.fields.requestId,
  deviceId: LegacyCatalogMigrationStart.fields.deviceId,
  occurredAt: LegacyCatalogMigrationStart.fields.occurredAt,
  catalog: Schema.Struct({
    categories: Schema.Array(Schema.Unknown).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
    ),
    products: Schema.Array(Schema.Unknown).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
    ),
    batches: Schema.Array(Schema.Unknown).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
    ),
    invoices: Schema.Array(Schema.Unknown).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
    ),
    invoiceItems: Schema.Array(Schema.Unknown).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
    ),
    stockMovements: Schema.Array(Schema.Unknown).check(
      Schema.isMaxLength(MAX_LEGACY_MIGRATION_TABLE_ROWS),
    ),
  }),
});
export type LegacyCatalogMigrationStartRequest = typeof LegacyCatalogMigrationStartRequest.Type;

export const LegacyCatalogMigrationStarted = Schema.Struct({
  jobId: Identifier,
});
export type LegacyCatalogMigrationStarted = typeof LegacyCatalogMigrationStarted.Type;

export const LegacyCatalogMigrationPhase = Schema.Literals([
  "queued",
  "categories",
  "products",
  "batches",
  "invoices",
  "invoice-items",
  "stock-movements",
  "reconcile",
  "complete",
]);
export type LegacyCatalogMigrationPhase = typeof LegacyCatalogMigrationPhase.Type;

const jobProgressFields = {
  jobId: Identifier,
  processedRows: NonNegativeInteger,
  totalRows: NonNegativeInteger,
  importedRows: NonNegativeInteger,
  skippedRows: NonNegativeInteger,
  progress: NonNegativeInteger.check(Schema.isLessThanOrEqualTo(100)),
};

export const LegacyCatalogMigrationJobStatus = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("queued"),
    phase: Schema.Literal("queued"),
    ...jobProgressFields,
  }),
  Schema.Struct({
    status: Schema.Literal("migrating"),
    phase: LegacyCatalogMigrationPhase,
    ...jobProgressFields,
  }),
  Schema.Struct({
    status: Schema.Literal("succeeded"),
    phase: Schema.Literal("complete"),
    ...jobProgressFields,
  }),
  Schema.Struct({
    status: Schema.Literal("failed"),
    phase: LegacyCatalogMigrationPhase,
    error: Schema.String.check(Schema.isMinLength(1)),
    ...jobProgressFields,
  }),
]);
export type LegacyCatalogMigrationJobStatus = typeof LegacyCatalogMigrationJobStatus.Type;

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
