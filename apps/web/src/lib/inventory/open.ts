import {
  InventoryFailure,
  INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE,
  inventoryReplicaScope,
  makeLocalSaleOutbox,
  openCatalog,
  restoreSaleOutbox,
} from "@store/client-db";
import { isConnectivityFailure } from "@store/contracts";
import { collectionOptions, DbClient } from "@tanstack/react-db";

import type { HostInventoryScope } from "@/host-access";
import { toastStoreError } from "@/lib/errors";
import type { InventoryHost } from "@/lib/inventory-host";
import { reportError } from "@/lib/report-error";

import { persistSale } from "./actions";
import type { Inventory } from "./types";

export const inventoryScopeId = (host: InventoryHost, scope: HostInventoryScope) =>
  inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

export const openInventory = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  const inventory = await openCatalog(
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
        // PowerSync connect() is background. waitForFirstSync is optional for a
        // first-launch loading screen, not a user-facing error when offline.
        // https://docs.powersync.com/client-sdks/reference/javascript-web
        const message = cause instanceof Error ? cause.message : String(cause);
        const expectedOffline =
          isConnectivityFailure(message) ||
          message === INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE ||
          (cause instanceof InventoryFailure &&
            (cause.reason._tag === "transport" || cause.reason._tag === "transient"));
        if (expectedOffline) return;
        reportError(cause, { op: "inventory-first-sync", scopeId });
      },
    },
    scope.organizationId,
  );
  await restoreSaleOutbox(
    makeLocalSaleOutbox(scope.organizationId),
    inventory,
    persistSale(inventory),
  );
  return inventory;
};
