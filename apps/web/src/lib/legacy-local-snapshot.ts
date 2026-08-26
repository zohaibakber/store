import {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import {
  LegacyBatchMigrationRow,
  LegacyCategoryMigrationRow,
  LegacyInvoiceItemMigrationRow,
  LegacyInvoiceMigrationRow,
  LegacyProductMigrationRow,
  LegacyStockMovementMigrationRow,
} from "@store/contracts";
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
const MigrationCatalogWire = Schema.Struct({
  categories: Schema.Array(LegacyCategoryMigrationRow),
  products: Schema.Array(LegacyProductMigrationRow),
  batches: Schema.Array(LegacyBatchMigrationRow),
  invoices: Schema.Array(LegacyInvoiceMigrationRow),
  invoiceItems: Schema.Array(LegacyInvoiceItemMigrationRow),
  stockMovements: Schema.Array(LegacyStockMovementMigrationRow),
});
const SnapshotEnvelope = Schema.Struct({
  migrationCatalog: Schema.optionalKey(MigrationCatalogWire),
});

const decodeSQLiteBoolean = (value: boolean | 0 | 1) => value === true || value === 1;

const emptyLockedReplica = () => ({
  categories: [],
  products: [],
  batches: [],
  invoices: [],
  invoiceItems: [],
  stockMovements: [],
});

const normalizeLockedReplica = (raw: typeof LockedReplicaWire.Type) => ({
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

/**
 * Decode the IPC snapshot in two pieces so a locked-replica schema mismatch
 * cannot drop the organization catalog that PowerSync still needs to upload.
 */
export const decodeLegacyLocalInventorySnapshot = (
  raw: JsonApiResponse,
  onLockedReplicaError?: (cause: Error) => void,
): LegacyLocalInventorySnapshot => {
  const envelope = Schema.decodeUnknownSync(SnapshotEnvelope)(raw);
  const migrationCatalog = envelope.migrationCatalog ?? emptyLockedReplica();
  try {
    return {
      ...normalizeLockedReplica(Schema.decodeUnknownSync(LockedReplicaWire)(raw)),
      migrationCatalog,
    };
  } catch (cause) {
    onLockedReplicaError?.(asError(cause));
    return {
      ...emptyLockedReplica(),
      migrationCatalog,
    };
  }
};
