import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { SyncEngine } from "../../src/engine";
import type { SqliteReplicaHandle } from "../../src/replica/sql-client/handle";
import { makeSqliteReplicaStore } from "../../src/replica/sqlite/store";
import { ReplicaStore } from "../../src/replica/store";
import {
  SyncScheduler,
  type SyncSchedulerOptions,
  type SyncSchedulerPolicy,
} from "../../src/scheduler";
import { SyncStateRef } from "../../src/sync-state";
import { SyncTransportService, type SyncTransport } from "../../src/transport";
import { TestCrypto } from "./crypto";

export const stubTransport = (overrides: Partial<SyncTransport> = {}): SyncTransport => ({
  registerReplica: () => Effect.die("unused"),
  submitCommand: () => Effect.die("unused"),
  getReceipt: () => Effect.die("unused"),
  pull: () => Effect.die("unused"),
  acquireSnapshot: () => Effect.die("unused"),
  readSnapshotPart: () => Effect.die("unused"),
  ...overrides,
});

const dependencies = (store: ReplicaStore["Service"], transport: SyncTransport) =>
  Layer.mergeAll(
    Layer.succeed(ReplicaStore, store),
    Layer.succeed(SyncTransportService, transport),
    TestCrypto,
  );

export const engineOf = (
  store: ReplicaStore["Service"],
  transport: SyncTransport,
  options?: Parameters<typeof SyncEngine.layer>[0],
) =>
  Layer.build(SyncEngine.layer(options).pipe(Layer.provide(dependencies(store, transport)))).pipe(
    Effect.map((context) => Context.get(context, SyncEngine)),
    Effect.scoped,
  );

export const sqliteEngine = (handle: SqliteReplicaHandle, transport: SyncTransport) =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    return yield* engineOf(store, transport);
  });

export const sqliteScheduler = (
  handle: SqliteReplicaHandle,
  transport: SyncTransport,
  policy: SyncSchedulerPolicy,
  options?: SyncSchedulerOptions,
) =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    const context = yield* Layer.build(
      SyncScheduler.layer(policy, options).pipe(
        Layer.provideMerge(SyncEngine.layerShared()),
        Layer.provide(dependencies(store, transport)),
        Layer.provide(SyncStateRef.layer),
      ),
    );
    return Context.get(context, SyncScheduler);
  });
