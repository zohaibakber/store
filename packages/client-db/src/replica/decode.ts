import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  PurchaseOrderItemRow,
  PurchaseOrderRow,
  StockMovementRow,
  SupplierRow,
} from "../rows";
import { ReplicaRowInvalid } from "./errors";
import type { InventoryCollectionSource } from "./sources";
import type { ReplicaRow } from "./sqlite-row";
import type { CatalogRows } from "./types";

const SqliteBoolean = Schema.Union([Schema.Boolean, Schema.BooleanFromBit]);

type DecodeRows<Row> = (
  rows: ReadonlyArray<ReplicaRow>,
) => Effect.Effect<ReadonlyArray<Row>, ReplicaRowInvalid>;

const sqliteRowsDecoder = <A>(
  source: InventoryCollectionSource,
  schema: Schema.Decoder<A>,
): DecodeRows<A> => {
  const decode = Schema.decodeUnknownEffect(Schema.Array(schema));
  const rowInvalid = (error: Schema.SchemaError) =>
    new ReplicaRowInvalid({ message: error.message, source });
  return (rows) => decode(rows).pipe(Effect.mapError(rowInvalid));
};

const decodeCategorySqliteRows = sqliteRowsDecoder<CategoryRow>(
  "categories",
  Schema.Struct({ ...CategoryRow.fields, tracksPacks: SqliteBoolean }),
);

export const decodeProductSqliteRows = sqliteRowsDecoder<ProductRow>(
  "products",
  Schema.Struct({ ...ProductRow.fields, visible: SqliteBoolean }),
);

export const decodeBatchSqliteRows = sqliteRowsDecoder("batches", BatchRow);

export const decodeInvoiceSqliteRows = sqliteRowsDecoder("invoices", InvoiceRow);

type SourceDecoders = {
  readonly [Source in InventoryCollectionSource]: DecodeRows<CatalogRows[Source]>;
};

const SOURCE_DECODERS: SourceDecoders = {
  categories: decodeCategorySqliteRows,
  products: decodeProductSqliteRows,
  batches: decodeBatchSqliteRows,
  invoices: decodeInvoiceSqliteRows,
  invoiceItems: sqliteRowsDecoder("invoiceItems", InvoiceItemRow),
  stockMovements: sqliteRowsDecoder("stockMovements", StockMovementRow),
  suppliers: sqliteRowsDecoder("suppliers", SupplierRow),
  purchaseOrders: sqliteRowsDecoder("purchaseOrders", PurchaseOrderRow),
  purchaseOrderItems: sqliteRowsDecoder("purchaseOrderItems", PurchaseOrderItemRow),
};

export const decodeSourceRows = <Source extends InventoryCollectionSource>(
  source: Source,
): DecodeRows<CatalogRows[Source]> => SOURCE_DECODERS[source];
