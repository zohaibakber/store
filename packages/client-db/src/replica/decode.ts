import { syncEntityRows } from "@store/contracts/entity-rows";
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
import type { ReplicaRow } from "./sqlite-row";

const SqliteBoolean = Schema.Union([Schema.Boolean, Schema.BooleanFromBit]);

const sqliteRowsDecoder = <A>(source: InventoryCollectionSource, schema: Schema.Decoder<A>) => {
  const decode = Schema.decodeUnknownEffect(Schema.Array(schema));
  const rowInvalid = (error: Schema.SchemaError) =>
    new ReplicaRowInvalid({ message: error.message, source });
  return (rows: ReadonlyArray<ReplicaRow>): Effect.Effect<ReadonlyArray<A>, ReplicaRowInvalid> =>
    decode(rows).pipe(Effect.mapError(rowInvalid));
};

export const decodeCategorySqliteRows = sqliteRowsDecoder<CategoryRow>(
  "categories",
  Schema.Struct({ ...CategoryRow.fields, tracksPacks: SqliteBoolean }),
);

export const decodeProductSqliteRows = sqliteRowsDecoder<ProductRow>(
  "products",
  Schema.Struct({ ...ProductRow.fields, visible: SqliteBoolean }),
);

export const decodeBatchSqliteRows = sqliteRowsDecoder("batches", BatchRow);

export const decodeInvoiceSqliteRows = sqliteRowsDecoder("invoices", InvoiceRow);

export const decodeInvoiceItemSqliteRows = sqliteRowsDecoder("invoiceItems", InvoiceItemRow);

export const decodeStockMovementSqliteRows = sqliteRowsDecoder("stockMovements", StockMovementRow);

export const decodeSupplierSqliteRows = sqliteRowsDecoder(
  "suppliers",
  syncEntityRows.supplier.schema,
);

export const decodePurchaseOrderSqliteRows = sqliteRowsDecoder(
  "purchaseOrders",
  syncEntityRows.purchaseOrder.schema,
);

export const decodePurchaseOrderItemSqliteRows = sqliteRowsDecoder(
  "purchaseOrderItems",
  syncEntityRows.purchaseOrderItem.schema,
);
