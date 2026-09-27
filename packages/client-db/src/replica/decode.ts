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

const sqliteBooleanFields = (row: SqliteResultRow, flagged: ReadonlySet<string>) =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (flagged.has(key) && (value === 0 || value === 1)) return [key, value === 1];
      return [key, value];
    }),
  );

const sqliteRowsDecoder = <A>(
  source: InventoryCollectionSource,
  schema: Schema.Decoder<A>,
  booleanFields: ReadonlyArray<string>,
) => {
  const flagged = new Set(booleanFields);
  const decode = Schema.decodeUnknownEffect(schema);
  const rowInvalid = (error: Schema.SchemaError) =>
    new ReplicaRowInvalid({ message: error.message, source });
  return (
    rows: ReadonlyArray<SqliteResultRow>,
  ): Effect.Effect<ReadonlyArray<A>, ReplicaRowInvalid> =>
    Effect.forEach(rows, (row) =>
      decode(sqliteBooleanFields(row, flagged)).pipe(Effect.mapError(rowInvalid)),
    );
};

export const decodeCategorySqliteRows = sqliteRowsDecoder("categories", CategoryRow, [
  "tracksPacks",
]);

export const decodeProductSqliteRows = sqliteRowsDecoder("products", ProductRow, ["visible"]);

export const decodeBatchSqliteRows = sqliteRowsDecoder("batches", BatchRow, []);

export const decodeInvoiceSqliteRows = sqliteRowsDecoder("invoices", InvoiceRow, []);

export const decodeInvoiceItemSqliteRows = sqliteRowsDecoder("invoiceItems", InvoiceItemRow, []);

export const decodeStockMovementSqliteRows = sqliteRowsDecoder(
  "stockMovements",
  StockMovementRow,
  [],
);
