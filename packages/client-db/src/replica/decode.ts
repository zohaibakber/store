import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "../rows";
import { ReplicaRowInvalid } from "./errors";
import type { InventoryCollectionSource } from "./sources";
import type { SqliteResultRow } from "./sqlite-row";

const sqliteBooleanFields = (row: SqliteResultRow, keys: ReadonlyArray<string>) => {
  const flagged = new Set(keys);
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (flagged.has(key) && (value === 0 || value === 1)) return [key, value === 1];
      return [key, value];
    }),
  );
};

const rowInvalid =
  (source: InventoryCollectionSource) =>
  (error: Schema.SchemaError): ReplicaRowInvalid =>
    new ReplicaRowInvalid({
      message: error.message,
      source,
    });

const decodeSqliteRow = <A>(
  source: InventoryCollectionSource,
  schema: Schema.Decoder<A>,
  row: SqliteResultRow,
  booleanFields: ReadonlyArray<string>,
): Effect.Effect<A, ReplicaRowInvalid> =>
  Schema.decodeUnknownEffect(schema)(sqliteBooleanFields(row, booleanFields)).pipe(
    Effect.mapError(rowInvalid(source)),
  );

export const decodeCategorySqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<CategoryRow, ReplicaRowInvalid> =>
  decodeSqliteRow("categories", CategoryRow, row, ["tracksPacks"]);

export const decodeProductSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<ProductRow, ReplicaRowInvalid> =>
  decodeSqliteRow("products", ProductRow, row, ["visible"]);

export const decodeBatchSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<BatchRow, ReplicaRowInvalid> => decodeSqliteRow("batches", BatchRow, row, []);

export const decodeInvoiceSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<InvoiceRow, ReplicaRowInvalid> => decodeSqliteRow("invoices", InvoiceRow, row, []);

export const decodeInvoiceItemSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<InvoiceItemRow, ReplicaRowInvalid> =>
  decodeSqliteRow("invoiceItems", InvoiceItemRow, row, []);

export const decodeStockMovementSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<StockMovementRow, ReplicaRowInvalid> =>
  decodeSqliteRow("stockMovements", StockMovementRow, row, []);

const decodeAll = <Row>(
  rows: ReadonlyArray<SqliteResultRow>,
  decodeOne: (row: SqliteResultRow) => Effect.Effect<Row, ReplicaRowInvalid>,
): Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid> => Effect.forEach(rows, decodeOne);

export const decodeCategorySqliteRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): Effect.Effect<ReadonlyArray<CategoryRow>, ReplicaRowInvalid> =>
  decodeAll(rows, decodeCategorySqliteRow);

export const decodeProductSqliteRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): Effect.Effect<ReadonlyArray<ProductRow>, ReplicaRowInvalid> =>
  decodeAll(rows, decodeProductSqliteRow);

export const decodeBatchSqliteRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): Effect.Effect<ReadonlyArray<BatchRow>, ReplicaRowInvalid> =>
  decodeAll(rows, decodeBatchSqliteRow);

export const decodeInvoiceSqliteRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): Effect.Effect<ReadonlyArray<InvoiceRow>, ReplicaRowInvalid> =>
  decodeAll(rows, decodeInvoiceSqliteRow);

export const decodeInvoiceItemSqliteRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): Effect.Effect<ReadonlyArray<InvoiceItemRow>, ReplicaRowInvalid> =>
  decodeAll(rows, decodeInvoiceItemSqliteRow);

export const decodeStockMovementSqliteRows = (
  rows: ReadonlyArray<SqliteResultRow>,
): Effect.Effect<ReadonlyArray<StockMovementRow>, ReplicaRowInvalid> =>
  decodeAll(rows, decodeStockMovementSqliteRow);
