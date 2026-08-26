import type {
  BatchRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "@store/client-db";
import { persistableRow } from "@store/client-db";
import type {
  CreateInvoiceInput,
  ImportInventoryCommandResult,
  ImportInventoryInput,
  IssueInvoiceResult,
} from "@store/contracts";
import { inventorySkuKey } from "@store/contracts";
import {
  decodeBatchId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeProductId,
} from "@store/contracts/ids";

import {
  activeRows,
  movementRow,
  mutationMetadata,
  persistTogether,
  requiredRow,
  updatedMetadata,
} from "./persist";
import type { Inventory, InventoryActor } from "./types";

export const requireNonNegativeQuantity = (quantity: number, label: string) => {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
};

export const importLocalInventory = async (
  inventory: Inventory,
  actor: InventoryActor,
  input: ImportInventoryInput,
): Promise<ImportInventoryCommandResult> => {
  const category = inventory.categories.state.get(input.categoryId);
  if (!category || category.deletedAt !== null)
    throw new Error("The selected category is missing.");

  const productsBySku = new Map<string, ProductRow[]>();
  for (const product of activeRows(inventory.products.state.values())) {
    const key = inventorySkuKey(product.name, product.unitsPerPack);
    const matches = productsBySku.get(key);
    if (matches) matches.push(product);
    else productsBySku.set(key, [product]);
  }
  const createdProducts: ProductRow[] = [];
  const createdBatches: Array<{ batch: BatchRow; movement: StockMovementRow }> = [];

  for (const line of input.lines) {
    const packQuantity = line.packQuantity ?? 0;
    const unitQuantity = line.unitQuantity ?? 0;
    requireNonNegativeQuantity(packQuantity, "Pack quantity");
    requireNonNegativeQuantity(unitQuantity, "Unit quantity");
    if (packQuantity + unitQuantity === 0) continue;

    const unitsPerPack = line.unitsPerPack ?? 1;
    const sku = inventorySkuKey(line.name, unitsPerPack);
    let product: ProductRow | undefined = line.productId
      ? inventory.products.state.get(line.productId)
      : undefined;
    if (product?.deletedAt !== null) product = undefined;
    if (line.productId && !product) throw new Error(`Product ${line.productId} no longer exists.`);
    if (product && product.unitsPerPack !== unitsPerPack) product = undefined;

    if (!product) {
      const matches = productsBySku.get(sku) ?? [];
      if (matches.length > 1) {
        throw new Error(
          `Multiple products are named “${line.name.trim()}” with ${unitsPerPack} units per pack. Choose which one to restock.`,
        );
      }
      product = matches[0];
    }

    if (!product) {
      const createdProduct: ProductRow = {
        id: decodeProductId(crypto.randomUUID()),
        name: line.name.trim(),
        categoryId: input.categoryId,
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack,
        packPrice: line.packPrice ?? null,
        unitPrice: null,
        visible: true,
        ...mutationMetadata(actor),
      };
      productsBySku.set(sku, [createdProduct]);
      createdProducts.push(createdProduct);
      product = createdProduct;
    }

    const batch: BatchRow = {
      id: decodeBatchId(crypto.randomUUID()),
      productId: product.id,
      batchNumber: line.batchNumber?.trim() || null,
      expiresAt: line.expiresAt ?? null,
      packQuantity,
      unitQuantity,
      ...mutationMetadata(actor),
    };
    createdBatches.push({
      batch,
      movement: movementRow(actor, {
        productId: product.id,
        batchId: batch.id,
        invoiceId: null,
        type: "stock_in",
        packDelta: packQuantity,
        unitDelta: unitQuantity,
        note: "Initial batch stock",
      }),
    });
  }

  if (createdProducts.length + createdBatches.length > 0) {
    await persistTogether(inventory, () => {
      for (const product of createdProducts) inventory.products.insert(product);
      for (const { batch, movement } of createdBatches) {
        inventory.batches.insert(batch);
        inventory.stockMovements.insert(movement);
      }
    });
  }

  return {
    createdProducts: createdProducts.length,
    createdBatches: createdBatches.length,
    txid: Date.now(),
  };
};

interface LocalInvoiceAllocation {
  readonly item: InvoiceItemRow;
  readonly movements: ReadonlyArray<StockMovementRow>;
}

const byEarliestExpiry = (left: BatchRow, right: BatchRow) =>
  (left.expiresAt ?? Number.POSITIVE_INFINITY) - (right.expiresAt ?? Number.POSITIVE_INFINITY) ||
  left.createdAt - right.createdAt;

export const issueLocalInvoice = async (
  inventory: Inventory,
  actor: InventoryActor,
  input: CreateInvoiceInput,
): Promise<IssueInvoiceResult> => {
  if (input.items.length === 0) throw new Error("Add at least one item to the sale.");
  for (const line of input.items) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("Quantities must be whole numbers of 1 or more.");
    }
    requireNonNegativeQuantity(line.salePrice, "Sale price");
  }

  const invoiceId = decodeInvoiceId(crypto.randomUUID());
  const invoiceNumber =
    activeRows(inventory.invoices.state.values()).reduce(
      (largest, invoice) => Math.max(largest, invoice.invoiceNumber),
      0,
    ) + 1;
  const plannedBatches = new Map<BatchRow["id"], BatchRow>(
    activeRows(inventory.batches.state.values()).map((batch) => [batch.id, batch]),
  );
  const allocations: LocalInvoiceAllocation[] = [];
  const invoiceLabel = invoiceNumber.toString().padStart(4, "0");

  for (const line of input.items) {
    const product = inventory.products.state.get(line.productId);
    if (!product || product.deletedAt !== null)
      throw new Error("One of the products no longer exists.");
    const candidates = [...plannedBatches.values()]
      .filter(
        (batch) =>
          batch.productId === product.id &&
          batch.deletedAt === null &&
          (line.batchId === null || batch.id === line.batchId),
      )
      .sort(byEarliestExpiry)
      .filter((batch) =>
        line.quantityType === "pack"
          ? batch.packQuantity > 0
          : batch.packQuantity * product.unitsPerPack + batch.unitQuantity > 0,
      );
    if (line.batchId && candidates.length === 0) {
      throw new Error(`The selected batch for ${product.name} no longer exists.`);
    }
    const available = candidates.reduce(
      (sum, batch) =>
        sum +
        (line.quantityType === "pack"
          ? batch.packQuantity
          : batch.packQuantity * product.unitsPerPack + batch.unitQuantity),
      0,
    );
    if (available < line.quantity) {
      throw new Error(
        `Not enough stock for ${product.name}: ${available} in stock, ${line.quantity} requested.`,
      );
    }

    let remaining = line.quantity;
    for (const batch of candidates) {
      if (remaining === 0) break;
      const batchAvailable =
        line.quantityType === "pack"
          ? batch.packQuantity
          : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;
      const taken = Math.min(batchAvailable, remaining);
      remaining -= taken;
      const metadata = updatedMetadata({ ...actor, rowVersion: batch.rowVersion });
      const movements: StockMovementRow[] = [];
      let nextBatch: BatchRow;

      if (line.quantityType === "pack") {
        nextBatch = persistableRow({
          ...batch,
          packQuantity: batch.packQuantity - taken,
          ...metadata,
        });
        movements.push(
          movementRow(actor, {
            productId: product.id,
            batchId: batch.id,
            invoiceId,
            type: "sale",
            packDelta: -taken,
            unitDelta: 0,
            note: `Invoice #${invoiceLabel}`,
          }),
        );
      } else {
        const packsOpened = Math.max(
          0,
          Math.ceil((taken - batch.unitQuantity) / product.unitsPerPack),
        );
        const looseUnits = batch.unitQuantity + packsOpened * product.unitsPerPack;
        nextBatch = persistableRow({
          ...batch,
          packQuantity: batch.packQuantity - packsOpened,
          unitQuantity: looseUnits - taken,
          ...metadata,
        });
        if (packsOpened > 0) {
          movements.push(
            movementRow(actor, {
              productId: product.id,
              batchId: batch.id,
              invoiceId,
              type: "open_pack",
              packDelta: -packsOpened,
              unitDelta: packsOpened * product.unitsPerPack,
              note: `Opened for invoice #${invoiceLabel}`,
            }),
          );
        }
        movements.push(
          movementRow(actor, {
            productId: product.id,
            batchId: batch.id,
            invoiceId,
            type: "sale",
            packDelta: 0,
            unitDelta: -taken,
            note: `Invoice #${invoiceLabel}`,
          }),
        );
      }

      plannedBatches.set(batch.id, nextBatch);
      allocations.push({
        item: {
          id: decodeInvoiceItemId(crypto.randomUUID()),
          invoiceId,
          productId: product.id,
          batchId: batch.id,
          productName: product.name,
          batchNumber: batch.batchNumber,
          quantity: taken,
          quantityType: line.quantityType,
          baseUnitQuantity: taken * (line.quantityType === "pack" ? product.unitsPerPack : 1),
          salePrice: line.salePrice,
          ...mutationMetadata(actor),
        },
        movements,
      });
    }
  }

  const invoice: InvoiceRow = {
    id: invoiceId,
    invoiceNumber,
    customerName: input.customerName?.trim() || null,
    total: input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0),
    ...mutationMetadata(actor),
  };
  await persistTogether(inventory, () => {
    inventory.invoices.insert(invoice);
    for (const allocation of allocations) {
      inventory.invoiceItems.insert(allocation.item);
      const nextBatch = requiredRow(
        plannedBatches.get(allocation.item.batchId),
        "The allocated batch",
      );
      inventory.batches.update(nextBatch.id, (draft) => Object.assign(draft, nextBatch));
      for (const movement of allocation.movements) {
        inventory.stockMovements.insert(movement);
      }
    }
  });

  return { invoiceId, invoiceNumber, txid: Date.now() };
};
