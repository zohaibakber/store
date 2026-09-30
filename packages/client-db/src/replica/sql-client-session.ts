import type {
  CommandStatus,
  EnqueueCommandRequest,
  ReplicaInsightsWindow,
  SyncEntity,
} from "@store/contracts";
import { replicaState } from "@store/db/replica.schema";
import {
  layerOwnedHttpSync,
  ReplicaStore,
  SyncEngine,
  SyncScheduler,
  SyncTransportService,
  type OwnedLiveHost,
  type ReplicaOutboxActivity,
  type SyncSchedulerPolicy,
  type SyncWakeReason,
} from "@store/sync/browser";
import {
  layerSqliteReplicaStore,
  readOutboxActivitySqlite,
  readPendingRowIdsSqlite,
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { layerCommitForwarding } from "./commit-forwarding";
import { readSqliteInsightsFacts } from "./insights-sqlite";
import { makeReplicaLifetime } from "./lifetime";
import { readOutboxStatusesSqlite } from "./node-outbox";
import { createReplicaCommitPublisher } from "./publisher";
import { replicaStampQuery } from "./replica-queries";
import {
  layerHandleSnapshotReader,
  ReplicaSnapshotReader,
  readSnapshotBatch,
  readSnapshotSubset,
  readSnapshotSummary,
  snapshotRunnerFromHandle,
  type ReplicaSnapshotRunner,
} from "./snapshot-read";
import {
  decodeReplicaStampRow,
  decodeSqliteResultRow,
  type OutboxCommandStatus,
  type ReplicaRow,
} from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type { InventorySubsetSpec, InventorySubsetSummarySpec } from "./subset-spec";
import { subscribeSchedulerHealth } from "./sync-health";
import type {
  EnqueuedCommand,
  ReplicaCommitNotice,
  ReplicaInsightsRead,
  ReplicaInsightsReader,
  ReplicaQueryStamp,
  ReplicaReadOptions,
  ReplicaSummaryReader,
  ReplicaSubsetReader,
  SqliteParameter,
  SqliteResultRow,
} from "./types";
import { bootWorkspaceRuntime } from "./workspace-runtime";

export type SqliteReplicaIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export const readReplicaStamp = Effect.fn("ReplicaNodeSqlite.readStamp")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
) {
  const rows = yield* handle.db.all(replicaStampQuery);
  const decoded = decodeReplicaStampRow(rows[0]);
  return {
    workspaceToken,
    generationId: String(decoded.generation),
    localCommitVersion: decoded.version,
  } satisfies ReplicaQueryStamp;
});

export const runReplicaQuery = Effect.fn("ReplicaNodeSqlite.query")(function* (
  handle: SqliteReplicaHandle,
  sql: string,
  parameters: ReadonlyArray<SqliteParameter>,
) {
  const rows = yield* handle.sql.unsafe(sql, parameters);
  return rows.map((row) => decodeSqliteResultRow(row)) satisfies ReadonlyArray<SqliteResultRow>;
});

export const readReplicaSubset = (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
  spec: InventorySubsetSpec,
) => readSnapshotSubset(snapshotRunnerFromHandle(handle), workspaceToken, spec);

export const readReplicaInsights = Effect.fn("ReplicaNodeSqlite.readInsights")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
  window: ReplicaInsightsWindow,
) {
  return yield* runReplicaTransaction(handle, () =>
    Effect.gen(function* () {
      const stamp = yield* readReplicaStamp(handle, workspaceToken);
      const facts = yield* readSqliteInsightsFacts(handle, window);
      return { stamp, facts } satisfies ReplicaInsightsRead;
    }),
  );
});

export const readReplicaSummary = (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
  spec: InventorySubsetSummarySpec,
) => readSnapshotSummary(snapshotRunnerFromHandle(handle), workspaceToken, spec);

export const seedReplicaIdentity = Effect.fn("ReplicaNodeSqlite.seedIdentity")(function* (
  handle: SqliteReplicaHandle,
  identity: SqliteReplicaIdentity,
) {
  const existing = yield* handle.db
    .select({ id: replicaState.id })
    .from(replicaState)
    .where(eq(replicaState.id, "singleton"))
    .all();
  if (existing.length > 0) return;
  yield* handle.db.insert(replicaState).values({
    id: "singleton",
    organizationId: identity.organizationId,
    userId: identity.userId,
    replicaId: identity.replicaId,
    epoch: "1",
    incarnation: "local",
    appliedCommitSequence: "0",
    nextClientSequence: "1",
    localCommitVersion: 0,
    activeGeneration: 1,
  });
});

export const layerSeededReplica = <E, R>(
  replica: Layer.Layer<SqliteReplica, E, R>,
  identity: SqliteReplicaIdentity,
): Layer.Layer<SqliteReplica, E, R> =>
  Layer.effectDiscard(
    SqliteReplica.use((handle) => seedReplicaIdentity(handle, identity).pipe(Effect.orDie)),
  ).pipe(Layer.provideMerge(replica));

export type SqliteReplicaSyncSession = Required<ReplicaSubsetReader> &
  ReplicaInsightsReader &
  ReplicaSummaryReader & {
    readonly engine: "sqlite";
    readonly replicaId: string;
    readonly readOutboxActivity: () => Promise<ReplicaOutboxActivity>;
    readonly readPendingRowIds: (entity: SyncEntity) => Promise<ReadonlyArray<string>>;
    readonly stamp: () => Promise<ReplicaQueryStamp>;
    readonly readOutboxStatuses: () => Promise<ReadonlyArray<OutboxCommandStatus>>;
    readonly enqueueCommand: (request: EnqueueCommandRequest) => Promise<EnqueuedCommand>;
    readonly readCommandStatus: (operationId: string) => Promise<CommandStatus | undefined>;
    readonly wakeSyncUpload: () => Promise<{
      readonly drained: boolean;
      readonly drainCount: number;
    }>;
    readonly wake: (reason: SyncWakeReason) => Promise<void>;
    readonly setVisible: (visible: boolean) => Promise<void>;
    readonly setPullMaxBytes: (maxBytes: number | undefined) => Promise<void>;
    readonly subscribe: (listener: (notice: ReplicaCommitNotice) => void) => () => void;
    readonly subscribeSyncHealth: (listener: (health: ReplicaSyncHealth) => void) => () => void;
    readonly close: () => Promise<void>;
  };

type SqliteReplicaSyncInput<ReplicaError, TransportError> = {
  readonly replica: Layer.Layer<SqliteReplica, ReplicaError>;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
  readonly transport: Layer.Layer<SyncTransportService, TransportError>;
  readonly live: OwnedLiveHost;
  readonly policy?: SyncSchedulerPolicy;
  readonly snapshotReader?: Layer.Layer<ReplicaSnapshotReader, never, SqliteReplica>;
};

export const openSqliteReplicaSyncSession = async <ReplicaError, TransportError>(
  input: SqliteReplicaSyncInput<ReplicaError, TransportError>,
): Promise<SqliteReplicaSyncSession> => {
  const workspaceToken = input.databaseIdentity;
  const publisher = createReplicaCommitPublisher();
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      layerOwnedHttpSync({
        databaseIdentity: input.databaseIdentity,
        live: input.live,
        policy: input.policy,
      }),
      layerCommitForwarding(workspaceToken, publisher),
    ).pipe(
      Layer.provideMerge(layerSqliteReplicaStore(input.databaseIdentity)),
      Layer.provideMerge(input.snapshotReader ?? layerHandleSnapshotReader),
      Layer.provideMerge(layerSeededReplica(input.replica, input.identity)),
      Layer.provide(input.transport),
    ),
  );
  const { store, scheduler, engine, replicaId } = await bootWorkspaceRuntime(
    runtime,
    Effect.gen(function* () {
      const store = yield* ReplicaStore;
      return {
        store,
        scheduler: yield* SyncScheduler,
        engine: yield* SyncEngine,
        replicaId: (yield* store.readSyncCursor()).replicaId,
      };
    }),
  );

  const lifetime = makeReplicaLifetime();
  lifetime.onClose(Effect.promise(() => runtime.dispose()));
  lifetime.onClose(Effect.promise(() => publisher.dispose()));

  type RuntimeServices = ManagedRuntime.ManagedRuntime.Services<typeof runtime>;

  const run = <A, E>(effect: Effect.Effect<A, E, RuntimeServices>, options?: ReplicaReadOptions) =>
    runtime.runPromise(
      lifetime.supervise(effect),
      options?.signal === undefined ? undefined : { signal: options.signal },
    );

  const withHandle = <A, E>(use: (handle: SqliteReplicaHandle) => Effect.Effect<A, E>) =>
    run(SqliteReplica.use(use).pipe(Effect.orDie));

  const withSnapshot = <A, E>(
    use: (snapshot: ReplicaSnapshotRunner<ReplicaRow>) => Effect.Effect<A, E>,
    options?: ReplicaReadOptions,
  ) => run(ReplicaSnapshotReader.use(use).pipe(Effect.orDie), options);

  let drainCount = 0;

  return {
    engine: "sqlite",
    replicaId,
    readOutboxActivity: () => withHandle((handle) => readOutboxActivitySqlite(handle.db)),
    readPendingRowIds: (entity) =>
      withHandle((handle) => readPendingRowIdsSqlite(handle.db, entity)),
    stamp: () => withHandle((handle) => readReplicaStamp(handle, workspaceToken)),
    readSubset: (spec, options) =>
      withSnapshot((snapshot) => readSnapshotSubset(snapshot, workspaceToken, spec), options),
    readBatch: (specs, options) =>
      withSnapshot((snapshot) => readSnapshotBatch(snapshot, workspaceToken, specs), options),
    readInsights: (window) =>
      withHandle((handle) => readReplicaInsights(handle, workspaceToken, window)),
    summarizeSubset: (spec) =>
      withSnapshot((snapshot) => readSnapshotSummary(snapshot, workspaceToken, spec)),
    readOutboxStatuses: () => withHandle((handle) => readOutboxStatusesSqlite(handle.db)),
    enqueueCommand: async (request) => {
      const queued = await run(store.enqueueCommand(request));
      return {
        operationId: queued.value.operationId,
        status: queued.value.status,
        stamp: { workspaceToken, ...queued.value.stamp },
      };
    },
    readCommandStatus: (operationId) => run(store.readCommandStatus(operationId)),
    wakeSyncUpload: async () => {
      drainCount += 1;
      await run(scheduler.wake("localWrite"));
      return { drained: true, drainCount };
    },
    wake: (reason) => run(scheduler.wake(reason)),
    setVisible: (visible) => run(scheduler.setVisible(visible)),
    setPullMaxBytes: (maxBytes) => run(engine.setPullMaxBytes(maxBytes)),
    subscribe: publisher.subscribe,
    subscribeSyncHealth: subscribeSchedulerHealth(scheduler, lifetime.scope),
    close: lifetime.close,
  };
};
