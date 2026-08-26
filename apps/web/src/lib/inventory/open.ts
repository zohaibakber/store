import {
  type BatchRow,
  type CategoryRow,
  disconnectAndClearInventoryPowerSync,
  type InvoiceItemRow,
  type InvoiceRow,
  inventoryPowerSyncCollectionConfigs,
  inventoryPowerSyncDatabaseName,
  inventoryReplicaScope,
  makeInventoryPowerSyncConnector,
  type ProductRow,
  type StockMovementRow,
  waitForInventoryFirstSync,
} from "@store/client-db";
import { collectionOptions, DbClient } from "@tanstack/react-db";

import type { HostInventoryScope } from "@/host-access";
import { toastStoreError } from "@/lib/errors";
import type { InventoryHost } from "@/lib/inventory-host";
import { reportError } from "@/lib/report-error";

import { persistInsert } from "./persist";
import type { Inventory, InventoryCollection } from "./types";

const seedMissingRows = async <Row extends { readonly id: string }>(
  collection: InventoryCollection<Row>,
  rows: ReadonlyArray<Row>,
) => {
  for (const row of rows) {
    if (!collection.state.has(row.id)) await persistInsert(collection, row);
  }
};

const seedLegacySnapshot = async (
  host: InventoryHost,
  collections: {
    readonly batches: InventoryCollection<BatchRow>;
    readonly categories: InventoryCollection<CategoryRow>;
    readonly invoiceItems: InventoryCollection<InvoiceItemRow>;
    readonly invoices: InventoryCollection<InvoiceRow>;
    readonly products: InventoryCollection<ProductRow>;
    readonly stockMovements: InventoryCollection<StockMovementRow>;
  },
) => {
  const legacy = await host.loadLegacyLocalSnapshot?.();
  if (!legacy) return;
  await seedMissingRows(collections.categories, legacy.categories);
  await seedMissingRows(collections.products, legacy.products);
  await seedMissingRows(collections.batches, legacy.batches);
  await seedMissingRows(collections.invoices, legacy.invoices);
  await seedMissingRows(collections.invoiceItems, legacy.invoiceItems);
  await seedMissingRows(collections.stockMovements, legacy.stockMovements);
};

const connectRemoteCatalog = (
  host: InventoryHost,
  scopeId: string,
  powerSync: Awaited<ReturnType<InventoryHost["openPowerSyncDatabase"]>>,
) => {
  void (async () => {
    try {
      void powerSync.connect(
        makeInventoryPowerSyncConnector({
          apiBaseUrl: host.apiBaseUrl,
          authenticatedFetch: host.authenticatedFetch,
          onUploadHalt: (failure) => {
            reportError(failure, { op: "inventory-upload-halt", scopeId });
            toastStoreError(failure);
          },
        }),
      );
      await waitForInventoryFirstSync(powerSync);
    } catch (cause) {
      reportError(cause, { op: "inventory-first-sync", scopeId });
      toastStoreError(cause);
    }
  })();
};

export const inventoryScopeId = (host: InventoryHost, scope: HostInventoryScope) =>
  scope._tag === "Local"
    ? "desktop-local:locked"
    : inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

export const openInventory = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  const dbClient = new DbClient();
  const powerSync = await host.openPowerSyncDatabase(inventoryPowerSyncDatabaseName(scopeId));
  try {
    const configs = inventoryPowerSyncCollectionConfigs(powerSync, scopeId);
    const categories = dbClient.collection(collectionOptions(configs.categories));
    const products = dbClient.collection(collectionOptions(configs.products));
    const batches = dbClient.collection(collectionOptions(configs.batches));
    const stockMovements = dbClient.collection(collectionOptions(configs.stockMovements));
    const invoices = dbClient.collection(collectionOptions(configs.invoices));
    const invoiceItems = dbClient.collection(collectionOptions(configs.invoiceItems));

    await Promise.all([
      batches.preload(),
      categories.preload(),
      invoiceItems.preload(),
      invoices.preload(),
      products.preload(),
      stockMovements.preload(),
    ]);
    if (scope._tag === "Local") {
      await seedLegacySnapshot(host, {
        batches,
        categories,
        invoiceItems,
        invoices,
        products,
        stockMovements,
      });
    }
    if (scope._tag === "Remote") connectRemoteCatalog(host, scopeId, powerSync);

    return {
      batches,
      categories,
      dbClient,
      invoiceItems,
      invoices,
      powerSync,
      products,
      stockMovements,
      mode: scope._tag,
      dispose: async () => {
        await dbClient.cleanup();
        if (scope._tag === "Remote") {
          await disconnectAndClearInventoryPowerSync(powerSync);
          return;
        }
        await powerSync.close();
      },
    };
  } catch (cause) {
    await powerSync.close();
    throw cause;
  }
};
