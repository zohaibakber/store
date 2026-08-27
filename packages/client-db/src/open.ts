import type { AbstractPowerSyncDatabase } from "@powersync/common";

import { inventoryPowerSyncCollectionConfigs } from "./collections";
import { inventoryReplicaDatabaseName, inventoryReplicaScope } from "./inventory";
import type { InventoryFailure } from "./inventory-failure";
import {
  disconnectAndClearInventoryPowerSync,
  makeInventoryPowerSyncConnector,
  waitForInventoryFirstSync,
  waitForInventoryUploadDrain,
} from "./powersync";

export type CatalogCollectionConfigs = ReturnType<typeof inventoryPowerSyncCollectionConfigs>;

export type CatalogBoundTables = {
  readonly batches: { preload: () => Promise<void> };
  readonly categories: { preload: () => Promise<void> };
  readonly products: { preload: () => Promise<void> };
  readonly invoices: { preload: () => Promise<void> };
  readonly invoiceItems: { preload: () => Promise<void> };
  readonly stockMovements: { preload: () => Promise<void> };
};

export type CatalogOpenHost<Tables extends CatalogBoundTables> = {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly openPowerSyncDatabase: (databaseName: string) => Promise<AbstractPowerSyncDatabase>;
  readonly bindCollections: (configs: CatalogCollectionConfigs) => Tables & {
    readonly cleanupCollections: () => Promise<void>;
  };
  readonly onUploadHalt?: (failure: InventoryFailure) => void;
  readonly onFirstSyncError?: (cause: unknown) => void;
};

export const openCatalog = async <Tables extends CatalogBoundTables>(
  host: CatalogOpenHost<Tables>,
  organizationId: string,
  options: { readonly waitForFirstSync?: boolean } = {},
) => {
  const scopeId = inventoryReplicaScope(host.apiBaseUrl, organizationId);
  const powerSync = await host.openPowerSyncDatabase(inventoryReplicaDatabaseName(scopeId));
  try {
    const collections = host.bindCollections(
      inventoryPowerSyncCollectionConfigs(powerSync, scopeId),
    );

    await Promise.all([
      collections.batches.preload(),
      collections.categories.preload(),
      collections.invoiceItems.preload(),
      collections.invoices.preload(),
      collections.products.preload(),
      collections.stockMovements.preload(),
    ]);

    void powerSync.connect(
      makeInventoryPowerSyncConnector({
        apiBaseUrl: host.apiBaseUrl,
        authenticatedFetch: host.authenticatedFetch,
        onUploadHalt: host.onUploadHalt,
      }),
    );

    const firstSync = waitForInventoryFirstSync(powerSync);
    if (options.waitForFirstSync) {
      await firstSync;
    } else {
      void firstSync.catch((cause: unknown) => host.onFirstSyncError?.(cause));
    }

    const { cleanupCollections, ...tables } = collections;
    return {
      ...tables,
      powerSync,
      waitForUploadDrain: () => waitForInventoryUploadDrain(powerSync),
      dispose: async () => {
        await cleanupCollections();
        await disconnectAndClearInventoryPowerSync(powerSync);
      },
    };
  } catch (cause) {
    await powerSync.close();
    throw cause;
  }
};
