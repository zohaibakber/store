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

/** Upload order. A row is never sent before the rows it points at. */
export type LegacyMigrationStep = LegacyCatalogMigrationCommand["kind"] | "reconcile";

export interface LegacyMigrationProgress {
  readonly step: LegacyMigrationStep;
  readonly uploadedRows: number;
  readonly totalRows: number;
}

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

interface UploadUnit {
  readonly command: LegacyCatalogMigrationCommand;
  readonly failure: string;
}

const commandId = (deviceId: string, kind: LegacyCatalogMigrationCommand["kind"], index: number) =>
  `legacy-v1:${deviceId}:${kind}:${index}`;

/**
 * One POST per chunk, in dependency order. Empty kinds produce no unit, so an
 * empty table never costs a request.
 */
const uploadPlan = (
  catalog: LegacyMigrationCatalog,
  deviceId: string,
  occurredAt: number,
): ReadonlyArray<UploadUnit> => [
  ...chunkLegacyMigrationRows(catalog.categories).map((rows, index): UploadUnit => ({
    command: {
      kind: "categories",
      commandId: commandId(deviceId, "categories", index),
      deviceId,
      occurredAt,
      rows,
    },
    failure: "The server did not confirm every category.",
  })),
  ...chunkLegacyMigrationRows(catalog.products).map((rows, index): UploadUnit => ({
    command: {
      kind: "products",
      commandId: commandId(deviceId, "products", index),
      deviceId,
      occurredAt,
      rows,
    },
    failure: "The server did not confirm every product.",
  })),
  ...chunkLegacyMigrationRows(catalog.batches).map((rows, index): UploadUnit => ({
    command: {
      kind: "batches",
      commandId: commandId(deviceId, "batches", index),
      deviceId,
      occurredAt,
      rows,
    },
    failure: "The server did not confirm every stock batch.",
  })),
  ...chunkLegacyMigrationRows(catalog.invoices).map((rows, index): UploadUnit => ({
    command: {
      kind: "invoices",
      commandId: commandId(deviceId, "invoices", index),
      deviceId,
      occurredAt,
      rows,
    },
    failure: "The server did not confirm every invoice.",
  })),
  ...chunkLegacyMigrationRows(catalog.invoiceItems).map((rows, index): UploadUnit => ({
    command: {
      kind: "invoice-items",
      commandId: commandId(deviceId, "invoice-items", index),
      deviceId,
      occurredAt,
      rows,
    },
    failure: "The server did not confirm every invoice line.",
  })),
  ...chunkLegacyMigrationRows(catalog.stockMovements).map((rows, index): UploadUnit => ({
    command: {
      kind: "stock-movements",
      commandId: commandId(deviceId, "stock-movements", index),
      deviceId,
      occurredAt,
      rows,
    },
    failure: "The server did not confirm every stock entry.",
  })),
];

export const migrateLegacyCatalog = async (input: {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly catalog: LegacyMigrationCatalog;
  readonly onProgress?: (progress: LegacyMigrationProgress) => void;
}) => {
  const catalog = withoutOrphanRows(input.catalog);
  const totalRows = catalogSize(catalog);
  if (totalRows === 0) return;
  const occurredAt = Date.now();
  const authenticatedFetch = timedFetch(input.authenticatedFetch);
  let uploadedRows = 0;

  for (const unit of uploadPlan(catalog, input.deviceId, occurredAt)) {
    input.onProgress?.({ step: unit.command.kind, uploadedRows, totalRows });
    const result = await submitLegacyCatalogMigration({
      apiBaseUrl: input.apiBaseUrl,
      authenticatedFetch,
      command: unit.command,
    });
    if (result.imported + result.skipped !== unit.command.rows.length)
      throw new Error(unit.failure);
    uploadedRows += unit.command.rows.length;
  }

  input.onProgress?.({ step: "reconcile", uploadedRows, totalRows });
  await submitLegacyCatalogReconciliation({
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
  throw new Error("The first sync did not finish in time.");
};
