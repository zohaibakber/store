import {
  type BatchRow,
  type CategoryRow,
  type InvoiceItemRow,
  type InvoiceRow,
  type ProductRow,
  type StockMovementRow,
  inventoryPowerSyncSchema,
  inventoryPowerSyncDatabaseName,
  inventoryReplicaScope,
  makeInventoryPowerSyncConnector,
  powerSyncCollectionSchemas,
  powerSyncDeserializationSchemas,
  powerSyncDeserializationFailure,
  submitImportInventory,
  submitIssueInvoice,
  waitForInventoryFirstSync,
  waitForInventoryUploadDrain,
} from "@store/client-db";
import type {
  Category,
  CreateBatchInput,
  CreateCategoryInput,
  CreateInvoiceInput,
  CreateProductInput,
  DashboardAnalytics,
  ImportInventoryCommand,
  ImportInventoryCommandResult,
  ImportInventoryInput,
  Invoice,
  IssueInvoiceCommand,
  IssueInvoiceResult,
  Product,
  ProductSuggestions,
  StockMovement,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import { inventorySkuKey } from "@store/contracts";
import {
  decodeBatchId,
  decodeCategoryId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeProductId,
} from "@store/contracts/ids";
import { PowerSyncTransactor, powerSyncCollectionOptions } from "@tanstack/powersync-db-collection";
import {
  type Collection,
  DbClient,
  DbProvider,
  and,
  collectionOptions,
  createTransaction,
  eq,
  isNull,
  toArray,
  useLiveQuery,
} from "@tanstack/react-db";
import * as React from "react";

import type { HostInventoryScope } from "@/host-access";
import { toastStoreError } from "@/lib/errors";
import type { InventoryHost } from "@/lib/inventory-host";
import { reportError } from "@/lib/report-error";

type InventoryCollection<Row extends object> = Collection<Row, string>;

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

const powerSyncConfigs = (
  database: Awaited<ReturnType<InventoryHost["openPowerSyncDatabase"]>>,
  scopeId: string,
) => ({
  categories: powerSyncCollectionOptions({
    id: `${scopeId}:categories`,
    database,
    table: inventoryPowerSyncSchema.props.categories,
    schema: powerSyncCollectionSchemas.categories,
    deserializationSchema: powerSyncDeserializationSchemas.categories,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  products: powerSyncCollectionOptions({
    id: `${scopeId}:products`,
    database,
    table: inventoryPowerSyncSchema.props.products,
    schema: powerSyncCollectionSchemas.products,
    deserializationSchema: powerSyncDeserializationSchemas.products,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  batches: powerSyncCollectionOptions({
    id: `${scopeId}:batches`,
    database,
    table: inventoryPowerSyncSchema.props.batches,
    schema: powerSyncCollectionSchemas.batches,
    deserializationSchema: powerSyncDeserializationSchemas.batches,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  invoices: powerSyncCollectionOptions({
    id: `${scopeId}:invoices`,
    database,
    table: inventoryPowerSyncSchema.props.invoices,
    schema: powerSyncCollectionSchemas.invoices,
    deserializationSchema: powerSyncDeserializationSchemas.invoices,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  invoiceItems: powerSyncCollectionOptions({
    id: `${scopeId}:invoice-items`,
    database,
    table: inventoryPowerSyncSchema.props.invoice_items,
    schema: powerSyncCollectionSchemas.invoiceItems,
    deserializationSchema: powerSyncDeserializationSchemas.invoiceItems,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
  stockMovements: powerSyncCollectionOptions({
    id: `${scopeId}:stock-movements`,
    database,
    table: inventoryPowerSyncSchema.props.stock_movements,
    schema: powerSyncCollectionSchemas.stockMovements,
    deserializationSchema: powerSyncDeserializationSchemas.stockMovements,
    onDeserializationError: powerSyncDeserializationFailure,
  }),
});

const openInventory = async (host: InventoryHost, scope: HostInventoryScope) => {
  const scopeId = inventoryScopeId(host, scope);
  const dbClient = new DbClient();
  const powerSync = await host.openPowerSyncDatabase(inventoryPowerSyncDatabaseName(scopeId));
  try {
    const configs = powerSyncConfigs(powerSync, scopeId);
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
        await powerSync.close();
      },
    };
  } catch (cause) {
    await powerSync.close();
    throw cause;
  }
};

type Inventory = Awaited<ReturnType<typeof openInventory>>;

const mutationMetadata = (actor: {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
}) => {
  const now = Date.now();
  return {
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: actor.deviceId,
    operationId: crypto.randomUUID(),
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  } as const;
};

const updatedMetadata = (actor: {
  readonly userId: string;
  readonly deviceId: string;
  readonly rowVersion: number;
}) => ({
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: crypto.randomUUID(),
  rowVersion: actor.rowVersion + 1,
  updatedAt: Date.now(),
});

const requiredRow = <Row,>(row: Row | undefined, label: string): Row => {
  if (!row) throw new Error(`${label} no longer exists.`);
  return row;
};

const persistInsert = async <Row extends object>(
  collection: InventoryCollection<Row>,
  row: Row,
) => {
  const transaction = collection.insert(row);
  await transaction.isPersisted.promise;
};

/**
 * One PowerSync SQLite write for every collection mutation in `mutate`.
 * Direct `collection.insert` / `update` each open their own write, so a crash
 * between them can leave an invoice without stock movements (or the reverse).
 */
const persistTogether = async (inventory: Inventory, mutate: () => void) => {
  const transaction = createTransaction({
    autoCommit: false,
    mutationFn: async ({ transaction: pending }) => {
      await new PowerSyncTransactor({ database: inventory.powerSync }).applyTransaction(pending);
    },
  });
  transaction.mutate(mutate);
  await transaction.commit();
  await transaction.isPersisted.promise;
};

const activeRows = <Row extends { readonly deletedAt: number | null }>(rows: Iterable<Row>) =>
  [...rows].filter((row) => row.deletedAt === null);

const movementRow = (
  actor: { readonly organizationId: string; readonly userId: string; readonly deviceId: string },
  input: Omit<
    StockMovementRow,
    "id" | "organizationId" | "actorUserId" | "deviceId" | "operationId" | "createdAt"
  >,
): StockMovementRow => ({
  id: crypto.randomUUID(),
  organizationId: actor.organizationId,
  actorUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: crypto.randomUUID(),
  createdAt: Date.now(),
  ...input,
});

export interface InventoryActions {
  readonly createCategory: (input: CreateCategoryInput) => Promise<CategoryRow>;
  readonly updateCategory: (input: UpdateCategoryInput) => Promise<CategoryRow>;
  readonly deleteCategory: (id: UpdateCategoryInput["id"]) => Promise<void>;
  readonly createProduct: (input: CreateProductInput) => Promise<ProductRow>;
  readonly updateProduct: (input: UpdateProductInput) => Promise<ProductRow>;
  readonly deleteProduct: (id: UpdateProductInput["id"]) => Promise<void>;
  readonly createBatch: (input: CreateBatchInput) => Promise<BatchRow>;
  readonly updateBatch: (input: UpdateBatchInput) => Promise<BatchRow>;
  readonly importInventory: (input: ImportInventoryInput) => Promise<ImportInventoryCommandResult>;
  readonly issueInvoice: (input: CreateInvoiceInput) => Promise<IssueInvoiceResult>;
}

type InventoryActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

const requireNonNegativeQuantity = (quantity: number, label: string) => {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`${label} must be a non-negative whole number.`);
  }
};

const importLocalInventory = async (
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

const issueLocalInvoice = async (
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
        nextBatch = { ...batch, packQuantity: batch.packQuantity - taken, ...metadata };
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
        nextBatch = {
          ...batch,
          packQuantity: batch.packQuantity - packsOpened,
          unitQuantity: looseUnits - taken,
          ...metadata,
        };
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

const makeInventoryActions = (
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
    const next = {
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
    } satisfies ProductRow;
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
    const next = {
      ...current,
      batchNumber: input.batchNumber?.trim() || null,
      expiresAt: input.expiresAt,
      packQuantity: input.packQuantity ?? current.packQuantity,
      unitQuantity: input.unitQuantity ?? current.unitQuantity,
      ...metadata,
    } satisfies BatchRow;
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

type InventoryState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready"; readonly inventory: Inventory; readonly actions: InventoryActions }
  | { readonly _tag: "Error"; readonly error: string };

const InventoryContext = React.createContext<InventoryState | null>(null);

type InventoryLease = {
  readonly promise: Promise<Inventory>;
  release: () => void;
};

type InventoryResource = {
  references: number;
  readonly promise: Promise<Inventory>;
  disposeTimer: number | null;
};

const resources = new Map<string, InventoryResource>();

const acquireInventory = (key: string, open: () => Promise<Inventory>): InventoryLease => {
  const existing = resources.get(key);
  const resource: InventoryResource = existing ?? {
    references: 0,
    promise: open(),
    disposeTimer: null,
  };
  resources.set(key, resource);
  resource.references += 1;
  if (resource.disposeTimer !== null) {
    clearTimeout(resource.disposeTimer);
    resource.disposeTimer = null;
  }
  return {
    promise: resource.promise,
    release: () => {
      resource.references -= 1;
      if (resource.references !== 0) return;
      resource.disposeTimer = window.setTimeout(() => {
        if (resource.references !== 0) return;
        if (resources.get(key) === resource) resources.delete(key);
        void resource.promise.then((inventory) => inventory.dispose()).catch(() => undefined);
      }, 0);
    },
  };
};

/** Drops a failed open so the next mount runs it again from the start. */
const forgetInventory = (key: string) => {
  const resource = resources.get(key);
  if (!resource) return;
  resources.delete(key);
  if (resource.disposeTimer !== null) clearTimeout(resource.disposeTimer);
  void resource.promise.then((inventory) => inventory.dispose()).catch(() => undefined);
};

export function InventoryProvider({
  children,
  host,
  scope,
}: {
  readonly children: React.ReactNode;
  readonly host: InventoryHost;
  readonly scope: HostInventoryScope;
}) {
  const resourceKey = inventoryScopeId(host, scope);
  const scopeTag = scope._tag;
  const organizationId = scope.organizationId;
  const userId = scope.userId;
  const [state, setState] = React.useState<InventoryState>({ _tag: "Opening" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const inventoryScope: HostInventoryScope =
      scopeTag === "Local"
        ? { _tag: "Local", organizationId: "local", userId: "local" }
        : { _tag: "Remote", organizationId, userId };
    const lease = acquireInventory(resourceKey, () => openInventory(host, inventoryScope));
    void lease.promise.then(
      (inventory) => {
        if (active) {
          setState({
            _tag: "Ready",
            inventory,
            actions: makeInventoryActions(inventory, host, {
              organizationId,
              userId,
              deviceId: scopeTag === "Local" ? "local" : host.deviceId,
            }),
          });
        }
      },
      (cause: unknown) => {
        const message = cause instanceof Error ? cause.message : "Catalog storage is unavailable.";
        if (active) setState({ _tag: "Error", error: message });
      },
    );
    return () => {
      active = false;
      lease.release();
    };
  }, [attempt, host, organizationId, resourceKey, scopeTag, userId]);

  if (state._tag === "Error") {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive">{state.error}</p>
        <button
          className="text-sm underline"
          onClick={() => {
            forgetInventory(resourceKey);
            setState({ _tag: "Opening" });
            setAttempt((value) => value + 1);
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    );
  }
  if (state._tag !== "Ready") return null;
  return (
    <InventoryContext.Provider value={state}>
      <DbProvider client={state.inventory.dbClient}>{children}</DbProvider>
    </InventoryContext.Provider>
  );
}

export const useInventoryState = () => React.useContext(InventoryContext);

export const useInventoryActions = () => {
  const state = React.useContext(InventoryContext);
  if (!state || state._tag !== "Ready") throw new Error("Inventory is not ready.");
  return state.actions;
};

export const useCatalogCategories = (inventory: Inventory) => {
  const live = useLiveQuery(
    (query) =>
      query
        .from({ category: inventory.categories })
        .where(({ category }) => isNull(category.deletedAt))
        .orderBy(({ category }) => category.name, "asc")
        .select(({ category }) => ({
          id: category.id,
          name: category.name,
          tracksPacks: category.tracksPacks,
          organizationId: category.organizationId,
          createdByUserId: category.createdByUserId,
          updatedByUserId: category.updatedByUserId,
          deviceId: category.deviceId,
          operationId: category.operationId,
          rowVersion: category.rowVersion,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        })),
    [inventory],
  );
  const data: ReadonlyArray<Category> = live.data;
  return { ...live, data };
};

export const useCatalogProducts = (inventory: Inventory) => {
  const live = useLiveQuery(
    (query) =>
      query
        .from({ product: inventory.products })
        .innerJoin({ category: inventory.categories }, ({ product, category }) =>
          eq(product.categoryId, category.id),
        )
        .where(({ product, category }) =>
          and(isNull(product.deletedAt), isNull(category.deletedAt)),
        )
        .orderBy(({ product }) => product.name, "asc")
        .select(({ product, category }) => ({
          id: product.id,
          name: product.name,
          categoryId: product.categoryId,
          aisle: product.aisle,
          composition: product.composition,
          strength: product.strength,
          unitsPerPack: product.unitsPerPack,
          packPrice: product.packPrice,
          unitPrice: product.unitPrice,
          visible: product.visible,
          organizationId: product.organizationId,
          createdByUserId: product.createdByUserId,
          updatedByUserId: product.updatedByUserId,
          deviceId: product.deviceId,
          operationId: product.operationId,
          rowVersion: product.rowVersion,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          category: {
            id: category.id,
            name: category.name,
            tracksPacks: category.tracksPacks,
            organizationId: category.organizationId,
            createdByUserId: category.createdByUserId,
            updatedByUserId: category.updatedByUserId,
            deviceId: category.deviceId,
            operationId: category.operationId,
            rowVersion: category.rowVersion,
            createdAt: category.createdAt,
            updatedAt: category.updatedAt,
          },
          batches: toArray(
            query
              .from({ batch: inventory.batches })
              .where(({ batch }) => and(eq(batch.productId, product.id), isNull(batch.deletedAt)))
              .select(({ batch }) => ({
                id: batch.id,
                productId: batch.productId,
                batchNumber: batch.batchNumber,
                expiresAt: batch.expiresAt,
                packQuantity: batch.packQuantity,
                unitQuantity: batch.unitQuantity,
                organizationId: batch.organizationId,
                createdByUserId: batch.createdByUserId,
                updatedByUserId: batch.updatedByUserId,
                deviceId: batch.deviceId,
                operationId: batch.operationId,
                rowVersion: batch.rowVersion,
                createdAt: batch.createdAt,
                updatedAt: batch.updatedAt,
              })),
          ),
        })),
    [inventory],
  );
  const data: ReadonlyArray<Product> = live.data;
  return { ...live, data };
};

export const useCatalogProduct = (inventory: Inventory, productId: string) => {
  const live = useCatalogProducts(inventory);
  return { ...live, data: live.data.find((product) => product.id === productId) };
};

export const useCatalogStockMovements = (inventory: Inventory, productId: string) => {
  const live = useLiveQuery(
    (query) =>
      query
        .from({ movement: inventory.stockMovements })
        .where(({ movement }) => eq(movement.productId, productId))
        .orderBy(({ movement }) => movement.createdAt, "desc")
        .select(({ movement }) => ({
          id: movement.id,
          productId: movement.productId,
          batchId: movement.batchId,
          invoiceId: movement.invoiceId,
          type: movement.type,
          packDelta: movement.packDelta,
          unitDelta: movement.unitDelta,
          note: movement.note,
          organizationId: movement.organizationId,
          actorUserId: movement.actorUserId,
          deviceId: movement.deviceId,
          operationId: movement.operationId,
          createdAt: movement.createdAt,
        })),
    [inventory, productId],
  );
  const data: ReadonlyArray<StockMovement> = live.data;
  return { ...live, data };
};

export const useInventoryInvoices = (inventory: Inventory) => {
  const live = useLiveQuery(
    (query) =>
      query
        .from({ invoice: inventory.invoices })
        .where(({ invoice }) => isNull(invoice.deletedAt))
        .orderBy(({ invoice }) => invoice.createdAt, "desc")
        .select(({ invoice }) => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          total: invoice.total,
          organizationId: invoice.organizationId,
          createdByUserId: invoice.createdByUserId,
          updatedByUserId: invoice.updatedByUserId,
          deviceId: invoice.deviceId,
          operationId: invoice.operationId,
          rowVersion: invoice.rowVersion,
          createdAt: invoice.createdAt,
          updatedAt: invoice.updatedAt,
          items: toArray(
            query
              .from({ item: inventory.invoiceItems })
              .where(({ item }) => and(eq(item.invoiceId, invoice.id), isNull(item.deletedAt)))
              .select(({ item }) => ({
                id: item.id,
                invoiceId: item.invoiceId,
                productId: item.productId,
                batchId: item.batchId,
                productName: item.productName,
                batchNumber: item.batchNumber,
                quantity: item.quantity,
                quantityType: item.quantityType,
                baseUnitQuantity: item.baseUnitQuantity,
                salePrice: item.salePrice,
                organizationId: item.organizationId,
                createdByUserId: item.createdByUserId,
                updatedByUserId: item.updatedByUserId,
                deviceId: item.deviceId,
                operationId: item.operationId,
                rowVersion: item.rowVersion,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
              })),
          ),
        })),
    [inventory],
  );
  const data: ReadonlyArray<Invoice> = live.data;
  return { ...live, data };
};

export const useInventoryInvoice = (inventory: Inventory, invoiceId: string) => {
  const live = useInventoryInvoices(inventory);
  return { ...live, data: live.data.find((invoice) => invoice.id === invoiceId) };
};

const DAY_MS = 86_400_000;
const DASHBOARD_DAYS = 30;
const EXPIRY_DAYS = 90;
const LOW_STOCK_THRESHOLD = 10;
const utcDayStart = (timestamp: number) => timestamp - (timestamp % DAY_MS);
const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

export const useInventoryDashboardAnalytics = (inventory: Inventory) => {
  const products = useCatalogProducts(inventory);
  const invoices = useInventoryInvoices(inventory);
  const [now] = React.useState(() => Date.now());
  const data = React.useMemo<DashboardAnalytics>(() => {
    const todayStart = utcDayStart(now);
    const windowStart = todayStart - (DASHBOARD_DAYS - 1) * DAY_MS;
    const sevenDayStart = todayStart - 6 * DAY_MS;
    const revenueByDay = Array.from({ length: DASHBOARD_DAYS }, (_, index) => {
      const dayStart = windowStart + index * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const matches = invoices.data.filter(
        (invoice) => invoice.createdAt >= dayStart && invoice.createdAt < dayEnd,
      );
      return {
        date: isoDay(dayStart),
        revenue: matches.reduce((sum, invoice) => sum + invoice.total, 0),
        invoices: matches.length,
      };
    });
    const sumSince = (start: number, pick: (day: (typeof revenueByDay)[number]) => number) =>
      revenueByDay.reduce(
        (sum, day, index) => (windowStart + index * DAY_MS >= start ? sum + pick(day) : sum),
        0,
      );
    const revenue30d = sumSince(windowStart, (day) => day.revenue);
    const invoices30d = sumSince(windowStart, (day) => day.invoices);

    const sales = new Map<
      string,
      { productId: Product["id"]; productName: string; unitsSold: number; revenue: number }
    >();
    for (const invoice of invoices.data) {
      if (invoice.createdAt < windowStart) continue;
      for (const item of invoice.items) {
        const current = sales.get(item.productId) ?? {
          productId: item.productId,
          productName: item.productName,
          unitsSold: 0,
          revenue: 0,
        };
        current.unitsSold += item.baseUnitQuantity;
        current.revenue += item.quantity * item.salePrice;
        sales.set(item.productId, current);
      }
    }

    return {
      totals: {
        revenueToday: sumSince(todayStart, (day) => day.revenue),
        revenue7d: sumSince(sevenDayStart, (day) => day.revenue),
        revenue30d,
        invoicesToday: sumSince(todayStart, (day) => day.invoices),
        invoices30d,
        averageInvoice30d: invoices30d === 0 ? 0 : Math.round(revenue30d / invoices30d),
        activeProducts: products.data.filter((product) => product.visible).length,
      },
      revenueByDay,
      topProducts: [...sales.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      expiringBatches: products.data
        .flatMap((product) =>
          product.batches.flatMap((batch) =>
            batch.expiresAt !== null &&
            batch.expiresAt >= now &&
            batch.expiresAt < now + EXPIRY_DAYS * DAY_MS &&
            (batch.packQuantity > 0 || batch.unitQuantity > 0)
              ? [
                  {
                    productId: product.id,
                    productName: product.name,
                    batchNumber: batch.batchNumber,
                    expiresAt: batch.expiresAt,
                    packQuantity: batch.packQuantity,
                    unitQuantity: batch.unitQuantity,
                  },
                ]
              : [],
          ),
        )
        .sort((a, b) => a.expiresAt - b.expiresAt)
        .slice(0, 8),
      lowStock: products.data
        .filter((product) => product.visible)
        .map((product) => ({
          productId: product.id,
          productName: product.name,
          packQuantity: product.batches.reduce((sum, batch) => sum + batch.packQuantity, 0),
          unitQuantity: product.batches.reduce((sum, batch) => sum + batch.unitQuantity, 0),
          totalUnits: product.batches.reduce(
            (sum, batch) => sum + batch.packQuantity * product.unitsPerPack + batch.unitQuantity,
            0,
          ),
        }))
        .filter((product) => product.totalUnits <= LOW_STOCK_THRESHOLD)
        .sort((a, b) => a.totalUnits - b.totalUnits || a.productName.localeCompare(b.productName))
        .slice(0, 8)
        .map(({ totalUnits: _totalUnits, ...product }) => product),
      recentInvoices: invoices.data.slice(0, 5).map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName: invoice.customerName,
        total: invoice.total,
        createdAt: invoice.createdAt,
      })),
    };
  }, [invoices.data, now, products.data]);

  return {
    data,
    isError: invoices.isError || products.isError,
    hasCachedData: invoices.data.length > 0 || products.data.length > 0,
    isLoading: false,
  };
};

export const useCatalogSuggestions = (inventory: Inventory): ProductSuggestions => {
  const products = useCatalogProducts(inventory).data;
  const distinct = (values: ReadonlyArray<string | null>) =>
    [...new Set(values.flatMap((value) => (value?.trim() ? [value.trim()] : [])))].sort((a, b) =>
      a.localeCompare(b),
    );
  return {
    names: distinct(products.map((product) => product.name)),
    aisles: distinct(products.map((product) => product.aisle)),
    compositions: distinct(products.map((product) => product.composition)),
  };
};
