import type { SyncEntity } from "@store/contracts";
import {
  deepEquals,
  getLoadSubsetDemandKey,
  type LoadSubsetFn,
  type LoadSubsetOptions,
  type SyncConfig,
  type SyncConfigRes,
  type UnloadSubsetFn,
} from "@tanstack/db";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberMap from "effect/FiberMap";
import * as Latch from "effect/Latch";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import type { InvoiceCoherenceEntity, InvoiceCoherenceGate } from "./coherence";
import {
  accumulateNotice,
  invalidatedEntities,
  invalidateEverything,
  mergeAccumulators,
  noticeAffects,
  type NoticeAccumulator,
} from "./collection-notices";
import type { PlannedRead } from "./collection-read";
import type { InventoryCollectionSyncMode } from "./sources";
import type {
  InventoryCollectionRow,
  ReplicaCommitNotice,
  ReplicaQueryStamp,
  SqliteCollectionDependencies,
} from "./types";

type SyncParams<Row extends InventoryCollectionRow> = Parameters<
  SyncConfig<Row, string>["sync"]
>[0];

type Acquisition<Row extends InventoryCollectionRow> = {
  readonly key: string;
  readonly read: Effect.Effect<PlannedRead<Row>, unknown>;
  published: boolean;
  refs: number;
  keys: Set<string>;
  rows: Map<string, Row>;
};

type CollectionSyncDescriptor<Row extends InventoryCollectionRow> = {
  readonly getKey: (row: Row) => string;
  readonly id: string;
  readonly syncMode: InventoryCollectionSyncMode;
  readonly coherenceEntity?: InvoiceCoherenceEntity;
};

type CollectionReaders<Row extends InventoryCollectionRow> = {
  readonly subset: (options: LoadSubsetOptions) => Effect.Effect<PlannedRead<Row>, unknown>;
  readonly source: Effect.Effect<PlannedRead<Row>, unknown>;
};

type StampAdoption = "stale" | "current" | "truncate";

const UNCONSTRAINED_DEMAND = "unconstrained";

const SOURCE_DEMAND = "source";

const REFRESH_RETRY = Schedule.min([
  Schedule.exponential("50 millis").pipe(Schedule.jittered),
  Schedule.spaced("5 seconds"),
]);

const attempt = <A>(evaluate: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: evaluate, catch: (cause) => cause });

export const startCollectionSync = <Row extends InventoryCollectionRow>(
  readers: CollectionReaders<Row>,
  descriptor: CollectionSyncDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  params: SyncParams<Row>,
  entity: SyncEntity,
): SyncConfigRes & { readonly loadSubset: LoadSubsetFn; readonly unloadSubset: UnloadSubsetFn } => {
  const lifetime = Scope.makeUnsafe();
  const requests = Effect.runSync(
    FiberMap.make<number, void, unknown>().pipe(Scope.provide(lifetime)),
  );
  const acquisitions = new Map<string, Acquisition<Row>>();
  const owners = new WeakMap<LoadSubsetOptions, Acquisition<Row>>();
  const released = new WeakSet<LoadSubsetOptions>();
  const inflight = new Map<LoadSubsetOptions, number>();
  const rowRefs = new Map<string, number>();
  const serial = Semaphore.makeUnsafe(1);
  const coherence: InvoiceCoherenceGate | undefined = dependencies.coherence;
  let activeToken: string | undefined;
  let activeGeneration: string | undefined;
  let pending: NoticeAccumulator | undefined;
  let listening: Scope.Closeable | undefined;
  let refreshRequested: Latch.Latch | undefined;
  let nextRequest = 0;
  let disposed = false;

  const serialized = <A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> =>
    Semaphore.withPermit(serial, work);

  const enqueueDetached = (failure: string, work: Effect.Effect<void, unknown>): void => {
    Effect.runFork(
      serialized(work).pipe(Effect.catchCause((cause) => Effect.logError(failure, cause))),
    );
  };

  const live = (acquisition: Acquisition<Row>): boolean =>
    !disposed && acquisitions.get(acquisition.key) === acquisition;

  const clearHeld = (): void => {
    rowRefs.clear();
    for (const held of acquisitions.values()) {
      held.keys = new Set();
      held.rows = new Map();
    }
  };

  const adopt = (stamp: ReplicaQueryStamp): StampAdoption => {
    if (disposed) return "stale";
    if (activeToken !== undefined && stamp.workspaceToken !== activeToken) return "stale";
    activeToken = stamp.workspaceToken;
    if (activeGeneration === undefined || activeGeneration === stamp.generationId) {
      activeGeneration = stamp.generationId;
      return "current";
    }
    clearHeld();
    activeGeneration = stamp.generationId;
    return "truncate";
  };

  const wake = (): void => {
    refreshRequested?.openUnsafe();
  };

  const onNotice = (notice: ReplicaCommitNotice): void => {
    if (disposed || !noticeAffects(notice, entity)) return;
    if (activeToken !== undefined && notice.workspaceToken !== activeToken) return;
    pending = accumulateNotice(pending, notice);
    wake();
  };

  const own = (key: string): void => {
    rowRefs.set(key, (rowRefs.get(key) ?? 0) + 1);
  };

  const disown = (key: string): boolean => {
    const next = (rowRefs.get(key) ?? 0) - 1;
    if (next > 0) {
      rowRefs.set(key, next);
      return false;
    }
    rowRefs.delete(key);
    return true;
  };

  const writeWindow = (
    acquisition: Acquisition<Row>,
    nextRows: ReadonlyArray<Row>,
    signal: AbortSignal | undefined,
    truncate: boolean,
  ) => {
    const nextByKey = new Map<string, Row>();
    for (const row of nextRows) nextByKey.set(descriptor.getKey(row), row);
    params.begin();
    if (truncate) params.truncate();
    for (const [key, row] of nextByKey) {
      const existed = rowRefs.has(key);
      const previous = acquisition.rows.get(key);
      if (!acquisition.keys.has(key)) own(key);
      if (existed && previous !== undefined && deepEquals(previous, row)) {
        nextByKey.set(key, previous);
        continue;
      }
      params.write({ type: existed ? "update" : "insert", value: row });
    }
    for (const key of acquisition.keys) {
      if (nextByKey.has(key)) continue;
      if (disown(key)) params.write({ type: "delete", key });
    }
    acquisition.keys = new Set(nextByKey.keys());
    acquisition.rows = nextByKey;
    return params.commit(signal);
  };

  const deleteRows = (keys: ReadonlyArray<string>) => {
    if (keys.length === 0) return undefined;
    params.begin();
    for (const key of keys) params.write({ type: "delete", key });
    return params.commit();
  };

  const releaseRows = (acquisition: Acquisition<Row>) => {
    const deleted: Array<string> = [];
    for (const rowKey of acquisition.keys) {
      if (disown(rowKey)) deleted.push(rowKey);
    }
    acquisition.keys = new Set();
    acquisition.rows = new Map();
    return deleteRows(deleted);
  };

  const publish = (
    acquisition: Acquisition<Row>,
    current: PlannedRead<Row>,
    touchedEntities: ReadonlyArray<SyncEntity>,
    adoption: StampAdoption,
  ): Effect.Effect<void, unknown> => {
    const commit = Effect.tryPromise({
      try: (signal) => {
        if (!live(acquisition)) return Promise.resolve();
        const receipt = writeWindow(
          acquisition,
          current.rows,
          adoption === "truncate" ? undefined : signal,
          adoption === "truncate",
        );
        return Promise.resolve(receipt).then(() => undefined);
      },
      catch: (cause) => cause,
    });
    if (descriptor.coherenceEntity && coherence) {
      const coherenceEntity = descriptor.coherenceEntity;
      return attempt(() =>
        coherence.publish(coherenceEntity, current.stamp, touchedEntities, () =>
          Effect.runPromise(commit),
        ),
      );
    }
    return commit;
  };

  const refill = (
    acquisition: Acquisition<Row>,
    touchedEntities: ReadonlyArray<SyncEntity>,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      if (disposed || activeToken === undefined) return;
      const window = yield* acquisition.read;
      const adoption = adopt(window.stamp);
      if (adoption === "stale") return;
      yield* publish(acquisition, window, touchedEntities, adoption);
    });

  const refreshPending = Effect.suspend(() => {
    if (disposed || acquisitions.size === 0 || pending === undefined) return Effect.void;
    const drained = pending;
    if (drained.workspaceToken !== activeToken) {
      pending = undefined;
      return Effect.void;
    }
    pending = undefined;
    const touched = invalidatedEntities(drained);
    return Effect.partition([...acquisitions.values()], (acquisition) =>
      refill(acquisition, touched),
    ).pipe(
      Effect.flatMap(([, failures]) =>
        failures.length === 0 ? Effect.void : Effect.fail(failures),
      ),
      Effect.onError(() =>
        Effect.sync(() => {
          pending = mergeAccumulators(drained, pending);
        }),
      ),
    );
  });

  const refreshWorker = (latch: Latch.Latch) =>
    Effect.gen(function* () {
      yield* latch.await;
      yield* latch.close;
      yield* serialized(refreshPending).pipe(
        Effect.tapError((failures) =>
          Effect.logWarning("ReplicaCollection.refresh_retry", failures),
        ),
        Effect.retry(REFRESH_RETRY),
      );
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        (cause) => Effect.logError("ReplicaCollection.refresh_failed", cause),
      ),
      Effect.forever,
    );

  const startListening = (): void => {
    if (listening !== undefined || disposed) return;
    const scope = Scope.makeUnsafe();
    const latch = Latch.makeUnsafe(false);
    listening = scope;
    refreshRequested = latch;
    Effect.runSync(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => dependencies.changeFeed.subscribe(onNotice)),
          (unsubscribe) => Effect.sync(unsubscribe),
        );
        if (descriptor.coherenceEntity && coherence) {
          const coherenceEntity = descriptor.coherenceEntity;
          yield* Effect.acquireRelease(
            Effect.sync(() => coherence.registerSource(coherenceEntity)),
            (unregister) => Effect.sync(unregister),
          );
        }
        yield* Effect.forkScoped(refreshWorker(latch));
      }).pipe(Scope.provide(scope)),
    );
  };

  const stopListening = (): void => {
    const scope = listening;
    if (scope === undefined) return;
    listening = undefined;
    refreshRequested = undefined;
    pending = undefined;
    activeToken = undefined;
    activeGeneration = undefined;
    rowRefs.clear();
    Effect.runFork(Scope.close(scope, Exit.void));
  };

  const settle = (): void => {
    if (disposed || descriptor.syncMode !== "on-demand") return;
    if (inflight.size === 0 && acquisitions.size === 0) stopListening();
  };

  const discard = (acquisition: Acquisition<Row>): void => {
    if (acquisitions.get(acquisition.key) !== acquisition) return;
    acquisitions.delete(acquisition.key);
    const receipt = releaseRows(acquisition);
    if (receipt !== undefined) void Promise.resolve(receipt).catch(() => undefined);
  };

  const acquire = (
    key: string,
    read: Effect.Effect<PlannedRead<Row>, unknown>,
    own: (acquisition: Acquisition<Row>) => void,
    forget: () => void,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const current = yield* read;
      const adoption = adopt(current.stamp);
      if (adoption === "stale") return;
      const acquisition: Acquisition<Row> = {
        key,
        read,
        published: false,
        refs: 1,
        keys: new Set(),
        rows: new Map(),
      };
      yield* Effect.suspend(() => {
        acquisitions.set(key, acquisition);
        own(acquisition);
        return publish(acquisition, current, [], adoption);
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.sync(() => {
                forget();
                discard(acquisition);
              }),
        ),
      );
      acquisition.published = true;
      if (adoption === "truncate") {
        pending = invalidateEverything(pending, current.stamp);
        wake();
      } else if (pending !== undefined && pending.version > current.stamp.localCommitVersion) {
        wake();
      }
    });

  const settleRequest = (
    options: LoadSubsetOptions,
    exit: Exit.Exit<void, unknown>,
    resolve: () => void,
    reject: (cause: unknown) => void,
  ): void => {
    inflight.delete(options);
    if (Exit.isFailure(exit) && !Cause.hasInterrupts(exit.cause)) reject(Cause.squash(exit.cause));
    else resolve();
    settle();
  };

  const interruptRequest = (id: number): void => {
    Effect.runFork(FiberMap.remove(requests, id));
  };

  const loadSubset: LoadSubsetFn = (options) => {
    if (disposed || released.has(options) || options.signal?.aborted === true) return true;
    const key = getLoadSubsetDemandKey(options) ?? UNCONSTRAINED_DEMAND;
    const published = acquisitions.get(key);
    if (published?.published && options.refetch !== true) {
      published.refs += 1;
      owners.set(options, published);
      return true;
    }
    startListening();
    const id = (nextRequest += 1);
    const body = serialized(
      Effect.suspend(() => {
        const existing = acquisitions.get(key);
        if (existing) {
          existing.refs += 1;
          owners.set(options, existing);
          if (options.refetch !== true) return Effect.void;
          return refill(existing, []).pipe(
            Effect.onExit((exit) =>
              Exit.isSuccess(exit)
                ? Effect.void
                : Effect.sync(() => {
                    if (owners.get(options) !== existing) return;
                    owners.delete(options);
                    existing.refs -= 1;
                  }),
            ),
          );
        }
        return acquire(
          key,
          readers.subset(options),
          (acquisition) => owners.set(options, acquisition),
          () => owners.delete(options),
        );
      }),
    );
    return new Promise<void>((resolve, reject) => {
      inflight.set(options, id);
      const fiber = Effect.runSync(FiberMap.run(requests, id, body));
      const abort = () => interruptRequest(id);
      options.signal?.addEventListener("abort", abort, { once: true });
      fiber.addObserver((exit) => {
        options.signal?.removeEventListener("abort", abort);
        settleRequest(options, exit, resolve, reject);
      });
    });
  };

  const release = (options: LoadSubsetOptions): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const acquisition = owners.get(options);
      if (disposed || acquisition === undefined) return;
      owners.delete(options);
      acquisition.refs -= 1;
      if (acquisition.refs > 0) return;
      if (acquisitions.get(acquisition.key) === acquisition) acquisitions.delete(acquisition.key);
      const receipt = releaseRows(acquisition);
      if (receipt === undefined) return;
      yield* attempt(async () => {
        await receipt;
      });
    }).pipe(Effect.ensuring(Effect.sync(settle)));

  const unloadSubset: UnloadSubsetFn = (options) => {
    if (released.has(options)) return;
    released.add(options);
    const id = inflight.get(options);
    if (id !== undefined) interruptRequest(id);
    enqueueDetached("ReplicaCollection.unload_failed", release(options));
  };

  if (descriptor.syncMode === "eager") {
    startListening();
    const id = (nextRequest += 1);
    const fiber = Effect.runSync(
      FiberMap.run(
        requests,
        id,
        serialized(
          acquire(
            SOURCE_DEMAND,
            readers.source,
            () => undefined,
            () => undefined,
          ),
        ),
      ),
    );
    fiber.addObserver((exit) => {
      if (disposed) return;
      if (Exit.isSuccess(exit)) params.markReady();
      else if (!Cause.hasInterrupts(exit.cause)) params.markError(Cause.squash(exit.cause));
    });
  } else {
    params.markReady();
  }

  return {
    loadSubset,
    unloadSubset,
    cleanup: () => {
      disposed = true;
      const scope = listening;
      listening = undefined;
      refreshRequested = undefined;
      pending = undefined;
      activeToken = undefined;
      activeGeneration = undefined;
      acquisitions.clear();
      rowRefs.clear();
      inflight.clear();
      if (scope !== undefined) Effect.runFork(Scope.close(scope, Exit.void));
      Effect.runFork(Scope.close(lifetime, Exit.void));
    },
  };
};
