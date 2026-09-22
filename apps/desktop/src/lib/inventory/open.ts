import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodeStockMovementSqliteRows,
  inventoryOrganizationObjectReplicaName,
  inventoryReplicaScope,
  sqliteCollectionOptions,
  syncStatusFromOutbox,
  createInvoiceCoherenceGate,
  decodeOutboxStatusRow,
  type InventoryCollectionDescriptor,
  type InventoryCollectionRow,
  type InventorySyncStatus,
  type ReplicaSqliteHandle,
} from "@store/client-db";
import {
  StockRecommendationService,
  stockRecommendationLayer,
} from "@store/services/stock-recommendations";
import { collectionOptions, DbClient } from "@tanstack/react-db";
import { Effect, ManagedRuntime } from "effect";
import * as Option from "effect/Option";

import type { HostInventoryScope } from "@/host-access";
import type { InventoryHost } from "@/lib/inventory-host";

import { makeInventoryActions } from "./actions";
import { createWorkspaceAtoms } from "./atoms";
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

const outboxStatus = async (replica: ReplicaSqliteHandle): Promise<InventorySyncStatus> => {
  if (replica.readOutboxStatuses) {
    return syncStatusFromOutbox(await replica.readOutboxStatuses());
  }
  const statuses = (await replica.query(`select status from command_outbox`, [])).flatMap((row) => {
    const decoded = decodeOutboxStatusRow(row);
    return Option.isSome(decoded) ? [decoded.value.status] : [];
  });
  return syncStatusFromOutbox(statuses);
};

type CollectionDeps = {
  readonly executor: ReplicaSqliteHandle;
  readonly changeFeed: ReplicaSqliteHandle;
  readonly coherence: ReturnType<typeof createInvoiceCoherenceGate>;
};

const mountCollection = <Row extends InventoryCollectionRow>(
  dbClient: DbClient,
  deps: CollectionDeps,
  id: string,
  source: InventoryCollectionDescriptor<Row>["source"],
  syncMode: InventoryCollectionDescriptor<Row>["syncMode"],
  decodeRows: InventoryCollectionDescriptor<Row>["decodeRows"],
) =>
  dbClient.collection(
    collectionOptions(
      sqliteCollectionOptions(replicaDescriptor(id, source, syncMode, decodeRows), deps),
    ),
  );

const openCollections = (dbClient: DbClient, scopeId: string, deps: CollectionDeps) => ({
  categories: mountCollection(
    dbClient,
    deps,
    `${scopeId}:categories`,
    "categories",
    "eager",
    decodeCategorySqliteRows,
  ),
  products: mountCollection(
    dbClient,
    deps,
    `${scopeId}:products`,
    "products",
    "on-demand",
    decodeProductSqliteRows,
  ),
  batches: mountCollection(
    dbClient,
    deps,
    `${scopeId}:batches`,
    "batches",
    "on-demand",
    decodeBatchSqliteRows,
  ),
  invoices: mountCollection(
    dbClient,
    deps,
    `${scopeId}:invoices`,
    "invoices",
    "on-demand",
    decodeInvoiceSqliteRows,
  ),
  invoiceItems: mountCollection(
    dbClient,
    deps,
    `${scopeId}:invoice-items`,
    "invoiceItems",
    "on-demand",
    decodeInvoiceItemSqliteRows,
  ),
  stockMovements: mountCollection(
    dbClient,
    deps,
    `${scopeId}:stock-movements`,
    "stockMovements",
    "on-demand",
    decodeStockMovementSqliteRows,
  ),
});

export const openInventoryWorkspace = async (
  host: InventoryHost,
  scope: HostInventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  const replica = await host.openReplicaSqlite(inventoryOrganizationObjectReplicaName(scopeId), {
    organizationId: scope.organizationId,
    userId: scope.userId,
    replicaId: host.deviceId,
  });
  if (replica.engine !== "indexeddb") {
    await replica.query(
      `update replica_state set organizationId = ?, userId = ?, replicaId = ? where id = 'singleton'`,
      [scope.organizationId, scope.userId, host.deviceId],
    );
  }
  const dbClient = new DbClient();
  const coherence = createInvoiceCoherenceGate();
  const collections = openCollections(dbClient, scopeId, {
    executor: replica,
    changeFeed: replica,
    coherence,
  });
  const { recommendStock, disposeRecommendations } = recommendStockFor(scope);
  const atoms = createWorkspaceAtoms(await outboxStatus(replica), recommendStock);
  const unsubscribeStatus = replica.subscribe((notice) => {
    if (notice.workspaceToken !== replica.workspaceToken) return;
    void outboxStatus(replica).then((next) => {
      atoms.setSyncStatus(next);
    });
  });
  const tables = { dbClient, ...collections };
  const actor = actorFor(host, scope);
  return {
    ...tables,
    atoms,
    actions: makeInventoryActions(
      tables,
      actor,
      replica,
      () => {
        replica.wakeSyncUpload?.();
      },
      atoms,
    ),
    commands: { status: () => atoms.getSyncStatus() },
    sync: atoms.getSyncStatus(),
    observeSync: (listener) => atoms.observeSyncStatus(listener),
    recommendStock,
    dispose: async () => {
      unsubscribeStatus();
      atoms.dispose();
      try {
        await disposeRecommendations();
        await dbClient.cleanup();
      } finally {
        replica.close();
      }
    },
  };
};

export const openInventory = openInventoryWorkspace;
