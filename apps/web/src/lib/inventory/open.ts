import { openCatalog, inventoryReplicaScope } from "@store/client-db";
import { collectionOptions, DbClient } from "@tanstack/react-db";

import type { HostInventoryScope } from "@/host-access";
import { toastStoreError } from "@/lib/errors";
import type { InventoryHost } from "@/lib/inventory-host";
import { reportError } from "@/lib/report-error";

import type { Inventory } from "./types";

export const inventoryScopeId = (host: InventoryHost, scope: HostInventoryScope) =>
  inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

export const openInventory = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  return openCatalog(
    {
      apiBaseUrl: host.apiBaseUrl,
      authenticatedFetch: host.authenticatedFetch,
      openPowerSyncDatabase: host.openPowerSyncDatabase,
      bindCollections: (configs) => {
        const dbClient = new DbClient();
        return {
          dbClient,
          batches: dbClient.collection(collectionOptions(configs.batches)),
          categories: dbClient.collection(collectionOptions(configs.categories)),
          invoiceItems: dbClient.collection(collectionOptions(configs.invoiceItems)),
          invoices: dbClient.collection(collectionOptions(configs.invoices)),
          products: dbClient.collection(collectionOptions(configs.products)),
          stockMovements: dbClient.collection(collectionOptions(configs.stockMovements)),
          cleanupCollections: () => dbClient.cleanup(),
        };
      },
      onUploadHalt: (failure) => {
        reportError(failure, { op: "inventory-upload-halt", scopeId });
        toastStoreError(failure);
      },
      onFirstSyncError: (cause) => {
        reportError(cause, { op: "inventory-first-sync", scopeId });
        toastStoreError(cause);
      },
    },
    scope.organizationId,
  );
};
