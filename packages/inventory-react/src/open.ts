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
import { collectionOptions, DbClient } from "@tanstack/react-db";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Atom from "effect/unstable/reactivity/Atom";

import { makeInventoryActions } from "./actions";
import { createWorkspaceAtoms, type WorkspaceAtomSources, type WorkspaceAtoms } from "./atoms";
import { catalogOpenFailure, WorkspaceReadFailure } from "./errors";
import type { InventoryHost, InventoryScope } from "./host";
import { findProductsByNames, readProductPage, summarizeProducts } from "./product-list";
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

const workspaceReadFailure = () => new WorkspaceReadFailure({ message: STORAGE_FAILED });

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
  readProductPage: (request) => readProductPage(replica, request),
  summarizeProducts: (filters, distinct) =>
    summarizeProducts(replica, filters, distinct).pipe(Effect.mapError(workspaceReadFailure)),
  findProductsByNames: (names) => findProductsByNames(replica, names),
  readInsights: (window) =>
    Effect.tryPromise({
      try: () => replica.readInsights(window),
      catch: workspaceReadFailure,
    }).pipe(
      Effect.map((read) => read.facts),
      Effect.withSpan("InventoryInsights.readFacts"),
    ),
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

const commitWakes = (replica: ReplicaHandle) =>
  Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          replica.subscribe((notice) => {
            if (notice.workspaceToken === replica.workspaceToken) {
              Queue.offerUnsafe(queue, undefined);
            }
          }),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      ),
    { bufferSize: 1, strategy: "sliding" },
  );

const followSyncHealth = (replica: ReplicaHandle) =>
  Effect.gen(function* () {
    const health = yield* SubscriptionRef.make<ReplicaSyncHealth>({ _tag: "running" });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        replica.subscribeSyncHealth?.((next) => {
          Effect.runSync(SubscriptionRef.set(health, next));
        }),
      ),
      (unsubscribe) => Effect.sync(() => unsubscribe?.()),
    );
    return health;
  });

const followSyncStatus = (replica: ReplicaHandle, atoms: WorkspaceAtoms) =>
  Effect.gen(function* () {
    const health = yield* followSyncHealth(replica);
    yield* Stream.merge(commitWakes(replica), SubscriptionRef.changes(health)).pipe(
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.mapEffect(() => Effect.all([readSyncSnapshot(replica), SubscriptionRef.get(health)])),
      Stream.runForEach(([snapshot, current]) =>
        Effect.sync(() => {
          Atom.batch(() => {
            atoms.registry.set(atoms.syncStatus, syncStatusWithHealth(snapshot.status, current));
            if (snapshot.activity !== undefined) {
              atoms.registry.set(atoms.syncActivity, snapshot.activity);
            }
          });
        }),
      ),
      Effect.forkScoped,
    );
  });

const acquireReplica = (host: InventoryHost, scope: InventoryScope) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        host.openReplica({
          organizationId: scope.organizationId,
          userId: scope.userId,
          replicaId: host.deviceId,
        }),
      catch: catalogOpenFailure,
    }),
    (replica) => Effect.sync(() => replica.close()),
  );

const acquireDbClient = Effect.acquireRelease(
  Effect.sync(() => new DbClient()),
  (dbClient) => Effect.promise(() => dbClient.cleanup()),
);

const acquireWorkspace = (host: InventoryHost, scope: InventoryScope) =>
  Effect.gen(function* () {
    const replica = yield* acquireReplica(host, scope);
    const dbClient = yield* acquireDbClient;
    const collections = openCollections(dbClient, inventoryScopeId(host, scope), {
      executor: replica,
      changeFeed: replica,
      coherence: createInvoiceCoherenceGate(),
    });
    const outbox = yield* readOutboxSnapshot(replica).pipe(Effect.mapError(catalogOpenFailure));
    const atoms = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createWorkspaceAtoms(outbox.status, workspaceSources(replica, outbox.activity)),
      ),
      (opened) => Effect.sync(() => opened.registry.dispose()),
    );
    yield* followSyncStatus(replica, atoms);
    const tables = { dbClient, ...collections };
    const actor = actorFor(host, scope, replica);
    const actions = makeInventoryActions(
      actor,
      replica,
      () => {
        replica.wakeSyncUpload?.();
      },
      atoms,
    );
    return { ...tables, atoms, actions };
  });

export const openInventoryWorkspace = (
  host: InventoryHost,
  scope: InventoryScope,
): Promise<Inventory> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const workspaceScope = yield* Scope.make();
      const workspace = yield* acquireWorkspace(host, scope).pipe(
        Scope.provide(workspaceScope),
        Effect.onError(() => Scope.close(workspaceScope, Exit.void)),
      );
      return {
        ...workspace,
        dispose: () => Effect.runPromise(Scope.close(workspaceScope, Exit.void)),
      };
    }),
  );
