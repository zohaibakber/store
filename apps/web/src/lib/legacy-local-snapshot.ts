import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import type { JsonApiResponse } from "@store/workspace";
import * as Schema from "effect/Schema";

import type { LegacyLocalInventorySnapshot } from "@/lib/inventory-host";
import { asError } from "@/lib/report-error";

const SQLiteBoolean = Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]);
const LegacyCategoryRow = Schema.Struct({
  ...CategoryRow.fields,
  tracksPacks: SQLiteBoolean,
});
const LegacyProductRow = Schema.Struct({
  ...ProductRow.fields,
  visible: SQLiteBoolean,
});
const LockedReplicaWire = Schema.Struct({
  categories: Schema.Array(LegacyCategoryRow),
  products: Schema.Array(LegacyProductRow),
  batches: Schema.Array(BatchRow),
  invoices: Schema.Array(InvoiceRow),
  invoiceItems: Schema.Array(InvoiceItemRow),
  stockMovements: Schema.Array(StockMovementRow),
});

const decodeSQLiteBoolean = (value: boolean | 0 | 1) => value === true || value === 1;

const emptyLockedReplica = (): LegacyLocalInventorySnapshot => ({
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
});

const normalizeLockedReplica = (
  raw: typeof LockedReplicaWire.Type,
): LegacyLocalInventorySnapshot => ({
  categories: raw.categories.map((row) =>
    Schema.decodeUnknownSync(CategoryRow)({
      ...row,
      tracksPacks: decodeSQLiteBoolean(row.tracksPacks),
    }),
  ),
  products: raw.products.map((row) =>
    Schema.decodeUnknownSync(ProductRow)({
      ...row,
      visible: decodeSQLiteBoolean(row.visible),
    }),
  ),
  batches: raw.batches,
  invoices: raw.invoices,
  invoiceItems: raw.invoiceItems,
  stockMovements: raw.stockMovements,
});

export const decodeLegacyLocalInventorySnapshot = (
  raw: JsonApiResponse,
  onLockedReplicaError?: (cause: Error) => void,
): LegacyLocalInventorySnapshot => {
  try {
    return normalizeLockedReplica(Schema.decodeUnknownSync(LockedReplicaWire)(raw));
  } catch (cause) {
    onLockedReplicaError?.(asError(cause));
    return emptyLockedReplica();
  }
};
