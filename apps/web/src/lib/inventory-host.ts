import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import type { PersistedCollectionPersistence } from "@tanstack/db-sqlite-persistence-core";

export interface LegacyLocalInventorySnapshot {
  readonly categories: ReadonlyArray<CategoryRow>;
  readonly products: ReadonlyArray<ProductRow>;
  readonly batches: ReadonlyArray<BatchRow>;
  readonly invoices: ReadonlyArray<InvoiceRow>;
  readonly invoiceItems: ReadonlyArray<InvoiceItemRow>;
  readonly stockMovements: ReadonlyArray<StockMovementRow>;
}

export interface InventoryPersistenceLease {
  readonly persistence: PersistedCollectionPersistence;
  readonly dispose: () => Promise<void>;
}

export interface InventoryHost {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly openPersistence: (databaseName: string) => Promise<InventoryPersistenceLease>;
  /** One-time source for the pre-TanStack signed-out Electron database. */
  readonly loadLegacyLocalSnapshot?: () => Promise<LegacyLocalInventorySnapshot>;
}
