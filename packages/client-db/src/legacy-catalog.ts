import {
  chunkLegacyMigrationRows,
  type LegacyBatchMigrationRow,
  type LegacyCatalogMigrationCommand,
  type LegacyCategoryMigrationRow,
  type LegacyInvoiceItemMigrationRow,
  type LegacyInvoiceMigrationRow,
  type LegacyProductMigrationRow,
  type LegacyStockMovementMigrationRow,
} from "@store/contracts";

import { submitLegacyCatalogMigration, submitLegacyCatalogReconciliation } from "./mutations";

export const LEGACY_CATALOG_REQUEST_TIMEOUT_MS = 60_000;
export const LEGACY_CATALOG_FIRST_SYNC_TIMEOUT_MS = 300_000;

export interface LegacyMigrationCatalog {
  readonly categories: ReadonlyArray<LegacyCategoryMigrationRow>;
  readonly products: ReadonlyArray<LegacyProductMigrationRow>;
  readonly batches: ReadonlyArray<LegacyBatchMigrationRow>;
  readonly invoices: ReadonlyArray<LegacyInvoiceMigrationRow>;
  readonly invoiceItems: ReadonlyArray<LegacyInvoiceItemMigrationRow>;
  readonly stockMovements: ReadonlyArray<LegacyStockMovementMigrationRow>;
}

const catalogSize = (catalog: LegacyMigrationCatalog) =>
  catalog.categories.length +
  catalog.products.length +
  catalog.batches.length +
  catalog.invoices.length +
  catalog.invoiceItems.length +
  catalog.stockMovements.length;

const timedFetch =
  (authenticatedFetch: typeof fetch): typeof fetch =>
  (input, init) =>
    authenticatedFetch(input, {
      ...init,
      signal: AbortSignal.timeout(LEGACY_CATALOG_REQUEST_TIMEOUT_MS),
    });

const uploadKind = async (
  input: {
    readonly apiBaseUrl: string;
    readonly authenticatedFetch: typeof fetch;
    readonly deviceId: string;
    readonly occurredAt: number;
  },
  command: LegacyCatalogMigrationCommand,
  failureLabel: string,
) => {
  const result = await submitLegacyCatalogMigration({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch: input.authenticatedFetch,
    command,
  });
  if (result.imported + result.skipped !== command.rows.length) throw new Error(failureLabel);
};

export const migrateLegacyCatalog = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly catalog: LegacyMigrationCatalog;
}) => {
  if (catalogSize(input.catalog) === 0) return;
  const occurredAt = Date.now();
  const authenticatedFetch = timedFetch(input.authenticatedFetch);
  const upload = {
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch,
    deviceId: input.deviceId,
    occurredAt,
  };
  for (const [index, rows] of chunkLegacyMigrationRows(input.catalog.categories).entries()) {
    await uploadKind(
      upload,
      {
        kind: "categories",
        commandId: `legacy-v1:${input.deviceId}:categories:${index}`,
        deviceId: input.deviceId,
        occurredAt,
        rows,
      },
      "The local category backup was not fully acknowledged by the server.",
    );
  }
  for (const [index, rows] of chunkLegacyMigrationRows(input.catalog.products).entries()) {
    await uploadKind(
      upload,
      {
        kind: "products",
        commandId: `legacy-v1:${input.deviceId}:products:${index}`,
        deviceId: input.deviceId,
        occurredAt,
        rows,
      },
      "The local product backup was not fully acknowledged by the server.",
    );
  }
  for (const [index, rows] of chunkLegacyMigrationRows(input.catalog.batches).entries()) {
    await uploadKind(
      upload,
      {
        kind: "batches",
        commandId: `legacy-v1:${input.deviceId}:batches:${index}`,
        deviceId: input.deviceId,
        occurredAt,
        rows,
      },
      "The local batch backup was not fully acknowledged by the server.",
    );
  }
  for (const [index, rows] of chunkLegacyMigrationRows(input.catalog.invoices).entries()) {
    await uploadKind(
      upload,
      {
        kind: "invoices",
        commandId: `legacy-v1:${input.deviceId}:invoices:${index}`,
        deviceId: input.deviceId,
        occurredAt,
        rows,
      },
      "The local invoice backup was not fully acknowledged by the server.",
    );
  }
  for (const [index, rows] of chunkLegacyMigrationRows(input.catalog.invoiceItems).entries()) {
    await uploadKind(
      upload,
      {
        kind: "invoice-items",
        commandId: `legacy-v1:${input.deviceId}:invoice-items:${index}`,
        deviceId: input.deviceId,
        occurredAt,
        rows,
      },
      "The local invoice item backup was not fully acknowledged by the server.",
    );
  }
  for (const [index, rows] of chunkLegacyMigrationRows(input.catalog.stockMovements).entries()) {
    await uploadKind(
      upload,
      {
        kind: "stock-movements",
        commandId: `legacy-v1:${input.deviceId}:stock-movements:${index}`,
        deviceId: input.deviceId,
        occurredAt,
        rows,
      },
      "The local stock history backup was not fully acknowledged by the server.",
    );
  }
  await submitLegacyCatalogReconciliation({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch,
    command: {
      deviceId: input.deviceId,
      occurredAt,
      categoryIds: input.catalog.categories.map((row) => row.id),
      productIds: input.catalog.products.map((row) => row.id),
      batchIds: input.catalog.batches.map((row) => row.id),
      invoiceIds: input.catalog.invoices.map((row) => row.id),
      invoiceItemIds: input.catalog.invoiceItems.map((row) => row.id),
      stockMovementIds: input.catalog.stockMovements.map((row) => row.id),
    },
  });
};

export const waitForInventoryFirstSync = async (
  powerSync: {
    readonly waitForFirstSync: (request?: AbortSignal) => Promise<void>;
    readonly currentStatus: { readonly hasSynced?: boolean | null };
  },
  timeoutMs: number = LEGACY_CATALOG_FIRST_SYNC_TIMEOUT_MS,
) => {
  const signal = AbortSignal.timeout(timeoutMs);
  await powerSync.waitForFirstSync(signal);
  if (powerSync.currentStatus.hasSynced) return;
  throw new Error("Catalog sync did not finish. Keep Tabaaq open and try again.");
};
