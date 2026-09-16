import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodeStockMovementSqliteRows,
  InventoryFailure,
  INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE,
  inventoryOrganizationObjectReplicaName,
  inventoryReplicaScope,
  makeLocalSaleOutbox,
  openCatalog,
  restoreSaleOutbox,
  sqliteCollectionOptions,
  syncStatusFromOutbox,
  createSyncStatusStore,
  waitForInventoryFirstSync,
  decodeOutboxStatusRow,
  type InventoryCollectionDescriptor,
  type InventoryCollectionRow,
  type InventorySyncStatus,
  type ReplicaSqliteHandle,
} from "@store/client-db";
import { isConnectivityFailure } from "@store/contracts";
import {
  StockRecommendationService,
  stockRecommendationLayer,
} from "@store/services/stock-recommendations";
import { collectionOptions, DbClient } from "@tanstack/react-db";
import { Effect, ManagedRuntime } from "effect";
import * as Option from "effect/Option";

import type { HostInventoryScope } from "@/host-access";
import { toastStoreError } from "@/lib/errors";
import type { InventoryHost } from "@/lib/inventory-host";
import { reportError } from "@/lib/report-error";

import { makeInventoryActions, makeOrganizationObjectActions, persistSale } from "./actions";
import type { Inventory, InventoryActor } from "./types";

export const inventoryScopeId = (host: InventoryHost, scope: HostInventoryScope) =>
  inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

const actorFor = (host: InventoryHost, scope: HostInventoryScope): InventoryActor => ({
  organizationId: scope.organizationId,
  userId: scope.userId,
  deviceId: host.deviceId,
});

const recommendStockFor = (scope: HostInventoryScope) => {
  const recommendations = ManagedRuntime.make(stockRecommendationLayer);
  return {
    recommendStock: (snapshot: Parameters<Inventory["recommendStock"]>[0], signal: AbortSignal) =>
      recommendations.runPromise(
        Effect.gen(function* () {
          const service = yield* StockRecommendationService;
          return yield* service.analyze({ ...snapshot, organizationId: scope.organizationId });
        }).pipe(Effect.result),
        { signal },
      ),
    disposeRecommendations: () => recommendations.dispose(),
  };
};

export const openPowerSyncInventoryWorkspace = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  const catalog = await openCatalog(
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
  const salePersist = persistSale(catalog.dbClient, catalog.powerSync);
  const saleOutbox = makeLocalSaleOutbox(scope.organizationId);
  const restore = () => restoreSaleOutbox(saleOutbox, catalog, salePersist);
  await restore();
  void waitForInventoryFirstSync(catalog.powerSync)
    .then(restore)
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      const expectedOffline =
        isConnectivityFailure(message) ||
        message === INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE ||
        (cause instanceof InventoryFailure &&
          (cause.reason._tag === "transport" || cause.reason._tag === "transient"));
      if (expectedOffline) return;
      reportError(cause, { op: "inventory-sale-outbox-restore", scopeId });
    });
  const { recommendStock, disposeRecommendations } = recommendStockFor(scope);
  const status = createSyncStatusStore({ _tag: "savedLocally" });
  const tables = {
    dbClient: catalog.dbClient,
    batches: catalog.batches,
    categories: catalog.categories,
    invoiceItems: catalog.invoiceItems,
    invoices: catalog.invoices,
    products: catalog.products,
    stockMovements: catalog.stockMovements,
  };
  const actions = makeInventoryActions(tables, host, actorFor(host, scope), {
    persistSale: salePersist,
    waitForUploadDrain: catalog.waitForUploadDrain,
  });
  return {
    ...tables,
    actions,
    commands: { status: status.get },
    sync: status.get(),
    observeSync: status.observe,
    recommendStock,
    dispose: async () => {
      try {
        await disposeRecommendations();
      } finally {
        await catalog.dispose();
      }
    },
  };
};

const replicaDescriptor = <Row extends InventoryCollectionRow>(
  id: string,
  source: InventoryCollectionDescriptor<Row>["source"],
  syncMode: InventoryCollectionDescriptor<Row>["syncMode"],
  decodeRows: InventoryCollectionDescriptor<Row>["decodeRows"],
): InventoryCollectionDescriptor<Row> => ({
  id,
  source,
  syncMode,
  maximumRows: DEFAULT_COLLECTION_MAXIMUM_ROWS,
  getKey: (row) => row.id,
  decodeRows,
});

const outboxStatus = (replica: ReplicaSqliteHandle): InventorySyncStatus => {
  const statuses = replica.query(`select status from command_outbox`, []).flatMap((row) => {
    const decoded = decodeOutboxStatusRow(row);
    return Option.isSome(decoded) ? [decoded.value.status] : [];
  });
  return syncStatusFromOutbox(statuses);
};

export const openOrganizationObjectInventoryWorkspace = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const opener = host.openReplicaSqlite;
  if (!opener) {
    throw new Error("Organization-object inventory needs a replica SQLite opener.");
  }
  const scopeId = inventoryScopeId(host, scope);
  const replica = await opener(inventoryOrganizationObjectReplicaName(scopeId));
  const dbClient = new DbClient();
  const collections = {
    categories: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:categories`,
            "categories",
            "eager",
            decodeCategorySqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    products: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:products`,
            "products",
            "on-demand",
            decodeProductSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    batches: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(`${scopeId}:batches`, "batches", "on-demand", decodeBatchSqliteRows),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    invoices: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:invoices`,
            "invoices",
            "on-demand",
            decodeInvoiceSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    invoiceItems: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:invoice-items`,
            "invoiceItems",
            "on-demand",
            decodeInvoiceItemSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
    stockMovements: dbClient.collection(
      collectionOptions(
        sqliteCollectionOptions(
          replicaDescriptor(
            `${scopeId}:stock-movements`,
            "stockMovements",
            "on-demand",
            decodeStockMovementSqliteRows,
          ),
          { executor: replica, changeFeed: replica },
        ),
      ),
    ),
  };
  const { recommendStock, disposeRecommendations } = recommendStockFor(scope);
  const status = createSyncStatusStore(outboxStatus(replica));
  const unsubscribeStatus = replica.subscribe((notice) => {
    if (notice.workspaceToken !== replica.workspaceToken) return;
    status.set(outboxStatus(replica));
  });
  const tables = { dbClient, ...collections };
  return {
    ...tables,
    actions: makeOrganizationObjectActions(),
    commands: { status: status.get },
    sync: status.get(),
    observeSync: status.observe,
    recommendStock,
    dispose: async () => {
      unsubscribeStatus();
      try {
        await disposeRecommendations();
        await dbClient.cleanup();
      } finally {
        replica.close();
      }
    },
  };
};

export const openInventoryWorkspace = (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  if (host.backend._tag === "organizationObject") {
    return openOrganizationObjectInventoryWorkspace(host, scope);
  }
  return openPowerSyncInventoryWorkspace(host, scope);
};

export const openInventory = openInventoryWorkspace;
