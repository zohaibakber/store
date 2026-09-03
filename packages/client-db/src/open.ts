import type { CatalogWriteCommand, CatalogWriteEntity } from "@store/contracts/catalog-write";
import {
  Catalog,
  CatalogError,
  CatalogHttpTransport,
  CatalogLive,
  DurableStore,
  layerIndexedDb,
  type ReplicaDiff,
} from "@store/sync";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";

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

const failureFromCatalog = (cause: unknown) => {
  if (cause instanceof CatalogError) {
    return new InventoryFailure({
      message: cause.message,
      reason:
        cause.reason === "conflict"
          ? { _tag: "staleReplica" }
          : cause.reason === "rejected"
            ? { _tag: "rejected", code: cause.code ?? "CATALOG_REJECTED" }
            : { _tag: cause.reason },
    });
  }
  return failureFromUnknown(cause);
};

export const INVENTORY_FIRST_SYNC_TIMEOUT_MESSAGE = "The first sync did not finish in time.";

export const openCatalog = async <Tables extends CatalogBoundTables>(
  host: CatalogOpenHost<Tables>,
  organizationId: string,
) => {
  const scopeId = inventoryReplicaScope(host.apiBaseUrl, organizationId);
  const apiRoot = inventoryApiRoot(host.apiBaseUrl);
  const apiUrl = apiRoot.endsWith("/api") ? apiRoot.slice(0, -4) : apiRoot;
  const listeners = new Set<(diff: ReplicaDiff) => void>();
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
    Layer.provide(
      DurableStore.fromKeyValueStore.pipe(
        Layer.provide(layerIndexedDb(inventoryReplicaDatabaseName(scopeId))),
      ),
    ),
  );
  const runtime = ManagedRuntime.make(catalogLayer);
  let cleanupCollections: (() => Promise<void>) | undefined;
  try {
    const catalog = await runtime.runPromise(
      Effect.gen(function* () {
        return yield* Catalog;
      }),
    );
    runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(catalog.changes);
          yield* PubSub.take(subscription).pipe(
            Effect.tap((diff: ReplicaDiff) =>
              Effect.sync(() => {
                for (const listener of listeners) listener(diff);
              }),
            ),
            Effect.forever,
          );
        }),
      ),
    );
    const persistCatalog = async (
      entity: CatalogWriteEntity,
      row: CategoryRow | ProductRow | BatchRow,
    ) => {
      const command: CatalogWriteCommand = {
        operationId: row.operationId,
        organizationId: row.organizationId,
        deviceId: row.deviceId,
        actorUserId: row.updatedByUserId,
        occurredAt: row.updatedAt,
        entity,
        rows: [row],
      };
      await runtime.runPromise(catalog.write(command)).catch((cause: unknown) => {
        const failure = failureFromCatalog(cause);
        host.onUploadHalt?.(failure);
        throw failure;
      });
    };
    const collections = host.bindCollections(
      catalogMemoryCollectionConfigs({
        scopeId,
        snapshot: () => runtime.runPromise(catalog.snapshot),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        persistCatalog,
      }),
    );
    cleanupCollections = collections.cleanupCollections;
    await Promise.all([
      collections.batches.preload?.(),
      collections.categories.preload?.(),
      collections.invoiceItems.preload?.(),
      collections.invoices.preload?.(),
      collections.products.preload?.(),
      collections.stockMovements.preload?.(),
    ]);
    const { cleanupCollections: cleanupBoundCollections, ...tables } = collections;
    return {
      ...tables,
      waitForUploadDrain: () =>
        runtime.runPromise(catalog.waitForIdle).catch((cause: unknown) => {
          throw failureFromCatalog(cause);
        }),
      enqueueInvoice: (command: Parameters<typeof catalog.issueInvoice>[0]) =>
        runtime.runPromise(catalog.issueInvoice(command)).catch((cause: unknown) => {
          const failure = failureFromCatalog(cause);
          host.onUploadHalt?.(failure);
          throw failure;
        }),
      poke: () => runtime.runPromise(catalog.poke),
      dispose: async () => {
        await cleanupBoundCollections().catch(() => undefined);
        await runtime.dispose();
      },
    };
  } catch (cause) {
    try {
      await cleanupCollections?.();
      await runtime.dispose();
    } catch {
      // Keep the original startup failure.
    }
    throw cause;
  }
};
