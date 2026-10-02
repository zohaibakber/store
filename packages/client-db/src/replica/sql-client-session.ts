import type {
  CommandStatus,
  DeviceLabel,
  EnqueueCommandRequest,
  ReplicaInsightsWindow,
  SyncEntity,
} from "@store/contracts";
import { replicaState } from "@store/db/replica.schema";
import {
  layerOwnedHttpSync,
  layerOwnedLocalSync,
  ReplicaStore,
  SyncEngine,
  SyncScheduler,
  SyncTransportService,
  type OwnedLiveHost,
  type ReplicaOutboxActivity,
  type SyncSchedulerPolicy,
  type SyncWakeReason,
} from "@store/sync";
import {
  layerSqliteReplicaStore,
  LocalAuthority,
  readOutboxActivitySqlite,
  readPendingRowIdsSqlite,
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
  type SqliteReplicaStoreOptions,
} from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { readSqliteInsightsFacts } from "./insights-sqlite";
import { replicaStampQuery } from "./replica-queries";
import { enqueuedCommand, openReplicaRuntime, type ReplicaRun } from "./replica-runtime";
import {
  snapshotRunnerFromHandle,
  readSnapshotBatch,
  readSnapshotSubset,
  readSnapshotSummary,
  type ReplicaSnapshotRunner,
} from "./snapshot-read";
import { decodeReplicaStampRow, decodeSqliteResultRow, type ReplicaRow } from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
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

const readReplicaInsights = Effect.fn("ReplicaNodeSqlite.readInsights")(function* (
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

const seedReplicaIdentity = Effect.fn("ReplicaNodeSqlite.seedIdentity")(function* (
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

type SqliteReplicaReads = Required<ReplicaSubsetReader> &
  ReplicaInsightsReader &
  ReplicaSummaryReader & {
    readonly stamp: () => Promise<ReplicaQueryStamp>;
    readonly readPendingRowIds: (entity: SyncEntity) => Promise<ReadonlyArray<string>>;
  };

export type SqliteReplicaSyncSession = SqliteReplicaReads & {
  readonly engine: "sqlite";
  readonly replicaId: string;
  readonly readOutboxActivity: () => Promise<ReplicaOutboxActivity>;
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

export const sqliteReplicaReads = (run: ReplicaRun<SqliteReplica>, workspaceToken: string) => {
  const withHandle = <A, E>(use: (handle: SqliteReplicaHandle) => Effect.Effect<A, E>) =>
    run(SqliteReplica.use(use).pipe(Effect.orDie));

  const withSnapshot = <A, E>(
    use: (snapshot: ReplicaSnapshotRunner<ReplicaRow>) => Effect.Effect<A, E>,
    options?: ReplicaReadOptions,
  ) =>
    run(
      SqliteReplica.use((handle) => use(snapshotRunnerFromHandle(handle))).pipe(Effect.orDie),
      options,
    );

  return {
    withHandle,
    readOutboxActivity: () => withHandle((handle) => readOutboxActivitySqlite(handle.db)),
    reads: {
      stamp: () => withHandle((handle) => readReplicaStamp(handle, workspaceToken)),
      readSubset: (spec, options) =>
        withSnapshot((snapshot) => readSnapshotSubset(snapshot, workspaceToken, spec), options),
      readBatch: (specs, options) =>
        withSnapshot((snapshot) => readSnapshotBatch(snapshot, workspaceToken, specs), options),
      readInsights: (window) =>
        withHandle((handle) => readReplicaInsights(handle, workspaceToken, window)),
      summarizeSubset: (spec) =>
        withSnapshot((snapshot) => readSnapshotSummary(snapshot, workspaceToken, spec)),
      readPendingRowIds: (entity) =>
        withHandle((handle) => readPendingRowIdsSqlite(handle.db, entity)),
    } satisfies SqliteReplicaReads,
  };
};

type SqliteReplicaSessionInput<ReplicaError> = {
  readonly replica: Layer.Layer<SqliteReplica, ReplicaError>;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
};

type SqliteReplicaSyncInput<ReplicaError, TransportError> =
  SqliteReplicaSessionInput<ReplicaError> & {
    readonly transport: Layer.Layer<SyncTransportService, TransportError>;
    readonly live: OwnedLiveHost;
    readonly policy?: SyncSchedulerPolicy;
    readonly deviceLabel?: DeviceLabel | undefined;
  };

type SqliteReplicaAuthority<SyncError> = {
  readonly sync: Layer.Layer<SyncEngine | SyncScheduler, SyncError, ReplicaStore | SqliteReplica>;
  readonly store: SqliteReplicaStoreOptions;
  readonly wakesOnEnqueue: boolean;
};

const openSqliteReplicaSession = async <ReplicaError, SyncError>(
  input: SqliteReplicaSessionInput<ReplicaError>,
  authority: SqliteReplicaAuthority<SyncError>,
): Promise<SqliteReplicaSyncSession> => {
  const workspaceToken = input.databaseIdentity;
  const { booted, run, subscribe, scope, close } = await openReplicaRuntime(
    workspaceToken,
    (commitForwarding) =>
      Layer.mergeAll(authority.sync, commitForwarding).pipe(
        Layer.provideMerge(layerSqliteReplicaStore(input.databaseIdentity, authority.store)),
        Layer.provideMerge(layerSeededReplica(input.replica, input.identity)),
      ),
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
  const { store, scheduler, engine, replicaId } = booted;
  const { reads, readOutboxActivity } = sqliteReplicaReads(run, workspaceToken);

  let drainCount = 0;

  return {
    ...reads,
    engine: "sqlite",
    replicaId,
    readOutboxActivity,
    enqueueCommand: async (request) => {
      const queued = await run(
        authority.wakesOnEnqueue
          ? Effect.tap(store.enqueueCommand(request), (committed) =>
              committed.value.status === "pending" ? scheduler.wake("localWrite") : Effect.void,
            )
          : store.enqueueCommand(request),
      );
      return enqueuedCommand(workspaceToken, queued.value);
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
    subscribe,
    subscribeSyncHealth: subscribeSchedulerHealth(scheduler, scope),
    close,
  };
};

export const openSqliteReplicaSyncSession = <ReplicaError, TransportError>(
  input: SqliteReplicaSyncInput<ReplicaError, TransportError>,
): Promise<SqliteReplicaSyncSession> =>
  openSqliteReplicaSession(input, {
    sync: layerOwnedHttpSync({
      databaseIdentity: input.databaseIdentity,
      live: input.live,
      policy: input.policy,
      deviceLabel: input.deviceLabel,
    }).pipe(Layer.provide(input.transport)),
    store: {},
    wakesOnEnqueue: false,
  });

export const openSqliteReplicaLocalSession = <ReplicaError>(
  input: SqliteReplicaSessionInput<ReplicaError>,
): Promise<SqliteReplicaSyncSession> =>
  openSqliteReplicaSession(input, {
    sync: layerOwnedLocalSync.pipe(Layer.provide(LocalAuthority.layer)),
    store: { authority: LocalAuthority.submitWithin },
    wakesOnEnqueue: true,
  });
