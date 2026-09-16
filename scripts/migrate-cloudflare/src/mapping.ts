import { canonicalJson } from "@store/contracts/canonical-json";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { casesHandled } from "./cases.ts";
import { TranslationFailed } from "./errors.ts";
import { checksumValue } from "./hash.ts";
import {
  type BusinessTable,
  type DriverRow,
  type OrganizationAggregates,
  type PostgresBatch,
  type PostgresCategory,
  type PostgresInvoice,
  type PostgresInvoiceItem,
  type PostgresProduct,
  type PostgresStockMovement,
  PostgresBatch as PostgresBatchSchema,
  PostgresCategory as PostgresCategorySchema,
  PostgresInvoice as PostgresInvoiceSchema,
  PostgresInvoiceItem as PostgresInvoiceItemSchema,
  PostgresProduct as PostgresProductSchema,
  PostgresStockMovement as PostgresStockMovementSchema,
  type Sha256Hex,
  type SqliteBatch,
  type SqliteBusinessRow,
  type SqliteCategory,
  type SqliteFlag,
  type SqliteInvoice,
  type SqliteInvoiceItem,
  type SqliteProduct,
  type SqliteStockMovement,
  SqliteBatch as SqliteBatchSchema,
  SqliteCategory as SqliteCategorySchema,
  SqliteInvoice as SqliteInvoiceSchema,
  SqliteInvoiceItem as SqliteInvoiceItemSchema,
  SqliteProduct as SqliteProductSchema,
  SqliteStockMovement as SqliteStockMovementSchema,
} from "./model.ts";

export const sqliteFlag = (value: boolean): SqliteFlag => (value ? 1 : 0);

export const translateCategory = (row: PostgresCategory): SqliteCategory =>
  SqliteCategorySchema.make({
    id: row.id,
    name: row.name,
    tracksPacks: sqliteFlag(row.tracksPacks),
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    deviceId: row.deviceId,
    operationId: row.operationId,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

export const translateProduct = (row: PostgresProduct): SqliteProduct =>
  SqliteProductSchema.make({
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    aisle: row.aisle,
    composition: row.composition,
    strength: row.strength,
    unitsPerPack: row.unitsPerPack,
    purchasePrice: row.purchasePrice,
    retailPrice: row.retailPrice,
    unitPrice: row.unitPrice,
    visible: sqliteFlag(row.visible),
    organizationId: row.organizationId,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    deviceId: row.deviceId,
    operationId: row.operationId,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

export const translateBatch = (row: PostgresBatch): SqliteBatch => SqliteBatchSchema.make(row);

export const translateInvoice = (row: PostgresInvoice): SqliteInvoice =>
  SqliteInvoiceSchema.make(row);

export const translateInvoiceItem = (row: PostgresInvoiceItem): SqliteInvoiceItem =>
  SqliteInvoiceItemSchema.make(row);

export const translateStockMovement = (row: PostgresStockMovement): SqliteStockMovement =>
  SqliteStockMovementSchema.make(row);

const parseDriverRow = (
  table: BusinessTable,
  row: DriverRow,
): Effect.Effect<SqliteBusinessRow, TranslationFailed> =>
  Effect.gen(function* () {
    const decodeError = (cause: unknown) =>
      new TranslationFailed({
        table,
        message: `PostgreSQL ${table} row failed typed translation.`,
        cause,
      });
    switch (table) {
      case "categories":
        return translateCategory(
          yield* Schema.decodeUnknownEffect(PostgresCategorySchema)(row).pipe(
            Effect.mapError(decodeError),
          ),
        );
      case "products":
        return translateProduct(
          yield* Schema.decodeUnknownEffect(PostgresProductSchema)(row).pipe(
            Effect.mapError(decodeError),
          ),
        );
      case "batches":
        return translateBatch(
          yield* Schema.decodeUnknownEffect(PostgresBatchSchema)(row).pipe(
            Effect.mapError(decodeError),
          ),
        );
      case "invoices":
        return translateInvoice(
          yield* Schema.decodeUnknownEffect(PostgresInvoiceSchema)(row).pipe(
            Effect.mapError(decodeError),
          ),
        );
      case "invoice_items":
        return translateInvoiceItem(
          yield* Schema.decodeUnknownEffect(PostgresInvoiceItemSchema)(row).pipe(
            Effect.mapError(decodeError),
          ),
        );
      case "stock_movements":
        return translateStockMovement(
          yield* Schema.decodeUnknownEffect(PostgresStockMovementSchema)(row).pipe(
            Effect.mapError(decodeError),
          ),
        );
      default:
        return casesHandled(table);
    }
  });

export const translateDriverRows = (
  table: BusinessTable,
  rows: ReadonlyArray<DriverRow>,
): Effect.Effect<ReadonlyArray<SqliteBusinessRow>, TranslationFailed> =>
  Effect.forEach(rows, (row) => parseDriverRow(table, row));

export const rowsChecksum = (rows: ReadonlyArray<SqliteBusinessRow>): Sha256Hex =>
  checksumValue(rows);

export const encodeRowsJson = (rows: ReadonlyArray<SqliteBusinessRow>): string => {
  const encoded = canonicalJson(rows);
  return encoded === undefined ? "[]" : encoded;
};

export const decodeChunkRows = (
  table: BusinessTable,
  rowsJson: string,
): Effect.Effect<ReadonlyArray<SqliteBusinessRow>, TranslationFailed> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rowsJson);
  } catch (cause) {
    return Effect.fail(
      new TranslationFailed({
        table,
        message: `Chunk JSON for ${table} is not valid JSON.`,
        cause,
      }),
    );
  }
  const schemaForTable = () => {
    switch (table) {
      case "categories":
        return Schema.Array(SqliteCategorySchema);
      case "products":
        return Schema.Array(SqliteProductSchema);
      case "batches":
        return Schema.Array(SqliteBatchSchema);
      case "invoices":
        return Schema.Array(SqliteInvoiceSchema);
      case "invoice_items":
        return Schema.Array(SqliteInvoiceItemSchema);
      case "stock_movements":
        return Schema.Array(SqliteStockMovementSchema);
      default:
        return casesHandled(table);
    }
  };
  return Schema.decodeUnknownEffect(schemaForTable())(parsed).pipe(
    Effect.mapError(
      (cause) =>
        new TranslationFailed({
          table,
          message: `Chunk rows for ${table} failed SQLite schema checks.`,
          cause,
        }),
    ),
  );
};

export const emptyAggregates = (): OrganizationAggregates => ({
  invoiceTotalSum: 0,
  batchPackQuantitySum: 0,
  batchUnitQuantitySum: 0,
  movementPackDeltaSum: 0,
  movementUnitDeltaSum: 0,
});

export const addAggregate = (
  current: OrganizationAggregates,
  table: BusinessTable,
  rows: ReadonlyArray<SqliteBusinessRow>,
): OrganizationAggregates => {
  switch (table) {
    case "invoices":
      return {
        invoiceTotalSum: rows
          .filter(Schema.is(SqliteInvoiceSchema))
          .reduce((sum, row) => sum + row.total, current.invoiceTotalSum),
        batchPackQuantitySum: current.batchPackQuantitySum,
        batchUnitQuantitySum: current.batchUnitQuantitySum,
        movementPackDeltaSum: current.movementPackDeltaSum,
        movementUnitDeltaSum: current.movementUnitDeltaSum,
      };
    case "batches":
      return {
        invoiceTotalSum: current.invoiceTotalSum,
        batchPackQuantitySum: rows
          .filter(Schema.is(SqliteBatchSchema))
          .reduce((sum, row) => sum + row.packQuantity, current.batchPackQuantitySum),
        batchUnitQuantitySum: rows
          .filter(Schema.is(SqliteBatchSchema))
          .reduce((sum, row) => sum + row.unitQuantity, current.batchUnitQuantitySum),
        movementPackDeltaSum: current.movementPackDeltaSum,
        movementUnitDeltaSum: current.movementUnitDeltaSum,
      };
    case "stock_movements":
      return {
        invoiceTotalSum: current.invoiceTotalSum,
        batchPackQuantitySum: current.batchPackQuantitySum,
        batchUnitQuantitySum: current.batchUnitQuantitySum,
        movementPackDeltaSum: rows
          .filter(Schema.is(SqliteStockMovementSchema))
          .reduce((sum, row) => sum + row.packDelta, current.movementPackDeltaSum),
        movementUnitDeltaSum: rows
          .filter(Schema.is(SqliteStockMovementSchema))
          .reduce((sum, row) => sum + row.unitDelta, current.movementUnitDeltaSum),
      };
    case "categories":
    case "products":
    case "invoice_items":
      return current;
    default:
      return casesHandled(table);
  }
};
