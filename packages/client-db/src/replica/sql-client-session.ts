import type { ReplicaInsightsWindow, SyncCommandEnvelope, SyncEntity } from "@store/contracts";
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
  SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";

import { layerCommitForwarding } from "./commit-forwarding";
import { lowerSqliteSubset, lowerSqliteSummary } from "./compile";
import { readSqliteInsightsFacts } from "./insights-sqlite";
import { readCommandAllocationSqlite, readOutboxStatusesSqlite } from "./node-outbox";
import { createReplicaCommitPublisher } from "./publisher";
import {
  decodeReplicaStampRow,
  decodeSqliteResultRow,
  type OutboxCommandStatus,
} from "./sqlite-row";
import type { ReplicaSyncHealth } from "./status";
import type { InventorySubsetSpec, InventorySubsetSummarySpec } from "./subset-spec";
import { subscribeSchedulerHealth } from "./sync-health";
import type {
  ReplicaCommitNotice,
  ReplicaInsightsRead,
  ReplicaInsightsReader,
  ReplicaQueryStamp,
  ReplicaSummaryRead,
  ReplicaSummaryReader,
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

export const readReplicaStamp = Effect.fn("ReplicaNodeSqlite.readStamp")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
) {
  const rows = yield* handle.db
    .select({
      generation: replicaState.activeGeneration,
      version: replicaState.localCommitVersion,
    })
    .from(replicaState)
    .where(eq(replicaState.id, "singleton"))
    .all();
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

export const readReplicaInsights = Effect.fn("ReplicaNodeSqlite.readInsights")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
  window: ReplicaInsightsWindow,
) {
  const stamp = yield* readReplicaStamp(handle, workspaceToken);
  const facts = yield* readSqliteInsightsFacts(handle, window);
  return { stamp, facts } satisfies ReplicaInsightsRead;
});

const SummaryCountRow = Schema.Struct({ count: Schema.Number });
const SummaryValueRow = Schema.Struct({ value: Schema.String });

export const readReplicaSummary = Effect.fn("ReplicaNodeSqlite.summarizeSubset")(function* (
  handle: SqliteReplicaHandle,
  workspaceToken: string,
  spec: InventorySubsetSummarySpec,
) {
  const statements = yield* lowerSqliteSummary(spec);
  const stamp = yield* readReplicaStamp(handle, workspaceToken);
  const [countRow] = yield* Schema.decodeUnknownEffect(Schema.Array(SummaryCountRow))(
    yield* handle.sql.unsafe(statements.count.sql, statements.count.parameters),
  );
  const distinct = yield* Effect.forEach(statements.distinct, ({ column, statement }) =>
    handle.sql.unsafe(statement.sql, statement.parameters).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SummaryValueRow))),
      Effect.map((rows) => ({ column, values: rows.map((row) => row.value) })),
    ),
  );
  return { stamp, summary: { count: countRow?.count ?? 0, distinct } } satisfies ReplicaSummaryRead;
});

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

export type SqliteReplicaSyncSession = ReplicaSubsetReader &
  ReplicaInsightsReader &
  ReplicaSummaryReader & {
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
    readonly setPullMaxBytes: (maxBytes: number | undefined) => Promise<void>;
    readonly subscribe: (listener: (notice: ReplicaCommitNotice) => void) => () => void;
    readonly subscribeSyncHealth: (listener: (health: ReplicaSyncHealth) => void) => () => void;
    readonly publish: (notice: ReplicaCommitNotice) => void;
    readonly close: () => void;
    readonly dispose: () => Promise<void>;
  };

type SqliteReplicaSyncInput<ReplicaError, TransportError> = {
  readonly replica: Layer.Layer<SqliteReplica, ReplicaError>;
  readonly identity: SqliteReplicaIdentity;
  readonly databaseIdentity: string;
  readonly transport: Layer.Layer<SyncTransportService, TransportError>;
  readonly live: OwnedLiveHost;
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
        live: input.live,
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
    readOutboxActivity: () => withHandle((handle) => readOutboxActivitySqlite(handle.db)),
    readPendingRowIds: (entity) =>
      withHandle((handle) => readPendingRowIdsSqlite(handle.db, entity)),
    stamp: () => withHandle((handle) => readReplicaStamp(handle, workspaceToken)),
    readSubset: (spec) => withHandle((handle) => readReplicaSubset(handle, workspaceToken, spec)),
    readInsights: (window) =>
      withHandle((handle) => readReplicaInsights(handle, workspaceToken, window)),
    summarizeSubset: (spec) =>
      withHandle((handle) => readReplicaSummary(handle, workspaceToken, spec)),
    readOutboxStatuses: () => withHandle((handle) => readOutboxStatusesSqlite(handle.db)),
    readCommandAllocation: () => withHandle((handle) => readCommandAllocationSqlite(handle.db)),
    enqueueLocal: async (envelope, createdAt) => {
      const queued = await runtime.runPromise(store.enqueueCommand(envelope, createdAt));
      return { changed: queued.notice !== undefined, status: queued.value.status };
    },
    wakeSyncUpload: async () => {
      drainCount += 1;
      await runtime.runPromise(scheduler.wake("localWrite"));
      return { drained: true, drainCount };
    },
    wake: (reason) => runtime.runPromise(scheduler.wake(reason)),
    setVisible: (visible) => runtime.runPromise(scheduler.setVisible(visible)),
    setPullMaxBytes: (maxBytes) => runtime.runPromise(engine.setPullMaxBytes(maxBytes)),
    subscribe: publisher.subscribe,
    subscribeSyncHealth: subscribeSchedulerHealth(scheduler),
    publish: publisher.publish,
    close: () => {
      void dispose();
    },
    dispose,
  };
};
