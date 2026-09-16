import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  makeCatalogWrites,
  makeInvoiceWrites,
  makeLocalSaleOutbox,
  submitImportInventory,
  submitOrganizationObjectCommand,
} from "@store/client-db";
import type { ImportInventoryCommand } from "@store/contracts";
import { PowerSyncTransactor } from "@tanstack/powersync-db-collection";
import type { DbClient } from "@tanstack/react-db";

import type { InventoryHost } from "@/lib/inventory-host";

import type { Inventory, InventoryActions, InventoryActor } from "./types";

export const persistSale =
  (dbClient: DbClient, powerSync: AbstractPowerSyncDatabase) => async (work: () => void) => {
    const transaction = dbClient.createTransaction({
      autoCommit: false,
      mutationFn: async ({ transaction: pending }) => {
        await new PowerSyncTransactor({ database: powerSync }).applyTransaction(pending);
      },
    });
    transaction.mutate(work);
    await transaction.commit();
    await transaction.isPersisted.promise;
  };

type ActionTables = Pick<
  Inventory,
  | "batches"
  | "categories"
  | "invoiceItems"
  | "invoices"
  | "products"
  | "stockMovements"
  | "dbClient"
>;

export const makeInventoryActions = (
  inventory: ActionTables,
  host: InventoryHost,
  actor: InventoryActor,
  runtime: {
    readonly persistSale: (work: () => void) => Promise<void>;
    readonly waitForUploadDrain: () => Promise<void>;
  },
): InventoryActions => {
  const writes = makeCatalogWrites(inventory, actor);
  const saleOutbox = makeLocalSaleOutbox(actor.organizationId);
  const invoices = makeInvoiceWrites(
    {
      ...inventory,
      persist: runtime.persistSale,
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
      await runtime.waitForUploadDrain();
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

export const makeOrganizationObjectActions = (): InventoryActions => ({
  createCategory: () => submitOrganizationObjectCommand(),
  updateCategory: () => submitOrganizationObjectCommand(),
  deleteCategory: () => submitOrganizationObjectCommand(),
  createProduct: () => submitOrganizationObjectCommand(),
  updateProduct: () => submitOrganizationObjectCommand(),
  deleteProduct: () => submitOrganizationObjectCommand(),
  createBatch: () => submitOrganizationObjectCommand(),
  updateBatch: () => submitOrganizationObjectCommand(),
  importInventory: () => submitOrganizationObjectCommand(),
  issueInvoice: () => submitOrganizationObjectCommand(),
});
