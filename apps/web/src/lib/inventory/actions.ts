import type { BatchRow, CategoryRow, ProductRow } from "@store/client-db";
import {
  persistableRow,
  submitImportInventory,
  submitIssueInvoice,
  waitForInventoryUploadDrain,
} from "@store/client-db";
import type { ImportInventoryCommand, IssueInvoiceCommand } from "@store/contracts";
import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";

import type { InventoryHost } from "@/lib/inventory-host";

import { importLocalInventory, issueLocalInvoice, requireNonNegativeQuantity } from "./local-workspace";
import {
  activeRows,
  movementRow,
  mutationMetadata,
  persistTogether,
  requiredRow,
  updatedMetadata,
} from "./persist";
import type { Inventory, InventoryActions, InventoryActor } from "./types";

export const makeInventoryActions = (
  inventory: Inventory,
  host: InventoryHost,
  actor: InventoryActor,
): InventoryActions => ({
  createCategory: async (input) => {
    const name = input.name.trim();
    if (!name) throw new Error("Enter a category name.");
    const duplicate = activeRows(inventory.categories.state.values()).find(
      (category) => category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) return duplicate;
    const row: CategoryRow = {
      id: decodeCategoryId(crypto.randomUUID()),
      name,
      tracksPacks: input.tracksPacks ?? true,
      ...mutationMetadata(actor),
    };
    const transaction = inventory.categories.insert(row);
    await transaction.isPersisted.promise;
    return row;
  },
  updateCategory: async (input) => {
    const current = requiredRow(inventory.categories.state.get(input.id), "This category");
    const name = input.name.trim();
    if (!name) throw new Error("Enter a category name.");
    const duplicate = activeRows(inventory.categories.state.values()).find(
      (category) =>
        category.id !== input.id &&
        category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (duplicate) throw new Error(`A category named “${name}” already exists.`);
    const metadata = updatedMetadata({ ...actor, rowVersion: current.rowVersion });
    const transaction = inventory.categories.update(input.id, (draft) => {
      draft.name = name;
      draft.tracksPacks = input.tracksPacks;
      Object.assign(draft, metadata);
    });
    await transaction.isPersisted.promise;
    return { ...current, name, tracksPacks: input.tracksPacks, ...metadata };
  },
  deleteCategory: async (id) => {
    const current = requiredRow(inventory.categories.state.get(id), "This category");
    if (
      activeRows(inventory.products.state.values()).some((product) => product.categoryId === id)
    ) {
      throw new Error(`Move the products in “${current.name}” to another category first.`);
    }
    const metadata = updatedMetadata({ ...actor, rowVersion: current.rowVersion });
    const transaction = inventory.categories.update(id, (draft) => {
      draft.deletedAt = metadata.updatedAt;
      Object.assign(draft, metadata);
    });
    await transaction.isPersisted.promise;
  },
  createProduct: async (input) => {
    if (!input.categoryId) throw new Error("Select an active category.");
    const categoryId = decodeCategoryId(input.categoryId);
    const category = inventory.categories.state.get(categoryId);
    if (!category || category.deletedAt !== null) throw new Error("Select an active category.");
    const row: ProductRow = {
      id: decodeProductId(crypto.randomUUID()),
      name: input.name.trim(),
      categoryId,
      aisle: input.aisle ?? null,
      composition: input.composition ?? null,
      strength: input.strength ?? null,
      unitsPerPack: input.unitsPerPack ?? 1,
      packPrice: input.packPrice ?? null,
      unitPrice: input.unitPrice ?? null,
      visible: input.visible ?? true,
      ...mutationMetadata(actor),
    };
    const transaction = inventory.products.insert(row);
    await transaction.isPersisted.promise;
    return row;
  },
  updateProduct: async (input) => {
    const current = requiredRow(inventory.products.state.get(input.id), "This product");
    const categoryId = decodeCategoryId(input.categoryId ?? current.categoryId);
    const category = inventory.categories.state.get(categoryId);
    if (!category || category.deletedAt !== null) throw new Error("Select an active category.");
    const metadata = updatedMetadata({ ...actor, rowVersion: current.rowVersion });
    const unitsPerPack = input.unitsPerPack ?? 1;
    if (unitsPerPack !== current.unitsPerPack) {
      const remainingStock = activeRows(inventory.batches.state.values()).some(
        (batch) =>
          batch.productId === current.id && (batch.packQuantity > 0 || batch.unitQuantity > 0),
      );
      if (remainingStock) {
        throw new Error("Change units per pack only after the product has no remaining stock.");
      }
    }
    const next = persistableRow({
      ...current,
      ...input,
      name: input.name.trim(),
      categoryId,
      aisle: input.aisle ?? null,
      composition: input.composition ?? null,
      strength: input.strength ?? null,
      unitsPerPack,
      packPrice: input.packPrice ?? null,
      unitPrice: input.unitPrice ?? null,
      visible: input.visible ?? true,
      ...metadata,
    } satisfies ProductRow);
    const transaction = inventory.products.update(input.id, (draft) => Object.assign(draft, next));
    await transaction.isPersisted.promise;
    return next;
  },
  deleteProduct: async (id) => {
    const current = requiredRow(inventory.products.state.get(id), "This product");
    const remainingStock = activeRows(inventory.batches.state.values()).some(
      (batch) =>
        batch.productId === current.id && (batch.packQuantity > 0 || batch.unitQuantity > 0),
    );
    if (remainingStock) {
      throw new Error("Clear remaining stock before deleting this product.");
    }
    const metadata = updatedMetadata({ ...actor, rowVersion: current.rowVersion });
    const transaction = inventory.products.update(id, (draft) => {
      draft.deletedAt = metadata.updatedAt;
      Object.assign(draft, metadata);
    });
    await transaction.isPersisted.promise;
  },
  createBatch: async (input) => {
    const product = inventory.products.state.get(input.productId);
    if (!product || product.deletedAt !== null) throw new Error("This product no longer exists.");
    const packQuantity = input.packQuantity ?? 0;
    const unitQuantity = input.unitQuantity ?? 0;
    requireNonNegativeQuantity(packQuantity, "Pack quantity");
    requireNonNegativeQuantity(unitQuantity, "Unit quantity");
    if (packQuantity + unitQuantity === 0) throw new Error("Add some stock to the batch.");
    const row: BatchRow = {
      id: decodeBatchId(crypto.randomUUID()),
      productId: decodeProductId(input.productId),
      batchNumber: input.batchNumber?.trim() || null,
      expiresAt: input.expiresAt ?? null,
      packQuantity,
      unitQuantity,
      ...mutationMetadata(actor),
    };
    if (inventory.mode === "Local") {
      await persistTogether(inventory, () => {
        inventory.batches.insert(row);
        inventory.stockMovements.insert(
          movementRow(actor, {
            productId: row.productId,
            batchId: row.id,
            invoiceId: null,
            type: "stock_in",
            packDelta: packQuantity,
            unitDelta: unitQuantity,
            note: "Initial batch stock",
          }),
        );
      });
    } else {
      const transaction = inventory.batches.insert(row);
      await transaction.isPersisted.promise;
    }
    return row;
  },
  updateBatch: async (input) => {
    const current = requiredRow(inventory.batches.state.get(input.id), "This batch");
    if (input.packQuantity !== undefined) {
      requireNonNegativeQuantity(input.packQuantity, "Pack quantity");
    }
    if (input.unitQuantity !== undefined) {
      requireNonNegativeQuantity(input.unitQuantity, "Unit quantity");
    }
    const metadata = updatedMetadata({ ...actor, rowVersion: current.rowVersion });
    const next = persistableRow({
      ...current,
      batchNumber: input.batchNumber?.trim() || null,
      expiresAt: input.expiresAt,
      packQuantity: input.packQuantity ?? current.packQuantity,
      unitQuantity: input.unitQuantity ?? current.unitQuantity,
      ...metadata,
    } satisfies BatchRow);
    const packDelta = next.packQuantity - current.packQuantity;
    const unitDelta = next.unitQuantity - current.unitQuantity;
    if (inventory.mode === "Local" && (packDelta !== 0 || unitDelta !== 0)) {
      await persistTogether(inventory, () => {
        inventory.batches.update(input.id, (draft) => Object.assign(draft, next));
        inventory.stockMovements.insert(
          movementRow(actor, {
            productId: current.productId,
            batchId: current.id,
            invoiceId: null,
            type: "adjustment",
            packDelta,
            unitDelta,
            note: "Stock corrected",
          }),
        );
      });
    } else {
      const transaction = inventory.batches.update(input.id, (draft) => Object.assign(draft, next));
      await transaction.isPersisted.promise;
    }
    return next;
  },
  importInventory: async (input) => {
    if (inventory.mode === "Local") return importLocalInventory(inventory, actor, input);
    await waitForInventoryUploadDrain(inventory.powerSync);
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
    return result;
  },
  issueInvoice: async (input) => {
    if (inventory.mode === "Local") return issueLocalInvoice(inventory, actor, input);
    await waitForInventoryUploadDrain(inventory.powerSync);
    const command: IssueInvoiceCommand = {
      commandId: crypto.randomUUID(),
      deviceId: actor.deviceId,
      occurredAt: Date.now(),
      input,
    };
    const result = await submitIssueInvoice({
      apiBaseUrl: host.apiBaseUrl,
      authenticatedFetch: host.authenticatedFetch,
      command,
    });
    return result;
  },
});
