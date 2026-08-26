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
  persistableRow,
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
import {
  decodeBatchId,
  decodeCategoryId,
  decodeProductId,
} from "@store/contracts/ids";
import { powerSyncCollectionOptions } from "@tanstack/powersync-db-collection";
import {
  DbClient,
  DbProvider,
  and,
  collectionOptions,
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

const activeRows = <Row extends { readonly deletedAt: number | null }>(rows: Iterable<Row>) =>
  [...rows].filter((row) => row.deletedAt === null);

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
    const transaction = inventory.batches.insert(row);
    await transaction.isPersisted.promise;
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
    const transaction = inventory.batches.update(input.id, (draft) => Object.assign(draft, next));
    await transaction.isPersisted.promise;
    return next;
  },
  importInventory: async (input) => {
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
  const organizationId = scope.organizationId;
  const userId = scope.userId;
  const [state, setState] = React.useState<InventoryState>({ _tag: "Opening" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const lease = acquireInventory(resourceKey, () => openInventory(host, scope));
    void lease.promise.then(
      (inventory) => {
        if (active) {
          setState({
            _tag: "Ready",
            inventory,
            actions: makeInventoryActions(inventory, host, {
              organizationId,
              userId,
              deviceId: host.deviceId,
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
  }, [attempt, host, organizationId, resourceKey, scope, userId]);

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
