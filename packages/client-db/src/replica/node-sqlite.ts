import type { EnqueueCommandRequest, SyncEntity } from "@store/contracts";
import { replicaState } from "@store/db/replica.schema";
import { ReplicaStore } from "@store/sync/browser";
import { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "@store/sync/sql-client";
import {
  layerSqliteReplicaStore,
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sqlite";
import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { layerCommitForwarding } from "./commit-forwarding";
import { makeReplicaLifetime } from "./lifetime";
import { readOutboxStatusesSqlite } from "./node-outbox";
import { layerReadonlySnapshotReader } from "./node-readonly";
import { createReplicaCommitPublisher } from "./publisher";
import {
  ReplicaSnapshotReader,
  readSnapshotBatch,
  readSnapshotSubset,
  readSnapshotSummary,
  type ReplicaSnapshotRunner,
} from "./snapshot-read";
import {
  layerSeededReplica,
  readReplicaInsights,
  readReplicaStamp,
  runReplicaQuery,
  type SqliteReplicaIdentity,
} from "./sql-client-session";
import type {
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaReadOptions,
  ReplicaRow,
  ReplicaSubsetReader,
  SqliteParameter,
  SqliteResultRow,
} from "./types";
import { bootWorkspaceRuntime } from "./workspace-runtime";

type NodeReplicaIdentity = SqliteReplicaIdentity;

export type NodeReplicaSqlite = ReplicaHandle &
  Required<ReplicaSubsetReader> & {
    readonly query: (
      sql: string,
      parameters: ReadonlyArray<SqliteParameter>,
    ) => Promise<ReadonlyArray<SqliteResultRow>>;
    readonly withWrite: (
      write: (handle: SqliteReplicaHandle) => Effect.Effect<void, unknown>,
      touchedEntities: ReadonlyArray<SyncEntity>,
      touchedKeys: ReadonlyArray<string>,
    ) => Promise<ReplicaCommitNotice>;
  };

export const layerSeededSqliteReplica = (
  path: string,
  identity: NodeReplicaIdentity,
): Layer.Layer<SqliteReplica> => layerSeededReplica(SqliteReplica.layer(path), identity);

export const openNodeReplicaSqlite = async (
  identity: NodeReplicaIdentity,
  path = ":memory:",
): Promise<NodeReplicaSqlite> => {
  const workspaceToken = crypto.randomUUID();
  const publisher = createReplicaCommitPublisher();
  const runtime = ManagedRuntime.make(
    layerCommitForwarding(workspaceToken, publisher).pipe(
      Layer.provideMerge(layerSqliteReplicaStore(workspaceToken)),
      Layer.provideMerge(layerReadonlySnapshotReader(path)),
      Layer.provideMerge(layerSeededSqliteReplica(path, identity)),
    ),
  );
  const replicaStore = await bootWorkspaceRuntime(runtime, ReplicaStore.use(Effect.succeed));
  const { replicaId } = await runtime.runPromise(replicaStore.readSyncCursor());

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

  const stamp = () => withHandle((handle) => readReplicaStamp(handle, workspaceToken));

  const query = (sql: string, parameters: ReadonlyArray<SqliteParameter>) =>
    withHandle((handle) => runReplicaQuery(handle, sql, parameters));

  const withWrite: NodeReplicaSqlite["withWrite"] = async (write, touchedEntities, touchedKeys) => {
    const written = await withHandle((handle) =>
      runReplicaTransaction(handle, () =>
        Effect.gen(function* () {
          yield* write(handle);
          yield* handle.db
            .update(replicaState)
            .set({ localCommitVersion: sql`${replicaState.localCommitVersion} + 1` })
            .where(eq(replicaState.id, "singleton"));
          return yield* readReplicaStamp(handle, workspaceToken);
        }),
      ),
    );
    const notice: ReplicaCommitNotice = {
      workspaceToken: written.workspaceToken,
      generationId: written.generationId,
      localCommitVersion: written.localCommitVersion,
      touchedEntities,
      touchedKeys,
    };
    publisher.publish(notice);
    return notice;
  };

  const enqueueCommand = async (request: EnqueueCommandRequest) => {
    const queued = await run(replicaStore.enqueueCommand(request));
    return {
      operationId: queued.value.operationId,
      status: queued.value.status,
      stamp: { workspaceToken, ...queued.value.stamp },
    };
  };

  return {
    workspaceToken,
    replicaId,
    stamp,
    query,
    readOutboxActivity: () => withHandle((handle) => readOutboxActivitySqlite(handle.db)),
    readPendingRowIds: (entity) =>
      withHandle((handle) => readPendingRowIdsSqlite(handle.db, entity)),
    readOutboxStatuses: () => withHandle((handle) => readOutboxStatusesSqlite(handle.db)),
    enqueueCommand,
    readCommandStatus: (operationId) => run(replicaStore.readCommandStatus(operationId)),
    readSubset: (spec, options) =>
      withSnapshot((snapshot) => readSnapshotSubset(snapshot, workspaceToken, spec), options),
    readBatch: (specs, options) =>
      withSnapshot((snapshot) => readSnapshotBatch(snapshot, workspaceToken, specs), options),
    readInsights: (window) =>
      withHandle((handle) => readReplicaInsights(handle, workspaceToken, window)),
    summarizeSubset: (spec) =>
      withSnapshot((snapshot) => readSnapshotSummary(snapshot, workspaceToken, spec)),
    subscribe: publisher.subscribe,
    withWrite,
    close: lifetime.close,
  };
};

export {
  readReplicaInsights,
  readReplicaStamp,
  readReplicaSummary,
  readReplicaSubset,
  runReplicaQuery,
  seedReplicaIdentity,
} from "./sql-client-session";
export { openNodeReplicaSyncSession } from "./node-sync";
export { openReadonlySnapshotRunner, type NodeSqliteRow } from "./node-readonly";
export { readSnapshotBatch, readSnapshotSubset, readSnapshotSummary } from "./snapshot-read";
export type { ReplicaSnapshotRunner } from "./snapshot-read";
export type { NodeReplicaSyncIdentity, NodeReplicaSyncSession } from "./node-sync";
export { makeProxySyncTransport } from "./proxy-transport";
export type { SyncProxyFetch, SyncProxyRequest, SyncProxyResponse } from "./proxy-transport";
