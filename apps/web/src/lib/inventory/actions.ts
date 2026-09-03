import { makeCatalogWrites, makeInvoiceWrites, submitImportInventory } from "@store/client-db";
import type { ImportInventoryCommand } from "@store/contracts";

import type { InventoryHost } from "@/lib/inventory-host";

import type { Inventory, InventoryActions, InventoryActor } from "./types";

const persistSale = (inventory: Inventory) => async (work: () => void) => {
  const transaction = inventory.dbClient.createTransaction({
    autoCommit: false,
    mutationFn: async () => undefined,
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
  const invoices = makeInvoiceWrites(
    {
      ...inventory,
      persist: persistSale(inventory),
      submitInvoice: inventory.enqueueInvoice,
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
      const result = await submitImportInventory({
        apiBaseUrl: host.apiBaseUrl,
        authenticatedFetch: host.authenticatedFetch,
        command,
      });
      await inventory.poke();
      return result;
    },
    issueInvoice: invoices.issueInvoice,
  };
};
