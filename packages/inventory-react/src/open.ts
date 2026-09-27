import {
  DEFAULT_COLLECTION_MAXIMUM_ROWS,
  EMPTY_SYNC_ACTIVITY,
  decodeBatchSqliteRows,
  decodeCategorySqliteRows,
  decodeInvoiceItemSqliteRows,
  decodeInvoiceSqliteRows,
  decodeProductSqliteRows,
  decodeStockMovementSqliteRows,
  inventoryReplicaScope,
  sqliteCollectionOptions,
  syncActivityFromOutbox,
  syncActivityFromStatuses,
  syncStatusFromActivity,
  syncStatusFromOutbox,
  syncStatusWithHealth,
  createInvoiceCoherenceGate,
  type InventoryCollectionDescriptor,
  type InventoryCollectionRow,
  type InventorySyncActivity,
  type InventorySyncStatus,
  type ReplicaHandle,
  type ReplicaSyncHealth,
} from "@store/client-db";
import {
  StockRecommendationService,
  stockRecommendationLayer,
} from "@store/services/stock-recommendations";
import { collectionOptions, DbClient } from "@tanstack/react-db";
import { Effect, Fiber, ManagedRuntime, Queue, Stream } from "effect";

import { makeInventoryActions } from "./actions";
import { createWorkspaceAtoms, type WorkspaceAtomSources, type WorkspaceAtoms } from "./atoms";
import type { InventoryHost, InventoryScope } from "./host";
import { searchCatalogProducts } from "./search";
import type { Inventory, InventoryActor } from "./types";

export const inventoryScopeId = (host: InventoryHost, scope: InventoryScope) =>
  inventoryReplicaScope(host.apiBaseUrl, scope.organizationId);

const actorFor = (
  host: InventoryHost,
  scope: InventoryScope,
  replica: ReplicaHandle,
): InventoryActor => ({
  organizationId: scope.organizationId,
  userId: scope.userId,
  deviceId: replica.replicaId ?? host.deviceId,
});

const recommendStockFor = (scope: InventoryScope) => {
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

type OutboxSnapshot = {
  readonly status: InventorySyncStatus;
  readonly activity: InventorySyncActivity | undefined;
};

const STORAGE_FAILED = "Local replica storage failed.";

const readOutboxSnapshot = (replica: ReplicaHandle) => {
  const readActivity = replica.readOutboxActivity;
  if (readActivity !== undefined) {
    return Effect.tryPromise(() => readActivity()).pipe(
      Effect.map((outbox): OutboxSnapshot => ({
        status: syncStatusFromActivity(outbox),
        activity: syncActivityFromOutbox(outbox),
      })),
    );
  }
  return Effect.tryPromise(() => replica.readOutboxStatuses()).pipe(
    Effect.map((statuses): OutboxSnapshot => ({
      status: syncStatusFromOutbox(statuses),
      activity: syncActivityFromStatuses(statuses),
    })),
  );
};

const readSyncSnapshot = (replica: ReplicaHandle): Effect.Effect<OutboxSnapshot> =>
  readOutboxSnapshot(replica).pipe(
    Effect.orElseSucceed((): OutboxSnapshot => ({
      status: { _tag: "storageError", message: STORAGE_FAILED },
      activity: undefined,
    })),
  );

const workspaceReadFailure = () => ({ message: STORAGE_FAILED });

const workspaceSources = (
  replica: ReplicaHandle,
  initialActivity: InventorySyncActivity | undefined,
): WorkspaceAtomSources => ({
  changes: replica,
  initialActivity: initialActivity ?? EMPTY_SYNC_ACTIVITY,
  readPendingRowIds: (entity) => {
    const readIds = replica.readPendingRowIds;
    if (readIds === undefined) return Effect.succeed(new Set<string>());
    return Effect.tryPromise({ try: () => readIds(entity), catch: workspaceReadFailure }).pipe(
      Effect.map((ids): ReadonlySet<string> => new Set(ids)),
    );
  },
  searchProducts: (query, limit) => searchCatalogProducts(replica, query, limit),
});

type CollectionDeps = {
  readonly executor: ReplicaHandle;
  readonly changeFeed: ReplicaHandle;
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

const followSyncStatus = (replica: ReplicaHandle, atoms: WorkspaceAtoms) => {
  const changes = Effect.runSync(Queue.sliding<void>(1));
  let health: ReplicaSyncHealth = { _tag: "running" };
  const unsubscribeCommits = replica.subscribe((notice) => {
    if (notice.workspaceToken === replica.workspaceToken) Queue.offerUnsafe(changes, undefined);
  });
  const unsubscribeHealth = replica.subscribeSyncHealth?.((next) => {
    health = next;
    Queue.offerUnsafe(changes, undefined);
  });
  const fiber = Stream.fromQueue(changes).pipe(
    Stream.mapEffect(() => readSyncSnapshot(replica)),
    Stream.runForEach((snapshot) =>
      Effect.sync(() => {
        atoms.registry.set(atoms.syncStatus, syncStatusWithHealth(snapshot.status, health));
        if (snapshot.activity !== undefined) {
          atoms.registry.set(atoms.syncActivity, snapshot.activity);
        }
      }),
    ),
    Effect.runFork,
  );
  return Fiber.interrupt(fiber).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        unsubscribeCommits();
        unsubscribeHealth?.();
      }),
    ),
  );
};

export const openInventoryWorkspace = async (
  host: InventoryHost,
  scope: InventoryScope,
): Promise<Inventory> => {
  const scopeId = inventoryScopeId(host, scope);
  const replica = await host.openReplica({
    organizationId: scope.organizationId,
    userId: scope.userId,
    replicaId: host.deviceId,
  });
  const dbClient = new DbClient();
  const collections = openCollections(dbClient, scopeId, {
    executor: replica,
    changeFeed: replica,
    coherence: createInvoiceCoherenceGate(),
  });
  const { recommendStock, disposeRecommendations } = recommendStockFor(scope);
  const outbox = await Effect.runPromise(readOutboxSnapshot(replica));
  const atoms = createWorkspaceAtoms(
    outbox.status,
    recommendStock,
    workspaceSources(replica, outbox.activity),
  );
  const stopFollowingSyncStatus = followSyncStatus(replica, atoms);
  const tables = { dbClient, ...collections };
  return {
    ...tables,
    atoms,
    actions: makeInventoryActions(
      tables,
      actorFor(host, scope, replica),
      replica,
      () => {
        replica.wakeSyncUpload?.();
      },
      atoms,
    ),
    recommendStock,
    dispose: async () => {
      await Effect.runPromise(stopFollowingSyncStatus);
      atoms.registry.dispose();
      try {
        await disposeRecommendations();
        await dbClient.cleanup();
      } finally {
        replica.close();
      }
    },
  };
};
