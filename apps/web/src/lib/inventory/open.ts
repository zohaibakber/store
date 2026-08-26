import {
  disconnectAndClearInventoryPowerSync,
  inventoryPowerSyncCollectionConfigs,
  inventoryPowerSyncDatabaseName,
  inventoryReplicaScope,
  makeInventoryPowerSyncConnector,
  waitForInventoryFirstSync,
} from "@store/client-db";
import { collectionOptions, DbClient } from "@tanstack/react-db";

import type { HostInventoryScope } from "@/host-access";
import { toastStoreError } from "@/lib/errors";
import type { InventoryHost } from "@/lib/inventory-host";
import { reportError } from "@/lib/report-error";

import type { Inventory } from "./types";

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
  inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

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
    connectRemoteCatalog(host, scopeId, powerSync);

    return {
      batches,
      categories,
      dbClient,
      invoiceItems,
      invoices,
      powerSync,
      products,
      stockMovements,
      dispose: async () => {
        await dbClient.cleanup();
        await disconnectAndClearInventoryPowerSync(powerSync);
      },
    };
  } catch (cause) {
    await powerSync.close();
    throw cause;
  }
};
