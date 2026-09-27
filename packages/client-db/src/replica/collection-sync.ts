import type { SyncEntity } from "@store/contracts";
import type {
  LoadSubsetFn,
  LoadSubsetOptions,
  SyncConfig,
  SyncConfigRes,
  UnloadSubsetFn,
} from "@tanstack/db";
import * as Effect from "effect/Effect";
import * as TxSemaphore from "effect/TxSemaphore";

import type { InvoiceCoherenceEntity, InvoiceCoherenceGate } from "./coherence";
import { decrementRowRef, publishSubsetWindow } from "./collection-publish";
import type { PlannedRead } from "./collection-read";
import { subsetWindowKey } from "./subset-window";
import type {
  InventoryCollectionRow,
  ReplicaCommitNotice,
  SqliteCollectionDependencies,
} from "./types";

type SyncParams<Row extends InventoryCollectionRow> = Parameters<
  SyncConfig<Row, string>["sync"]
>[0];

type Acquisition<Row extends InventoryCollectionRow> = {
  readonly key: string;
  readonly options: LoadSubsetOptions;
  refs: number;
  keys: Set<string>;
  rows: Map<string, Row>;
};

type CollectionSyncDescriptor<Row extends InventoryCollectionRow> = {
  readonly getKey: (row: Row) => string;
  readonly id: string;
  readonly coherenceEntity?: InvoiceCoherenceEntity;
};

export const startCollectionSync = <Row extends InventoryCollectionRow>(
  readCurrent: (options: LoadSubsetOptions) => Promise<PlannedRead<Row>>,
  descriptor: CollectionSyncDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  params: SyncParams<Row>,
  relevant: (notice: ReplicaCommitNotice) => boolean,
): SyncConfigRes & { readonly loadSubset: LoadSubsetFn; readonly unloadSubset: UnloadSubsetFn } => {
  const acquisitions = new Map<string, Acquisition<Row>>();
  const rowRefs = new Map<string, number>();
  let activeToken: string | undefined;
  let activeGeneration: string | undefined;
  const queued: Array<ReplicaCommitNotice> = [];
  let syncStarted = false;
  let disposed = false;
  const serial = Effect.runSync(TxSemaphore.make(1));
  let coalesceTarget: number | undefined;
  let coalesceRunning = false;
  const coherence: InvoiceCoherenceGate | undefined = dependencies.coherence;
  const unregisterCoherence =
    descriptor.coherenceEntity && coherence
      ? coherence.registerSource(descriptor.coherenceEntity)
      : undefined;
  let lastTouched: ReadonlyArray<SyncEntity> = [];

  const enqueue = (work: () => Promise<void>): Promise<void> =>
    Effect.runPromise(
      TxSemaphore.withPermit(serial)(
        Effect.tryPromise({
          try: work,
          catch: (cause) => cause,
        }).pipe(Effect.orDie),
      ),
    );

  const fenced = (notice: ReplicaCommitNotice): boolean =>
    !disposed &&
    activeToken !== undefined &&
    activeGeneration !== undefined &&
    notice.workspaceToken === activeToken &&
    notice.generationId === activeGeneration;

  const applyPublished = async (
    acquisition: Acquisition<Row>,
    current: PlannedRead<Row>,
    touchedEntities: ReadonlyArray<SyncEntity>,
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
        signal,
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

  const refillAcquisition = async (
    acquisition: Acquisition<Row>,
    touchedEntities: ReadonlyArray<SyncEntity> = [],
    signal?: AbortSignal,
  ): Promise<void> => {
    if (disposed || activeToken === undefined) return;
    const current = await readCurrent(acquisition.options);
    if (current.stamp.workspaceToken !== activeToken) return;
    if (current.stamp.generationId !== activeGeneration) {
      params.truncate();
      rowRefs.clear();
      for (const held of acquisitions.values()) {
        held.keys = new Set();
        held.rows = new Map();
      }
      activeGeneration = current.stamp.generationId;
    }
    await applyPublished(acquisition, current, touchedEntities, signal);
  };

  const drainCoalesced = async (): Promise<void> => {
    if (coalesceRunning) return;
    coalesceRunning = true;
    try {
      while (coalesceTarget !== undefined && !disposed) {
        coalesceTarget = undefined;
        const touched = lastTouched;
        for (const acquisition of acquisitions.values()) {
          await refillAcquisition(acquisition, touched);
        }
      }
    } finally {
      coalesceRunning = false;
      if (coalesceTarget !== undefined && !disposed) {
        void enqueue(async () => {
          await drainCoalesced();
        });
      }
    }
  };

  const requestCoalescedRefresh = (version: number, touchedEntities: ReadonlyArray<SyncEntity>) => {
    lastTouched = touchedEntities;
    if (coalesceTarget !== undefined && coalesceTarget >= version) return;
    coalesceTarget = version;
    void enqueue(async () => {
      await drainCoalesced();
    });
  };

  const replay = async (fromVersion: number, signal?: AbortSignal): Promise<void> => {
    const notices = queued.splice(0);
    let version = fromVersion;
    for (const notice of notices) {
      if (!fenced(notice) || !relevant(notice)) continue;
      if (notice.localCommitVersion <= version) continue;
      version = notice.localCommitVersion;
      lastTouched = notice.touchedEntities;
    }
    if (version > fromVersion) {
      for (const acquisition of acquisitions.values()) {
        await refillAcquisition(acquisition, lastTouched, signal);
      }
    }
  };

  const beginListeningForCommits = (): (() => void) =>
    dependencies.changeFeed.subscribe((notice) => {
      if (disposed) return;
      if (activeToken === undefined || !syncStarted) {
        queued.push(notice);
        return;
      }
      if (!fenced(notice) || !relevant(notice)) return;
      requestCoalescedRefresh(notice.localCommitVersion, notice.touchedEntities);
    });

  const unsubscribe = beginListeningForCommits();

  const loadSubset: LoadSubsetFn = (options) =>
    enqueue(async () => {
      if (disposed) return;
      if (options.signal?.aborted) return;
      const key = subsetWindowKey(options);
      const existing = acquisitions.get(key);
      if (existing) {
        existing.refs += 1;
        await refillAcquisition(existing, lastTouched, options.signal);
        return;
      }
      const current = await readCurrent(options);
      if (options.signal?.aborted) return;
      if (activeToken !== undefined && current.stamp.workspaceToken !== activeToken) {
        return;
      }
      activeToken = current.stamp.workspaceToken;
      activeGeneration = current.stamp.generationId;
      const acquisition: Acquisition<Row> = {
        key,
        options,
        refs: 1,
        keys: new Set(),
        rows: new Map(),
      };
      await applyPublished(acquisition, current, [], options.signal);
      acquisitions.set(key, acquisition);
      await replay(current.stamp.localCommitVersion, options.signal);
      syncStarted = true;
    });

  const unloadSubset: UnloadSubsetFn = (options) => {
    const key = subsetWindowKey(options);
    const acquisition = acquisitions.get(key);
    if (!acquisition) return;
    acquisition.refs -= 1;
    if (acquisition.refs > 0) return;
    acquisitions.delete(key);
    params.begin();
    for (const rowKey of acquisition.keys) {
      if (decrementRowRef(rowRefs, rowKey) === 0) params.write({ type: "delete", key: rowKey });
    }
    void params.commit();
  };

  params.markReady();

  return {
    loadSubset,
    unloadSubset,
    cleanup: () => {
      disposed = true;
      activeToken = undefined;
      activeGeneration = undefined;
      coalesceTarget = undefined;
      queued.length = 0;
      acquisitions.clear();
      rowRefs.clear();
      unregisterCoherence?.();
      unsubscribe();
    },
  };
};
