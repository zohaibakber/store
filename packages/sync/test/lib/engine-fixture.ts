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
import { SyncTransport } from "../../src/transport";
import { TestCrypto } from "./crypto";

export const stubTransport = (overrides: Partial<SyncTransport["Service"]> = {}) =>
  Layer.mock(SyncTransport, overrides);

const dependencies = (store: ReplicaStore["Service"], transport: Layer.Layer<SyncTransport>) =>
  Layer.mergeAll(Layer.succeed(ReplicaStore, store), transport, TestCrypto);

const withFreshState = <A, E, R>(layer: Layer.Layer<A, E, R>) =>
  layer.pipe(Layer.provide(Layer.fresh(SyncStateRef.layer)));

export const engineOf = (
  store: ReplicaStore["Service"],
  transport: Layer.Layer<SyncTransport>,
  options?: Parameters<typeof SyncEngine.layer>[0],
) =>
  Layer.build(
    withFreshState(SyncEngine.layer(options)).pipe(Layer.provide(dependencies(store, transport))),
  ).pipe(Effect.map((context) => Context.get(context, SyncEngine)));

export const sqliteEngine = (handle: SqliteReplicaHandle, transport: Layer.Layer<SyncTransport>) =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    return yield* engineOf(store, transport);
  });

export const sqliteScheduler = (
  handle: SqliteReplicaHandle,
  transport: Layer.Layer<SyncTransport>,
  policy: SyncSchedulerPolicy,
  options?: SyncSchedulerOptions,
) =>
  Effect.gen(function* () {
    const store = yield* makeSqliteReplicaStore(handle, "sqlite");
    const context = yield* Layer.build(
      SyncScheduler.layer(policy, options).pipe(
        Layer.provideMerge(SyncEngine.layer()),
        Layer.provide(dependencies(store, transport)),
        Layer.provide(SyncStateRef.layer),
      ),
    );
    return Context.get(context, SyncScheduler);
  });
