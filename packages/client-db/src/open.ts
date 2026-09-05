import type { CatalogWriteCommand, CatalogWriteEntity } from "@store/contracts/catalog-write";
import {
  Catalog,
  CatalogError,
  CatalogHttpTransport,
  CatalogLive,
  layerIndexedDbReplica,
  type CatalogFailure,
  type ReplicaDiff,
} from "@store/sync";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { catalogMemoryCollectionConfigs, type CatalogCollectionConfigs } from "./collections";
import {
  inventoryReplicaDatabaseName,
  inventoryReplicaScope,
  inventorySourceId,
} from "./inventory";
import { failureFromUnknown, InventoryFailure } from "./inventory-failure";
import { inventoryApiRoot } from "./mutations";
import type { BatchRow, CategoryRow, ProductRow } from "./rows";

export type { CatalogCollectionConfigs };

export type CatalogBoundTables = {
  readonly batches: { preload?: () => Promise<void> };
  readonly categories: { preload?: () => Promise<void> };
  readonly products: { preload?: () => Promise<void> };
  readonly invoices: { preload?: () => Promise<void> };
  readonly invoiceItems: { preload?: () => Promise<void> };
  readonly stockMovements: { preload?: () => Promise<void> };
};

export type CatalogOpenHost<Tables extends CatalogBoundTables> = {
  readonly apiBaseUrl: string;
  readonly authenticatedFetch: typeof fetch;
  readonly deviceId: string;
  readonly bindCollections: (configs: CatalogCollectionConfigs) => Tables & {
    readonly cleanupCollections: () => Promise<void>;
  };
  readonly onUploadHalt?: (failure: InventoryFailure) => void;
  readonly onFirstSyncError?: (cause: unknown) => void;
};

const failureFromCatalog = (cause: CatalogError) =>
  new InventoryFailure({
    message: cause.message,
    reason:
      cause.reason === "conflict"
        ? { _tag: "staleReplica" }
        : cause.reason === "rejected"
          ? { _tag: "rejected", code: cause.code ?? "CATALOG_REJECTED" }
          : { _tag: cause.reason },
  });

export const INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE = "The first sync did not finish in time.";

const acquireCatalogReplica = Effect.fn("CatalogReplica.acquire")(function* <
  Tables extends CatalogBoundTables,
>(host: CatalogOpenHost<Tables>, scopeId: string) {
  const catalog = yield* Catalog;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<Catalog>());
  const listeners = new Set<(diff: ReplicaDiff) => void>();
  const firstSyncFailureReported = yield* Ref.make(false);
  const publish = (diff: ReplicaDiff) => {
    for (const listener of listeners) listener(diff);
  };
  const reportFailure = Effect.fn("CatalogReplica.reportFailure")(function* (
    failure: CatalogFailure,
  ) {
    const mapped = failureFromCatalog(failure.error);
    if (failure._tag === "upload") {
      host.onUploadHalt?.(mapped);
    } else if (!(yield* Ref.getAndSet(firstSyncFailureReported, true))) {
      host.onFirstSyncError?.(mapped);
    }
  });
  const persist = <A>(operation: Effect.Effect<A, CatalogError>) =>
    operation.pipe(
      Effect.mapError(failureFromCatalog),
      Effect.tapError((failure) => Effect.sync(() => host.onUploadHalt?.(failure))),
    );

  yield* catalog.changes.pipe(
    Stream.runForEach((diff) => Effect.sync(() => publish(diff))),
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* catalog.failures.pipe(
    Stream.runForEach(reportFailure),
    Effect.forkScoped({ startImmediately: true }),
  );

  const persistCatalog = (entity: CatalogWriteEntity, row: CategoryRow | ProductRow | BatchRow) => {
    const command: CatalogWriteCommand = {
      operationId: row.operationId,
      organizationId: row.organizationId,
      deviceId: row.deviceId,
      actorUserId: row.updatedByUserId,
      occurredAt: row.updatedAt,
      entity,
      rows: [row],
    };
    return runPromise(persist(catalog.write(command)));
  };
  const bound = yield* Effect.acquireRelease(
    Effect.sync(() =>
      host.bindCollections(
        catalogMemoryCollectionConfigs({
          scopeId,
          snapshot: () => runPromise(catalog.snapshot),
          subscribe: (listener) => {
            listeners.add(listener);
            return () => {
              listeners.delete(listener);
            };
          },
          persistCatalog,
        }),
      ),
    ),
    (collections) =>
      Effect.tryPromise({
        try: () => collections.cleanupCollections(),
        catch: failureFromUnknown,
      }).pipe(
        Effect.catch((failure) => Effect.logWarning("Catalog replica cleanup failed", failure)),
        Effect.ensuring(Effect.sync(() => listeners.clear())),
      ),
  );
  const { cleanupCollections: _cleanupCollections, ...tables } = bound;
  yield* Effect.forEach(
    [
      tables.batches,
      tables.categories,
      tables.invoiceItems,
      tables.invoices,
      tables.products,
      tables.stockMovements,
    ],
    (table) =>
      Effect.tryPromise({
        try: () => table.preload?.() ?? Promise.resolve(),
        catch: failureFromUnknown,
      }),
    { concurrency: "unbounded", discard: true },
  );

  return {
    ...tables,
    waitForUploadDrain: catalog.waitForIdle.pipe(Effect.mapError(failureFromCatalog)),
    enqueueInvoice: (...args: Parameters<typeof catalog.issueInvoice>) =>
      persist(catalog.issueInvoice(...args)),
    poke: catalog.poke,
  };
});

export const openCatalog = async <Tables extends CatalogBoundTables>(
  host: CatalogOpenHost<Tables>,
  organizationId: string,
) => {
  const scopeId = inventoryReplicaScope(host.apiBaseUrl, organizationId);
  const apiRoot = inventoryApiRoot(host.apiBaseUrl);
  const apiUrl = apiRoot.endsWith("/api") ? apiRoot.slice(0, -4) : apiRoot;
  const catalogLayer = CatalogLive({
    organizationId,
    deviceId: host.deviceId,
    apiOrigin: inventorySourceId(host.apiBaseUrl),
  }).pipe(
    Layer.provide(
      CatalogHttpTransport({
        apiUrl: apiUrl || host.apiBaseUrl,
        headers: () => ({}),
        fetch: host.authenticatedFetch,
      }),
    ),
    Layer.provide(layerIndexedDbReplica(inventoryReplicaDatabaseName(scopeId))),
  );
  const acquisition = acquireCatalogReplica(host, scopeId);
  const CatalogReplica =
    Context.Service<Effect.Success<typeof acquisition>>("store/CatalogReplica");
  const runtime = ManagedRuntime.make(
    Layer.effect(CatalogReplica, acquisition).pipe(Layer.provide(catalogLayer)),
  );
  try {
    const { waitForUploadDrain, enqueueInvoice, poke, ...tables } =
      await runtime.runPromise(CatalogReplica);
    return {
      ...tables,
      waitForUploadDrain: () => runtime.runPromise(waitForUploadDrain),
      enqueueInvoice: (...args: Parameters<typeof enqueueInvoice>) =>
        runtime.runPromise(enqueueInvoice(...args)),
      poke: () => runtime.runPromise(poke),
      dispose: () => runtime.dispose(),
    };
  } catch (cause) {
    await runtime.dispose();
    throw cause;
  }
};
