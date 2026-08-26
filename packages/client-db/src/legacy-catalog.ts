import {
  type LegacyCatalogMigrationData,
  type LegacyCatalogMigrationJobStatus,
} from "@store/contracts";

import { getLegacyCatalogMigrationStatus, submitLegacyCatalogMigration } from "./mutations";

export const LEGACY_CATALOG_REQUEST_TIMEOUT_MS = 60_000;
export const LEGACY_CATALOG_FIRST_SYNC_TIMEOUT_MS = 300_000;
export const LEGACY_CATALOG_JOB_TIMEOUT_MS = 15 * 60_000;
export const LEGACY_CATALOG_POLL_INTERVAL_MS = 1_000;

export type LegacyMigrationCatalog = LegacyCatalogMigrationData;
export type LegacyMigrationProgress = LegacyCatalogMigrationJobStatus;

const catalogSize = (catalog: LegacyMigrationCatalog) =>
  catalog.categories.length +
  catalog.products.length +
  catalog.batches.length +
  catalog.invoices.length +
  catalog.invoiceItems.length +
  catalog.stockMovements.length;

const identifiers = (rows: ReadonlyArray<{ readonly id: string }>) =>
  new Set(rows.map((row) => row.id));

/**
 * Drops rows whose parent is not part of the upload. Chunks are rejected whole,
 * so a single batch pointing at a deleted product would otherwise fail the
 * other 24 rows on a foreign key. Rows dropped here are already invisible in
 * the app: every catalog query joins through the parent.
 */
export const withoutOrphanRows = (catalog: LegacyMigrationCatalog): LegacyMigrationCatalog => {
  const categoryIds = identifiers(catalog.categories);
  const products = catalog.products.filter((product) => categoryIds.has(product.categoryId));
  const productIds = identifiers(products);
  const batches = catalog.batches.filter((batch) => productIds.has(batch.productId));
  const batchIds = identifiers(batches);
  const invoiceIds = identifiers(catalog.invoices);
  return {
    categories: catalog.categories,
    products,
    batches,
    invoices: catalog.invoices,
    invoiceItems: catalog.invoiceItems.filter(
      (item) =>
        invoiceIds.has(item.invoiceId) &&
        productIds.has(item.productId) &&
        batchIds.has(item.batchId),
    ),
    stockMovements: catalog.stockMovements.filter(
      (movement) =>
        productIds.has(movement.productId) &&
        batchIds.has(movement.batchId) &&
        (movement.invoiceId === null || invoiceIds.has(movement.invoiceId)),
    ),
  };
};

const timedFetch =
  (authenticatedFetch: typeof fetch): typeof fetch =>
  (input, init) =>
    authenticatedFetch(input, {
      ...init,
      signal: AbortSignal.timeout(LEGACY_CATALOG_REQUEST_TIMEOUT_MS),
    });

const wait = (duration: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, duration);
  });

export const migrateLegacyCatalog = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly catalog: LegacyMigrationCatalog;
  readonly onProgress?: (progress: LegacyMigrationProgress) => void;
  readonly pollIntervalMs?: number;
  readonly jobTimeoutMs?: number;
}) => {
  const catalog = withoutOrphanRows(input.catalog);
  const totalRows = catalogSize(catalog);
  if (totalRows === 0) return;
  const occurredAt = Date.now();
  const authenticatedFetch = timedFetch(input.authenticatedFetch);
  const started = await submitLegacyCatalogMigration({
    apiBaseUrl: input.apiBaseUrl,
    authenticatedFetch,
    command: {
      requestId: `legacy-catalog:v3:${input.deviceId}`,
      deviceId: input.deviceId,
      occurredAt,
      catalog,
    },
  });
  input.onProgress?.({
    status: "queued",
    phase: "queued",
    jobId: started.jobId,
    processedRows: 0,
    totalRows,
    importedRows: 0,
    skippedRows: 0,
    progress: 0,
  });

  const deadline = Date.now() + (input.jobTimeoutMs ?? LEGACY_CATALOG_JOB_TIMEOUT_MS);
  while (Date.now() <= deadline) {
    const status = await getLegacyCatalogMigrationStatus({
      apiBaseUrl: input.apiBaseUrl,
      authenticatedFetch,
      jobId: started.jobId,
    });
    input.onProgress?.(status);
    switch (status.status) {
      case "queued":
      case "migrating":
        await wait(input.pollIntervalMs ?? LEGACY_CATALOG_POLL_INTERVAL_MS);
        break;
      case "succeeded":
        return status;
      case "failed":
        throw new Error(status.error);
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  }
  throw new Error("Inventory migration is still running. Reopen the app to check its progress.");
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
  throw new Error("The first sync did not finish in time.");
};
