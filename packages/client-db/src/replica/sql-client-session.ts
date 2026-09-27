import type { SyncCommandEnvelope, SyncEntity } from "@store/contracts";
import {
  layerOwnedHttpSync,
  ReplicaStore,
  SyncEngine,
  SyncScheduler,
  SyncTransportService,
  type ReplicaOutboxActivity,
  type SyncSchedulerPolicy,
  type SyncWakeReason,
} from "@store/sync/browser";
import {
  layerSqliteReplicaStore,
  readOutboxActivitySqlite,
  readPendingRowIdsSqlite,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { layerCommitForwarding } from "./commit-forwarding";
import { lowerSqliteSubset } from "./compile";
import { readCommandAllocationSqlite, readOutboxStatusesSqlite } from "./node-outbox";
import { createReplicaCommitPublisher } from "./publisher";
import {
  decodeReplicaStampRow,
  decodeSqliteResultRow,
  type OutboxCommandStatus,
} from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type { InventorySubsetSpec } from "./subset-spec";
import { subscribeSchedulerHealth } from "./sync-health";
import type {
  ReplicaCommitNotice,
  ReplicaQueryStamp,
  ReplicaSubsetRead,
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

const STAMP_SQL = `select activeGeneration as generation, localCommitVersion as version from replica_state where id = 'singleton'`;

export const readReplicaStamp = Effect.fn("ReplicaNodeSqlite.readStamp")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
) {
  const rows = yield* handle.sql.unsafe(STAMP_SQL);
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

export const readReplicaSubset = Effect.fn("ReplicaNodeSqlite.readSubset")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
  spec: InventorySubsetSpec,
) {
  const statement = yield* lowerSqliteSubset(spec);
  const stamp = yield* readReplicaStamp(handle, workspaceToken);
  const rows = yield* runReplicaQuery(handle, statement.sql, statement.parameters);
  return { stamp, rows } satisfies ReplicaSubsetRead;
});

export const seedReplicaIdentity = Effect.fn("ReplicaNodeSqlite.seedIdentity")(function* (
  handle: SqliteReplicaHandle,
  identity: SqliteReplicaIdentity,
) {
  const existing = yield* handle.sql.unsafe(`select id from replica_state where id = 'singleton'`);
  if (existing.length > 0) return;
  yield* handle.sql.unsafe(
    `insert into replica_state (
      id, organizationId, userId, replicaId, epoch, incarnation,
      appliedCommitSequence, nextClientSequence, localCommitVersion, activeGeneration
    ) values ('singleton', ?, ?, ?, '1', 'local', '0', '1', 0, 1)`,
    [identity.organizationId, identity.userId, identity.replicaId],
  );
});

export const layerSeededReplica = <E, R>(
  replica: Layer.Layer<SqliteReplica, E, R>,
  identity: SqliteReplicaIdentity,
): Layer.Layer<SqliteReplica, E, R> =>
  Layer.effectDiscard(
    SqliteReplica.use((handle) => seedReplicaIdentity(handle, identity).pipe(Effect.orDie)),
  ).pipe(Layer.provideMerge(replica));

export type SqliteReplicaSyncSession = ReplicaSubsetReader & {
  readonly engine: "sqlite";
  readonly replicaId: string;
  readonly readOutboxActivity: () => Promise<ReplicaOutboxActivity>;
  readonly readPendingRowIds: (entity: SyncEntity) => Promise<ReadonlyArray<string>>;
  readonly stamp: () => Promise<ReplicaQueryStamp>;
  readonly readOutboxStatuses: () => Promise<ReadonlyArray<OutboxCommandStatus>>;
  readonly readCommandAllocation: () => Promise<{
    readonly epoch: string;
    readonly nextClientSequence: string;
  }>;
  readonly enqueueLocal: (
    envelope: SyncCommandEnvelope,
    createdAt: number,
  ) => Promise<{ readonly changed: boolean; readonly status: string }>;
  readonly wakeSyncUpload: () => Promise<{
    readonly drained: boolean;
    readonly drainCount: number;
  }>;
  readonly wake: (reason: SyncWakeReason) => Promise<void>;
  readonly setVisible: (visible: boolean) => Promise<void>;
  readonly subscribe: (listener: (notice: ReplicaCommitNotice) => void) => () => void;
  readonly subscribeSyncHealth: (listener: (health: ReplicaSyncHealth) => void) => () => void;
  readonly publish: (notice: ReplicaCommitNotice) => void;
  readonly close: () => void;
  readonly dispose: () => Promise<void>;
};

export type SqliteReplicaSyncInput<ReplicaError, TransportError> = {
  readonly replica: Layer.Layer<SqliteReplica, ReplicaError>;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
  readonly transport: Layer.Layer<SyncTransportService, TransportError>;
  readonly live?: {
    readonly apiBaseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly preferSse?: boolean;
  };
  readonly policy?: SyncSchedulerPolicy;
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
        live: input.live
          ? {
              apiBaseUrl: input.live.apiBaseUrl,
              replicaId: input.identity.replicaId,
              fetch: input.live.fetch,
              preferSse: input.live.preferSse ?? false,
            }
          : undefined,
        policy: input.policy,
      }),
      layerCommitForwarding(workspaceToken, publisher),
    ).pipe(
      Layer.provideMerge(layerSqliteReplicaStore(input.databaseIdentity)),
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

  const withHandle = <A, E>(use: (handle: SqliteReplicaHandle) => Effect.Effect<A, E>) =>
    runtime.runPromise(SqliteReplica.use(use).pipe(Effect.orDie));

  const dispose = () => {
    publisher.dispose();
    return runtime.dispose();
  };

  let drainCount = 0;

  return {
    engine: "sqlite",
    replicaId,
    readOutboxActivity: () => withHandle((handle) => readOutboxActivitySqlite(handle.sql)),
    readPendingRowIds: (entity) =>
      withHandle((handle) => readPendingRowIdsSqlite(handle.sql, entity)),
    stamp: () => withHandle((handle) => readReplicaStamp(handle, workspaceToken)),
    readSubset: (spec) => withHandle((handle) => readReplicaSubset(handle, workspaceToken, spec)),
    readOutboxStatuses: () => withHandle((handle) => readOutboxStatusesSqlite(handle.sql)),
    readCommandAllocation: () => withHandle((handle) => readCommandAllocationSqlite(handle.sql)),
    enqueueLocal: async (envelope, createdAt) => {
      const queued = await runtime.runPromise(store.enqueueCommand(envelope, createdAt));
      return { changed: queued.notice !== undefined, status: queued.value.status };
    },
    wakeSyncUpload: async () => {
      drainCount += 1;
      await runtime.runPromise(
        scheduler
          .wake("localWrite")
          .pipe(
            Effect.andThen(
              engine.ensureRegistered().pipe(Effect.andThen(engine.uploadOnce()), Effect.ignore),
            ),
          ),
      );
      return { drained: true, drainCount };
    },
    wake: (reason) => runtime.runPromise(scheduler.wake(reason)),
    setVisible: (visible) => runtime.runPromise(scheduler.setVisible(visible)),
    subscribe: publisher.subscribe,
    subscribeSyncHealth: subscribeSchedulerHealth(scheduler),
    publish: publisher.publish,
    close: () => {
      void dispose();
    },
    dispose,
  };
};
