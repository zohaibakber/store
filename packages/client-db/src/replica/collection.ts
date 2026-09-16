import type {
  LoadSubsetFn,
  LoadSubsetOptions,
  SyncConfig,
  SyncConfigRes,
  UnloadSubsetFn,
} from "@tanstack/db";
import * as Effect from "effect/Effect";

import { compileSqliteSubset } from "./compile";
import { SOURCE_ENTITY } from "./sources";
import type {
  InventoryCollectionDescriptor,
  InventoryCollectionRow,
  InventoryProjectionDescriptor,
  ReplicaCommitNotice,
  ReplicaQueryStamp,
  SqliteCollectionConfig,
  SqliteCollectionDependencies,
  SqliteSubsetPlan,
} from "./types";

type SyncParams<Row extends InventoryCollectionRow> = Parameters<
  SyncConfig<Row, string>["sync"]
>[0];

type Acquisition = {
  readonly options: LoadSubsetOptions;
  keys: Set<string>;
};

type PlannedRead<Row extends InventoryCollectionRow> = {
  readonly stamp: ReplicaQueryStamp;
  readonly rows: ReadonlyArray<Row>;
};

const increment = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

const decrement = (counts: Map<string, number>, key: string): number => {
  const next = (counts.get(key) ?? 0) - 1;
  if (next <= 0) {
    counts.delete(key);
    return 0;
  }
  counts.set(key, next);
  return next;
};

const readPlan = async <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row> | InventoryProjectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
  plan: Pick<SqliteSubsetPlan, "sql" | "parameters">,
): Promise<PlannedRead<Row>> => {
  const stamp = await dependencies.executor.stamp();
  const raw = await dependencies.executor.query(plan.sql, plan.parameters);
  const rows = Effect.runSync(descriptor.decodeRows(raw));
  return { stamp, rows };
};

const publishWindow = <Row extends InventoryCollectionRow>(
  params: SyncParams<Row>,
  descriptor: { readonly getKey: (row: Row) => string },
  previousKeys: ReadonlySet<string>,
  nextRows: ReadonlyArray<Row>,
  rowRefs: Map<string, number>,
  signal?: AbortSignal,
) => {
  const nextKeys = new Set<string>();
  const nextByKey = new Map<string, Row>();
  for (const row of nextRows) {
    const key = descriptor.getKey(row);
    nextKeys.add(key);
    nextByKey.set(key, row);
  }

  params.begin();
  for (const key of nextKeys) {
    const row = nextByKey.get(key);
    if (row === undefined) continue;
    const existed = rowRefs.has(key);
    increment(rowRefs, key);
    if (previousKeys.has(key)) decrement(rowRefs, key);
    params.write({ type: existed ? "update" : "insert", value: row });
  }
  for (const key of previousKeys) {
    if (nextKeys.has(key)) continue;
    if (decrement(rowRefs, key) === 0) params.write({ type: "delete", key });
  }
  return { keys: nextKeys, receipt: params.commit(signal) };
};

const startCollectionSync = <Row extends InventoryCollectionRow>(
  readCurrent: (options: LoadSubsetOptions) => Promise<PlannedRead<Row>>,
  descriptor: { readonly getKey: (row: Row) => string; readonly id: string },
  dependencies: SqliteCollectionDependencies,
  params: SyncParams<Row>,
  relevant: (notice: ReplicaCommitNotice) => boolean,
): SyncConfigRes & { readonly loadSubset: LoadSubsetFn; readonly unloadSubset: UnloadSubsetFn } => {
  const acquisitions = new Map<LoadSubsetOptions, Acquisition>();
  const rowRefs = new Map<string, number>();
  let activeToken: string | undefined;
  let activeGeneration: string | undefined;
  const queued: Array<ReplicaCommitNotice> = [];
  let syncStarted = false;
  let disposed = false;
  let chain: Promise<void> = Promise.resolve();

  const enqueue = (work: () => Promise<void>): Promise<void> => {
    const next = chain.then(work, work);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const fenced = (notice: ReplicaCommitNotice): boolean =>
    !disposed &&
    activeToken !== undefined &&
    activeGeneration !== undefined &&
    notice.workspaceToken === activeToken &&
    notice.generationId === activeGeneration;

  const refillAcquisition = async (
    acquisition: Acquisition,
    signal?: AbortSignal,
  ): Promise<void> => {
    if (disposed || activeToken === undefined) return;
    const current = await readCurrent(acquisition.options);
    if (current.stamp.workspaceToken !== activeToken) return;
    if (current.stamp.generationId !== activeGeneration) {
      params.truncate();
      rowRefs.clear();
      for (const held of acquisitions.values()) held.keys = new Set();
      activeGeneration = current.stamp.generationId;
    }
    const published = publishWindow(
      params,
      descriptor,
      acquisition.keys,
      current.rows,
      rowRefs,
      signal,
    );
    acquisition.keys = published.keys;
    await published.receipt;
  };

  const replay = async (fromVersion: number, signal?: AbortSignal): Promise<void> => {
    const notices = queued.splice(0);
    let version = fromVersion;
    for (const notice of notices) {
      if (!fenced(notice) || !relevant(notice)) continue;
      if (notice.localCommitVersion <= version) continue;
      version = notice.localCommitVersion;
      for (const acquisition of acquisitions.values()) {
        await refillAcquisition(acquisition, signal);
      }
    }
  };

  const unsubscribe = dependencies.changeFeed.subscribe((notice) => {
    if (disposed) return;
    if (activeToken === undefined || !syncStarted) {
      queued.push(notice);
      return;
    }
    if (!fenced(notice) || !relevant(notice)) return;
    void enqueue(async () => {
      for (const acquisition of acquisitions.values()) {
        await refillAcquisition(acquisition);
      }
    });
  });

  const loadSubset: LoadSubsetFn = (options) =>
    enqueue(async () => {
      if (disposed) return;
      const existing = acquisitions.get(options);
      if (existing) {
        await refillAcquisition(existing, options.signal);
        return;
      }
      const current = await readCurrent(options);
      activeToken = current.stamp.workspaceToken;
      activeGeneration = current.stamp.generationId;
      const published = publishWindow(
        params,
        descriptor,
        new Set(),
        current.rows,
        rowRefs,
        options.signal,
      );
      acquisitions.set(options, {
        options,
        keys: published.keys,
      });
      await published.receipt;
      await replay(current.stamp.localCommitVersion, options.signal);
      syncStarted = true;
    });

  const unloadSubset: UnloadSubsetFn = (options) => {
    const acquisition = acquisitions.get(options);
    if (!acquisition) return;
    acquisitions.delete(options);
    params.begin();
    for (const key of acquisition.keys) {
      if (decrement(rowRefs, key) === 0) params.write({ type: "delete", key });
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
      queued.length = 0;
      acquisitions.clear();
      rowRefs.clear();
      unsubscribe();
    },
  };
};

export const sqliteCollectionOptions = <Row extends InventoryCollectionRow>(
  descriptor: InventoryCollectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
): SqliteCollectionConfig<Row> => {
  let started: SyncConfigRes | undefined;

  const loadSubset: LoadSubsetFn = (options) => {
    const api = started?.loadSubset;
    if (!api) throw new Error("Sqlite collection sync has not started.");
    return api(options);
  };
  const unloadSubset: UnloadSubsetFn = (options) => {
    started?.unloadSubset?.(options);
  };

  return {
    id: descriptor.id,
    getKey: descriptor.getKey,
    syncMode: descriptor.syncMode,
    startSync: false,
    sync: {
      rowUpdateMode: "full",
      sync: (params) => {
        const api = startCollectionSync(
          (options) => {
            const plan = Effect.runSync(compileSqliteSubset(descriptor, options));
            return readPlan(descriptor, dependencies, plan);
          },
          descriptor,
          dependencies,
          params,
          (notice) => notice.touchedEntities.includes(SOURCE_ENTITY[descriptor.source]),
        );
        started = api;
        if (descriptor.syncMode === "eager") {
          void api.loadSubset({ limit: descriptor.maximumRows });
        }
        return api;
      },
    },
    utils: { loadSubset, unloadSubset },
  };
};

export const projectionCollectionOptions = <Row extends InventoryCollectionRow>(
  descriptor: InventoryProjectionDescriptor<Row>,
  dependencies: SqliteCollectionDependencies,
): SqliteCollectionConfig<Row> => {
  let started: SyncConfigRes | undefined;
  const plan = {
    sql: descriptor.sql,
    parameters: descriptor.parameters,
  };

  const loadSubset: LoadSubsetFn = (options) => {
    const api = started?.loadSubset;
    if (!api) throw new Error("Sqlite collection sync has not started.");
    return api(options);
  };
  const unloadSubset: UnloadSubsetFn = (options) => {
    started?.unloadSubset?.(options);
  };

  return {
    id: descriptor.id,
    getKey: descriptor.getKey,
    syncMode: "on-demand",
    startSync: false,
    sync: {
      rowUpdateMode: "full",
      sync: (params) => {
        const api = startCollectionSync(
          () => readPlan(descriptor, dependencies, plan),
          descriptor,
          dependencies,
          params,
          (notice) =>
            notice.touchedEntities.some((entity) => descriptor.touchedEntities.includes(entity)),
        );
        started = api;
        return api;
      },
    },
    utils: { loadSubset, unloadSubset },
  };
};
