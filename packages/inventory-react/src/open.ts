import {
  catalogCollectionOptions,
  EMPTY_SYNC_ACTIVITY,
  makeCatalogCommands,
  syncStatusFromOutbox,
  syncStatusWithHealth,
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

import { createWorkspaceAtoms, type WorkspaceAtomSources, type WorkspaceAtoms } from "./atoms";
import { catalogOpenFailure, WorkspaceReadFailure } from "./errors";
import {
  inventoryScopeId,
  replicaAuthorityOf,
  type InventoryHost,
  type InventoryScope,
} from "./host";
import { makeInsightsSource, type InsightsSource } from "./insights-source";
import { countInvoices, readInvoicePageIds } from "./invoice-list";
import { createCatalogLifetime, type CatalogLifetime } from "./lifetime";
import { findProductsByNames, readProductPage, summarizeProducts } from "./product-list";
import {
  countPurchaseOrders,
  countSuppliers,
  readLearnedSupplierIds,
  readProductsOnOrder,
  readPurchaseOrderPageIds,
} from "./purchasing";
import { searchCatalogProducts } from "./search";
import type { Inventory, InventoryActions, InventoryActor } from "./types";

const actorFor = (
  host: InventoryHost,
  scope: InventoryScope,
  replica: ReplicaHandle,
): InventoryActor => ({
  organizationId: scope.organizationId,
  userId: scope.userId,
  deviceId: replica.replicaId ?? host.deviceId,
});

type OutboxSnapshot = {
  readonly status: InventorySyncStatus;
  readonly activity: InventorySyncActivity | undefined;
};

const STORAGE_FAILED = "Local replica storage failed.";

const readOutboxSnapshot = (replica: ReplicaHandle) =>
  Effect.tryPromise(() => replica.readSyncActivity()).pipe(
    Effect.map((read): OutboxSnapshot => ({
      status: syncStatusFromOutbox(read.statuses),
      activity: read.activity,
    })),
  );

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
  insights: InsightsSource,
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
  readProductsOnOrder: (productIds) => readProductsOnOrder(replica, productIds),
  readLearnedSuppliers: (productIds) => readLearnedSupplierIds(replica, productIds),
  readPurchaseOrderPage: (request) => readPurchaseOrderPageIds(replica, request),
  countPurchaseOrders: (filters) => countPurchaseOrders(replica, filters),
  countSuppliers: countSuppliers(replica),
  readInvoicePage: (request) => readInvoicePageIds(replica, request),
  countInvoices: (filters) => countInvoices(replica, filters),
  insights,
});

const openCollections = (dbClient: DbClient, scopeId: string, replica: ReplicaHandle) => {
  const options = catalogCollectionOptions(scopeId, replica);
  return {
    categories: dbClient.collection(collectionOptions(options.categories)),
    products: dbClient.collection(collectionOptions(options.products)),
    batches: dbClient.collection(collectionOptions(options.batches)),
    invoices: dbClient.collection(collectionOptions(options.invoices)),
    invoiceItems: dbClient.collection(collectionOptions(options.invoiceItems)),
    stockMovements: dbClient.collection(collectionOptions(options.stockMovements)),
    suppliers: dbClient.collection(collectionOptions(options.suppliers)),
    purchaseOrders: dbClient.collection(collectionOptions(options.purchaseOrders)),
    purchaseOrderItems: dbClient.collection(collectionOptions(options.purchaseOrderItems)),
  };
};

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

const sameHealth = (left: ReplicaSyncHealth, right: ReplicaSyncHealth) =>
  left._tag === right._tag &&
  (left._tag === "running" || right._tag === "running" || left.message === right.message);

const followSyncHealth = (replica: ReplicaHandle, atoms: WorkspaceAtoms) =>
  Effect.gen(function* () {
    const health = yield* SubscriptionRef.make<ReplicaSyncHealth>({ _tag: "running" });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        replica.subscribeSyncHealth?.((next) => {
          atoms.registry.set(atoms.syncing, next._tag === "running" && next.syncing === true);
          Effect.runSync(SubscriptionRef.set(health, next));
        }),
      ),
      (unsubscribe) => Effect.sync(() => unsubscribe?.()),
    );
    return health;
  });

const followSyncStatus = (replica: ReplicaHandle, atoms: WorkspaceAtoms) =>
  Effect.gen(function* () {
    const health = yield* followSyncHealth(replica, atoms);
    yield* Stream.merge(
      commitWakes(replica),
      SubscriptionRef.changes(health).pipe(Stream.changesWith(sameHealth)),
    ).pipe(
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
    (replica) =>
      Effect.tryPromise(() => replica.close()).pipe(
        Effect.catch((cause) => Effect.logError("InventoryReplica.close_failed", cause)),
      ),
  );

const acquireDbClient = Effect.acquireRelease(
  Effect.sync(() => new DbClient()),
  (dbClient) => Effect.promise(() => dbClient.cleanup()),
);

const acquireWorkspace = (host: InventoryHost, scope: InventoryScope) =>
  Effect.gen(function* () {
    const replica = yield* acquireReplica(host, scope);
    const dbClient = yield* acquireDbClient;
    const collections = openCollections(dbClient, inventoryScopeId(host, scope), replica);
    const outbox = yield* readOutboxSnapshot(replica).pipe(Effect.mapError(catalogOpenFailure));
    const insights = yield* makeInsightsSource(replica);
    const atoms = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createWorkspaceAtoms(outbox.status, workspaceSources(replica, outbox.activity, insights)),
      ),
      (opened) => Effect.sync(() => opened.registry.dispose()),
    );
    yield* followSyncStatus(replica, atoms);
    const tables = { dbClient, ...collections };
    const actor = actorFor(host, scope, replica);
    const wakeSyncUpload = () => {
      replica.wakeSyncUpload?.();
    };
    const actions: InventoryActions = {
      ...makeCatalogCommands({
        actor,
        replica,
        wakeSyncUpload,
        onExecution: (execution) => atoms.registry.set(atoms.commandExecution, execution),
      }),
      retrySync: async () => {
        await replica.retryRecovery?.();
      },
      syncNow: wakeSyncUpload,
    };
    return { ...tables, atoms, actions, authority: replicaAuthorityOf(scope) };
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

export const createAppCatalogLifetime = (): CatalogLifetime<Inventory> =>
  createCatalogLifetime({
    open: openInventoryWorkspace,
    databaseName: inventoryScopeId,
  });
