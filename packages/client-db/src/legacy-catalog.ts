import {
  chunkLegacyMigrationRows,
  MAX_LEGACY_MIGRATION_ROWS,
  type LegacyCatalogMigrationCommand,
  type LegacyCatalogMigrationData,
  type LegacyCatalogMigrationJobStatus,
} from "@store/contracts";

import {
  catalogUploadDisposition,
  InventoryFailure,
  submitLegacyCatalogMigrationBatch,
  submitLegacyCatalogReconciliation,
} from "./mutations";

export const LEGACY_CATALOG_REQUEST_TIMEOUT_MS = 60_000;
export const LEGACY_CATALOG_FIRST_SYNC_TIMEOUT_MS = 300_000;
export const LEGACY_CATALOG_JOB_TIMEOUT_MS = 15 * 60_000;
export const LEGACY_CATALOG_POLL_INTERVAL_MS = 1_000;
const LEGACY_CATALOG_BATCH_ATTEMPTS = 4;

export type LegacyMigrationCatalog = LegacyCatalogMigrationData;
export type LegacyMigrationProgress = LegacyCatalogMigrationJobStatus;

const catalogSize = (catalog: LegacyMigrationCatalog) =>
  catalog.categories.length +
  catalog.products.length +
  catalog.invoices.length +
  catalog.batches.length +
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

const withInventoryRetry = async <Value>(run: () => Promise<Value>) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < LEGACY_CATALOG_BATCH_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (!(error instanceof InventoryFailure) || catalogUploadDisposition(error)._tag !== "retry") {
        throw error;
      }
      await wait(500 * 2 ** attempt);
    }
  }
  throw lastError;
};

const commandId = (deviceId: string, kind: LegacyCatalogMigrationCommand["kind"], index: number) =>
  `legacy-http:v4:${deviceId}:${kind}:${index}`;

const commandsFor = (
  catalog: LegacyMigrationCatalog,
  deviceId: string,
  occurredAt: number,
): ReadonlyArray<LegacyCatalogMigrationCommand> => {
  const chunk = <Row>(rows: ReadonlyArray<Row>) =>
    chunkLegacyMigrationRows(rows, MAX_LEGACY_MIGRATION_ROWS);
  return [
    ...chunk(catalog.categories).map((rows, index): LegacyCatalogMigrationCommand => ({
      kind: "categories",
      commandId: commandId(deviceId, "categories", index),
      deviceId,
      occurredAt,
      rows,
    })),
    ...chunk(catalog.products).map((rows, index): LegacyCatalogMigrationCommand => ({
      kind: "products",
      commandId: commandId(deviceId, "products", index),
      deviceId,
      occurredAt,
      rows,
    })),
    ...chunk(catalog.batches).map((rows, index): LegacyCatalogMigrationCommand => ({
      kind: "batches",
      commandId: commandId(deviceId, "batches", index),
      deviceId,
      occurredAt,
      rows,
    })),
    ...chunk(catalog.invoices).map((rows, index): LegacyCatalogMigrationCommand => ({
      kind: "invoices",
      commandId: commandId(deviceId, "invoices", index),
      deviceId,
      occurredAt,
      rows,
    })),
    ...chunk(catalog.invoiceItems).map((rows, index): LegacyCatalogMigrationCommand => ({
      kind: "invoice-items",
      commandId: commandId(deviceId, "invoice-items", index),
      deviceId,
      occurredAt,
      rows,
    })),
    ...chunk(catalog.stockMovements).map((rows, index): LegacyCatalogMigrationCommand => ({
      kind: "stock-movements",
      commandId: commandId(deviceId, "stock-movements", index),
      deviceId,
      occurredAt,
      rows,
    })),
  ];
};

const progressFor = (input: {
  readonly jobId: string;
  readonly phase: LegacyCatalogMigrationJobStatus["phase"];
  readonly status: LegacyCatalogMigrationJobStatus["status"];
  readonly processedRows: number;
  readonly totalRows: number;
  readonly importedRows: number;
  readonly skippedRows: number;
  readonly error?: string;
}): LegacyMigrationProgress => {
  const progress = {
    jobId: input.jobId,
    processedRows: input.processedRows,
    totalRows: input.totalRows,
    importedRows: input.importedRows,
    skippedRows: input.skippedRows,
    progress:
      input.status === "succeeded"
        ? 100
        : input.totalRows === 0
          ? 0
          : Math.min(99, Math.floor((input.processedRows / input.totalRows) * 100)),
  };
  if (input.status === "failed") {
    return {
      status: "failed",
      phase: input.phase === "queued" || input.phase === "complete" ? "products" : input.phase,
      error: input.error ?? "Migration failed.",
      ...progress,
    };
  }
  if (input.status === "succeeded") {
    return { status: "succeeded", phase: "complete", ...progress };
  }
  if (input.status === "queued") {
    return { status: "queued", phase: "queued", ...progress };
  }
  return {
    status: "migrating",
    phase: input.phase === "queued" || input.phase === "complete" ? "categories" : input.phase,
    ...progress,
  };
};

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
  const jobId = `legacy-http:v4:${input.deviceId}`;
  const commands = commandsFor(catalog, input.deviceId, occurredAt);
  let processedRows = 0;
  let importedRows = 0;
  let skippedRows = 0;
  input.onProgress?.(
    progressFor({
      jobId,
      phase: "queued",
      status: "queued",
      processedRows,
      totalRows,
      importedRows,
      skippedRows,
    }),
  );

  for (const command of commands) {
    const result = await withInventoryRetry(() =>
      submitLegacyCatalogMigrationBatch({
        apiBaseUrl: input.apiBaseUrl,
        authenticatedFetch,
        command,
      }),
    );
    processedRows += command.rows.length;
    importedRows += result.imported;
    skippedRows += result.skipped;
    input.onProgress?.(
      progressFor({
        jobId,
        phase: command.kind,
        status: "migrating",
        processedRows,
        totalRows,
        importedRows,
        skippedRows,
      }),
    );
  }

  input.onProgress?.(
    progressFor({
      jobId,
      phase: "reconcile",
      status: "migrating",
      processedRows,
      totalRows,
      importedRows,
      skippedRows,
    }),
  );
  await withInventoryRetry(() =>
    submitLegacyCatalogReconciliation({
      apiBaseUrl: input.apiBaseUrl,
      authenticatedFetch,
      command: {
        deviceId: input.deviceId,
        occurredAt,
        categoryIds: catalog.categories.map((row) => row.id),
        productIds: catalog.products.map((row) => row.id),
        batchIds: catalog.batches.map((row) => row.id),
        invoiceIds: catalog.invoices.map((row) => row.id),
        invoiceItemIds: catalog.invoiceItems.map((row) => row.id),
        stockMovementIds: catalog.stockMovements.map((row) => row.id),
      },
    }),
  );
  const succeeded = progressFor({
    jobId,
    phase: "complete",
    status: "succeeded",
    processedRows,
    totalRows,
    importedRows,
    skippedRows,
  });
  input.onProgress?.(succeeded);
  return succeeded;
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
