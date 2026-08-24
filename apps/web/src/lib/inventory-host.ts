import type { AbstractPowerSyncDatabase } from "@powersync/common";
import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import type {
  LegacyBatchMigrationRow,
  LegacyCategoryMigrationRow,
  LegacyProductMigrationRow,
} from "@store/contracts";

export interface LegacyLocalInventorySnapshot {
  readonly categories: ReadonlyArray<CategoryRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly batches: ReadonlyArray<BatchRow>;
  readonly invoices: ReadonlyArray<InvoiceRow>;
  readonly invoiceItems: ReadonlyArray<InvoiceItemRow>;
  readonly stockMovements: ReadonlyArray<StockMovementRow>;
  readonly migrationCatalog: {
    readonly categories: ReadonlyArray<LegacyCategoryMigrationRow>;
    readonly products: ReadonlyArray<LegacyProductMigrationRow>;
    readonly batches: ReadonlyArray<LegacyBatchMigrationRow>;
  };
}

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly openPowerSyncDatabase: (databaseName: string) => Promise<AbstractPowerSyncDatabase>;
  /** One-time source for the pre-TanStack signed-out Electron database. */
  readonly loadLegacyLocalSnapshot?: () => Promise<LegacyLocalInventorySnapshot>;
}
