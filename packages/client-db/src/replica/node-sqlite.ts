import type { SyncCommandEnvelope, SyncEntity } from "@store/contracts";
import { ReplicaStore } from "@store/sync/browser";
import { readOutboxActivitySqlite, readPendingRowIdsSqlite } from "@store/sync/sql-client";
import {
  layerSqliteReplicaStore,
  runReplicaTransaction,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { touchedEntitiesForCommand, touchedKeysForCommand } from "./enqueue";
import { readCommandAllocationSqlite, readOutboxStatusesSqlite } from "./node-outbox";
import { createReplicaCommitPublisher } from "./publisher";
import {
  layerSeededReplica,
  readReplicaStamp,
  readReplicaSubset,
  runReplicaQuery,
  type SqliteReplicaIdentity,
} from "./sql-client-session";
import type { ReplicaCommitNotice, ReplicaHandle, SqliteParameter, SqliteResultRow } from "./types";
import { bootWorkspaceRuntime } from "./workspace-runtime";

export type NodeReplicaIdentity = SqliteReplicaIdentity;

export type NodeReplicaSqlite = ReplicaHandle & {
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
  const runtime = ManagedRuntime.make(
    layerSqliteReplicaStore(workspaceToken).pipe(
      Layer.provideMerge(layerSeededSqliteReplica(path, identity)),
    ),
  );
  const replicaStore = await bootWorkspaceRuntime(runtime, ReplicaStore.use(Effect.succeed));
  const { replicaId } = await runtime.runPromise(replicaStore.readSyncCursor());
  const publisher = createReplicaCommitPublisher();

  const withHandle = <A, E>(use: (handle: SqliteReplicaHandle) => Effect.Effect<A, E>) =>
    runtime.runPromise(SqliteReplica.use(use).pipe(Effect.orDie));

  const stamp = () => withHandle((handle) => readReplicaStamp(handle, workspaceToken));

  const query = (sql: string, parameters: ReadonlyArray<SqliteParameter>) =>
    withHandle((handle) => runReplicaQuery(handle, sql, parameters));

  const withWrite: NodeReplicaSqlite["withWrite"] = async (write, touchedEntities, touchedKeys) => {
    const written = await withHandle((handle) =>
      runReplicaTransaction(handle, () =>
        Effect.gen(function* () {
          yield* write(handle);
          yield* handle.sql.unsafe(
            `update replica_state set localCommitVersion = localCommitVersion + 1 where id = 'singleton'`,
          );
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

  const enqueueLocal = async (envelope: SyncCommandEnvelope, createdAt: number) => {
    const queued = await runtime.runPromise(replicaStore.enqueueCommand(envelope, createdAt));
    if (queued.notice) {
      publisher.publish({
        workspaceToken,
        generationId: queued.notice.generationId,
        localCommitVersion: queued.notice.localCommitVersion,
        touchedEntities: touchedEntitiesForCommand(envelope),
        touchedKeys: touchedKeysForCommand(envelope),
      });
    }
    return { changed: queued.notice !== undefined, status: queued.value.status };
  };

  return {
    workspaceToken,
    replicaId,
    stamp,
    query,
    readOutboxActivity: () => withHandle((handle) => readOutboxActivitySqlite(handle.sql)),
    readPendingRowIds: (entity) =>
      withHandle((handle) => readPendingRowIdsSqlite(handle.sql, entity)),
    readOutboxStatuses: () => withHandle((handle) => readOutboxStatusesSqlite(handle.sql)),
    readCommandAllocation: () => withHandle((handle) => readCommandAllocationSqlite(handle.sql)),
    enqueueLocal,
    readSubset: (spec) => withHandle((handle) => readReplicaSubset(handle, workspaceToken, spec)),
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    withWrite,
    close: () => {
      publisher.dispose();
      void runtime.dispose();
    },
  };
};

export {
  readReplicaStamp,
  readReplicaSubset,
  runReplicaQuery,
  seedReplicaIdentity,
} from "./sql-client-session";
export { openNodeReplicaSyncSession } from "./node-sync";
export type { NodeReplicaSyncIdentity, NodeReplicaSyncSession } from "./node-sync";
export { makeProxySyncTransport } from "./proxy-transport";
export type { SyncProxyFetch } from "./proxy-transport";
