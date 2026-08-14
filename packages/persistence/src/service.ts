import type { SyncStatus } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

import type { AnalyticsStore } from "./analytics/store";
import { makeAnalyticsStore } from "./analytics/store";
import type { PersistenceConfig } from "./config";
import { AuthenticatedWorkspace } from "./config";
import { initializeDatabase } from "./database/bootstrap";
import { makeDatabase } from "./database/client";
import { nodeClientLayer } from "./database/node-client";
import { PersistenceError } from "./errors";
import type { InvoiceStore } from "./inventory/invoice-store";
import { makeInvoiceStore } from "./inventory/invoice-store";
import { makeInventoryMutation, MutationIds } from "./inventory/mutation";
import type { ProductStore } from "./inventory/product-store";
import { makeProductStore } from "./inventory/product-store";
import { makeSyncEngine } from "./sync/engine";

interface SyncMembers {
  readonly getSyncStatus: Effect.Effect<SyncStatus>;
  readonly syncStatusChanges: Stream.Stream<SyncStatus>;
  readonly sync: Effect.Effect<SyncStatus, PersistenceError>;
}

export class OfflineStore extends Context.Service<
  OfflineStore,
  ProductStore & InvoiceStore & AnalyticsStore & SyncMembers
>()("@store/persistence/OfflineStore") {}

const make = (config: PersistenceConfig) =>
  Effect.gen(function* () {
    const workspace = yield* AuthenticatedWorkspace;
    const database = yield* makeDatabase(config);
    yield* initializeDatabase(database, workspace);
    const syncEngine = yield* makeSyncEngine(database, config, workspace);
    const mutation = yield* makeInventoryMutation(database, workspace, syncEngine.signal);
    const productStore = makeProductStore(database, workspace, mutation);
    const invoiceStore = makeInvoiceStore(database, workspace, mutation);
    const analyticsStore = makeAnalyticsStore(database, workspace);

    return OfflineStore.of({
      ...productStore,
      ...invoiceStore,
      ...analyticsStore,
      getSyncStatus: syncEngine.status,
      syncStatusChanges: syncEngine.statusChanges,
      sync: syncEngine.sync,
    });
  });

export const storeLayer = (config: PersistenceConfig) =>
  Layer.effect(OfflineStore, make(config)).pipe(
    Layer.provide(MutationIds.live),
    Layer.provide(AuthenticatedWorkspace.layer(config.workspace ?? AuthenticatedWorkspace.locked)),
  );

export const layer = (config: PersistenceConfig) =>
  storeLayer(config).pipe(Layer.provide(nodeClientLayer(config)));
