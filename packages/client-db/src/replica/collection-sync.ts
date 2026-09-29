import type { SyncEntity } from "@store/contracts";
import {
  getLoadSubsetDemandKey,
  type LoadSubsetFn,
  type LoadSubsetOptions,
  type SyncConfig,
  type SyncConfigRes,
  type UnloadSubsetFn,
} from "@tanstack/db";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Semaphore from "effect/Semaphore";

import type { InvoiceCoherenceEntity, InvoiceCoherenceGate } from "./coherence";
import { decrementRowRef, publishSubsetWindow } from "./collection-publish";
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
  readonly read: () => Promise<PlannedRead<Row>>;
  readonly windowed: boolean;
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

export type CollectionReaders<Row extends InventoryCollectionRow> = {
  readonly subset: (options: LoadSubsetOptions) => Promise<PlannedRead<Row>>;
  readonly source: () => Promise<PlannedRead<Row>>;
  readonly keys: (keys: ReadonlyArray<string>) => Promise<ReadonlyArray<PlannedRead<Row>>>;
};

type StampAdoption = "stale" | "current" | "truncate";

const UNCONSTRAINED_DEMAND = "unconstrained";

const SOURCE_DEMAND = "source";

export const startCollectionSync = <Row extends InventoryCollectionRow>(
  readers: CollectionReaders<Row>,
  descriptor: CollectionSyncDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  params: SyncParams<Row>,
  relevant: (notice: ReplicaCommitNotice) => boolean,
): SyncConfigRes & { readonly loadSubset: LoadSubsetFn; readonly unloadSubset: UnloadSubsetFn } => {
  const acquisitions = new Map<string, Acquisition<Row>>();
  const owners = new WeakMap<LoadSubsetOptions, Acquisition<Row>>();
  const released = new WeakSet<LoadSubsetOptions>();
  const rowRefs = new Map<string, number>();
  let activeToken: string | undefined;
  let activeGeneration: string | undefined;
  const queued: Array<ReplicaCommitNotice> = [];
  let syncStarted = false;
  let disposed = false;
  const serial = Semaphore.makeUnsafe(1);
  const refreshRequested = Latch.makeUnsafe(false);
  const coherence: InvoiceCoherenceGate | undefined = dependencies.coherence;
  const unregisterCoherence =
    descriptor.coherenceEntity && coherence
      ? coherence.registerSource(descriptor.coherenceEntity)
      : undefined;
  let lastTouched: ReadonlyArray<SyncEntity> = [];

  const serialized = (work: () => Promise<void>): Effect.Effect<void> =>
    Semaphore.withPermit(
      serial,
      Effect.tryPromise({
        try: work,
        catch: (cause) => cause,
      }).pipe(Effect.orDie),
    );

  const enqueue = (work: () => Promise<void>): Promise<void> => Effect.runPromise(serialized(work));

  const enqueueDetached = (failure: string, work: () => Promise<void>): void => {
    Effect.runFork(
      serialized(work).pipe(Effect.catchCause((cause) => Effect.logError(failure, cause))),
    );
  };

  const fenced = (notice: ReplicaCommitNotice): boolean =>
    !disposed && activeToken !== undefined && notice.workspaceToken === activeToken;

  const adopt = (stamp: ReplicaQueryStamp): StampAdoption => {
    if (disposed) return "stale";
    if (activeToken !== undefined && stamp.workspaceToken !== activeToken) return "stale";
    activeToken = stamp.workspaceToken;
    if (activeGeneration === undefined || activeGeneration === stamp.generationId) {
      activeGeneration = stamp.generationId;
      return "current";
    }
    rowRefs.clear();
    for (const held of acquisitions.values()) {
      held.keys = new Set();
      held.rows = new Map();
    }
    activeGeneration = stamp.generationId;
    return "truncate";
  };

  const applyPublished = async (
    acquisition: Acquisition<Row>,
    current: PlannedRead<Row>,
    touchedEntities: ReadonlyArray<SyncEntity>,
    adoption: StampAdoption,
    signal?: AbortSignal,
  ): Promise<void> => {
    const run = async () => {
      const published = publishSubsetWindow(
        params,
        descriptor,
        acquisition.keys,
        acquisition.rows,
        current.rows,
        rowRefs,
        adoption === "truncate" ? undefined : signal,
        adoption === "truncate",
      );
      acquisition.keys = published.keys;
      acquisition.rows = published.rows;
      await published.receipt;
    };
    if (descriptor.coherenceEntity && coherence) {
      await coherence.publish(descriptor.coherenceEntity, current.stamp, touchedEntities, run);
      return;
    }
    await run();
  };

  const withRetainedRows = async (
    acquisition: Acquisition<Row>,
    window: PlannedRead<Row>,
  ): Promise<PlannedRead<Row>> => {
    if (!acquisition.windowed) return window;
    const shown = new Set(window.rows.map(descriptor.getKey));
    const departed = [...acquisition.keys].filter((key) => !shown.has(key));
    if (departed.length === 0) return window;
    const retained = await readers.keys(departed);
    if (retained.some((read) => read.stamp.generationId !== window.stamp.generationId)) {
      return window;
    }
    return {
      stamp: window.stamp,
      rows: [...window.rows, ...retained.flatMap((read) => read.rows)],
    };
  };

  const refill = async (
    acquisition: Acquisition<Row>,
    touchedEntities: ReadonlyArray<SyncEntity>,
  ): Promise<StampAdoption> => {
    if (disposed || activeToken === undefined) return "stale";
    const current = await withRetainedRows(acquisition, await acquisition.read());
    const adoption = adopt(current.stamp);
    if (adoption === "stale") return adoption;
    await applyPublished(acquisition, current, touchedEntities, adoption);
    return adoption;
  };

  const refreshAcquisitions = async (touchedEntities: ReadonlyArray<SyncEntity>) => {
    for (const acquisition of acquisitions.values()) {
      if ((await refill(acquisition, touchedEntities)) === "truncate") return;
    }
  };

  const refreshWorker = Effect.gen(function* () {
    yield* refreshRequested.await;
    yield* refreshRequested.close;
    yield* serialized(() => refreshAcquisitions(lastTouched));
  }).pipe(
    Effect.catchCauseIf(
      (cause) => !Cause.hasInterrupts(cause),
      (cause) => Effect.logError("ReplicaCollection.refresh_failed", cause),
    ),
    Effect.forever,
    Effect.runFork,
  );

  const replay = async (fromVersion: number): Promise<void> => {
    const notices = queued.splice(0);
    let version = fromVersion;
    for (const notice of notices) {
      if (!fenced(notice) || !relevant(notice)) continue;
      if (notice.localCommitVersion <= version) continue;
      version = notice.localCommitVersion;
      lastTouched = notice.touchedEntities;
    }
    if (version > fromVersion) await refreshAcquisitions(lastTouched);
  };

  const acquire = async (
    key: string,
    read: () => Promise<PlannedRead<Row>>,
    windowed: boolean,
    cancelled: () => boolean,
    own: (acquisition: Acquisition<Row>) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const current = await read();
    if (cancelled()) return;
    const adoption = adopt(current.stamp);
    if (adoption === "stale") return;
    const acquisition: Acquisition<Row> = {
      key,
      read,
      windowed,
      published: false,
      refs: 1,
      keys: new Set(),
      rows: new Map(),
    };
    acquisitions.set(key, acquisition);
    own(acquisition);
    await applyPublished(acquisition, current, [], adoption, signal);
    acquisition.published = true;
    await replay(current.stamp.localCommitVersion);
    syncStarted = true;
  };

  const beginListeningForCommits = (): (() => void) =>
    dependencies.changeFeed.subscribe((notice) => {
      if (disposed) return;
      if (activeToken === undefined || !syncStarted) {
        queued.push(notice);
        return;
      }
      if (!fenced(notice) || !relevant(notice)) return;
      lastTouched = notice.touchedEntities;
      refreshRequested.openUnsafe();
    });

  const unsubscribe = beginListeningForCommits();

  const loadSubset: LoadSubsetFn = (options) => {
    const key = getLoadSubsetDemandKey(options) ?? UNCONSTRAINED_DEMAND;
    const cancelled = () => disposed || released.has(options) || options.signal?.aborted === true;
    const published = acquisitions.get(key);
    if (published?.published && !cancelled()) {
      published.refs += 1;
      owners.set(options, published);
      return true;
    }
    return enqueue(async () => {
      if (cancelled()) return;
      const existing = acquisitions.get(key);
      if (existing) {
        existing.refs += 1;
        owners.set(options, existing);
        return;
      }
      await acquire(
        key,
        () => readers.subset(options),
        options.limit !== undefined,
        cancelled,
        (acquisition) => owners.set(options, acquisition),
        options.signal,
      );
    });
  };

  const unloadSubset: UnloadSubsetFn = (options) => {
    if (released.has(options)) return;
    released.add(options);
    enqueueDetached("ReplicaCollection.unload_failed", async () => {
      const acquisition = owners.get(options);
      if (disposed || acquisition === undefined) return;
      owners.delete(options);
      acquisition.refs -= 1;
      if (acquisition.refs > 0) return;
      if (acquisitions.get(acquisition.key) === acquisition) acquisitions.delete(acquisition.key);
      const deleted: Array<string> = [];
      for (const rowKey of acquisition.keys) {
        if (decrementRowRef(rowRefs, rowKey) === 0) deleted.push(rowKey);
      }
      if (deleted.length === 0) return;
      params.begin();
      for (const rowKey of deleted) params.write({ type: "delete", key: rowKey });
      await params.commit();
    });
  };

  if (descriptor.syncMode === "eager") {
    Effect.runFork(
      serialized(() =>
        acquire(
          SOURCE_DEMAND,
          readers.source,
          false,
          () => disposed,
          () => undefined,
        ),
      ).pipe(
        Effect.matchCause({
          onSuccess: () => {
            if (!disposed) params.markReady();
          },
          onFailure: (cause) => {
            if (!disposed) params.markError(Cause.squash(cause));
          },
        }),
      ),
    );
  } else {
    params.markReady();
  }

  return {
    loadSubset,
    unloadSubset,
    cleanup: () => {
      disposed = true;
      activeToken = undefined;
      activeGeneration = undefined;
      refreshWorker.interruptUnsafe();
      queued.length = 0;
      acquisitions.clear();
      rowRefs.clear();
      unregisterCoherence?.();
      unsubscribe();
    },
  };
};
