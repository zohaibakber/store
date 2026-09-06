import {
  makeCatalogWrites,
  makeInvoiceWrites,
  makePowerSyncSaleOutbox,
  submitImportInventory,
} from "@store/client-db";
import type { ImportInventoryCommand } from "@store/contracts";
import { PowerSyncTransactor } from "@tanstack/powersync-db-collection";

import type { InventoryHost } from "@/lib/inventory-host";

import type { Inventory, InventoryActions, InventoryActor } from "./types";

export const persistSale = (inventory: Inventory) => async (work: () => void) => {
  const transaction = inventory.dbClient.createTransaction({
    autoCommit: false,
    mutationFn: async ({ transaction: pending }) => {
      await new PowerSyncTransactor({ database: inventory.powerSync }).applyTransaction(pending);
    },
  });
  transaction.mutate(work);
  await transaction.commit();
  await transaction.isPersisted.promise;
};

export const makeInventoryActions = (
  inventory: Inventory,
  host: InventoryHost,
  actor: InventoryActor,
): InventoryActions => {
  const writes = makeCatalogWrites(inventory, actor);
  const saleOutbox = makePowerSyncSaleOutbox(inventory.powerSync);
  const invoices = makeInvoiceWrites(
    {
      ...inventory,
      persist: persistSale(inventory),
      journalSale: (snapshot) => saleOutbox.put(snapshot),
    },
    actor,
  );
  return {
    createCategory: writes.createCategory,
    updateCategory: writes.updateCategory,
    deleteCategory: writes.deleteCategory,
    createProduct: writes.createProduct,
    updateProduct: writes.updateProduct,
    deleteProduct: writes.deleteProduct,
    createBatch: async (input) => {
      const packQuantity = input.packQuantity ?? 0;
      const unitQuantity = input.unitQuantity ?? 0;
      if (packQuantity + unitQuantity === 0) throw new Error("Add some stock to the batch.");
      return writes.createBatch(input);
    },
    updateBatch: writes.updateBatch,
    importInventory: async (input) => {
      await inventory.waitForUploadDrain();
      const command: ImportInventoryCommand = {
        commandId: crypto.randomUUID(),
        deviceId: actor.deviceId,
        occurredAt: Date.now(),
        input,
      };
      return submitImportInventory({
        apiBaseUrl: host.apiBaseUrl,
        authenticatedFetch: host.authenticatedFetch,
        command,
      });
    },
    issueInvoice: invoices.issueInvoice,
  };
};
