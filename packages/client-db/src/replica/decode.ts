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

const decodeRow = <A>(
  source: InventoryCollectionSource,
  decode: () => A,
): Effect.Effect<A, ReplicaRowInvalid> =>
  Effect.try({
    try: decode,
    catch: (cause) =>
      new ReplicaRowInvalid({
        message: cause instanceof Error ? cause.message : "Replica row is invalid.",
        source,
      }),
  });

export const decodeCategorySqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<CategoryRow, ReplicaRowInvalid> =>
  decodeRow("categories", () =>
    Schema.decodeUnknownSync(CategoryRow)(sqliteBooleanFields(row, ["tracksPacks"])),
  );

export const decodeProductSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<ProductRow, ReplicaRowInvalid> =>
  decodeRow("products", () =>
    Schema.decodeUnknownSync(ProductRow)(sqliteBooleanFields(row, ["visible"])),
  );

export const decodeBatchSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<BatchRow, ReplicaRowInvalid> =>
  decodeRow("batches", () => Schema.decodeUnknownSync(BatchRow)(sqliteBooleanFields(row, [])));

export const decodeInvoiceSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<InvoiceRow, ReplicaRowInvalid> =>
  decodeRow("invoices", () => Schema.decodeUnknownSync(InvoiceRow)(sqliteBooleanFields(row, [])));

export const decodeInvoiceItemSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<InvoiceItemRow, ReplicaRowInvalid> =>
  decodeRow("invoiceItems", () =>
    Schema.decodeUnknownSync(InvoiceItemRow)(sqliteBooleanFields(row, [])),
  );

export const decodeStockMovementSqliteRow = (
  row: SqliteResultRow,
): Effect.Effect<StockMovementRow, ReplicaRowInvalid> =>
  decodeRow("stockMovements", () =>
    Schema.decodeUnknownSync(StockMovementRow)(sqliteBooleanFields(row, [])),
  );

const decodeAll = <Row>(
  rows: ReadonlyArray<SqliteResultRow>,
  decodeOne: (row: SqliteResultRow) => Effect.Effect<Row, ReplicaRowInvalid>,
): Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid> =>
  Effect.gen(function* () {
    const decoded: Array<Row> = [];
    for (const row of rows) decoded.push(yield* decodeOne(row));
    return decoded;
  });

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
