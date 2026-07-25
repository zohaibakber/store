import type { SyncStatus } from "@store/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

import type { AnalyticsStore } from "./analytics/store";
import { makeAnalyticsStore } from "./analytics/store";
import type { PersistenceConfig } from "./config";
import { mutationContextFrom } from "./config";
import { initializeDatabase } from "./database/bootstrap";
import { clientLayer, makeDatabase } from "./database/client";
import { InvoiceNotFoundError, PersistenceError, ProductNotFoundError } from "./errors";
import type { InvoiceStore } from "./inventory/invoice-store";
import { makeInvoiceStore } from "./inventory/invoice-store";
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
    const mutationContext = mutationContextFrom(config);
    const database = yield* makeDatabase(config.migrationsFolder);
    yield* initializeDatabase(database, mutationContext());
    const syncEngine = yield* makeSyncEngine(database, config, mutationContext);
    const productStore = makeProductStore(database, mutationContext, syncEngine.signal);
    const invoiceStore = makeInvoiceStore(database, mutationContext, syncEngine.signal);
    const analyticsStore = makeAnalyticsStore(database, mutationContext);

    return OfflineStore.of({
      ...productStore,
      ...invoiceStore,
      ...analyticsStore,
      getSyncStatus: syncEngine.status,
      syncStatusChanges: syncEngine.statusChanges,
      sync: syncEngine.sync,
    });
  });

export const layer = (config: PersistenceConfig) =>
  Layer.effect(OfflineStore, make(config)).pipe(Layer.provide(clientLayer(config)));

export type PublicStoreErrors = PersistenceError | ProductNotFoundError | InvoiceNotFoundError;
