import type { SyncEntity } from "@store/contracts";
import { replicaState } from "@store/db/replica.schema";
import { ReplicaStore } from "@store/sync";
import {
  layerSqliteReplicaStore,
  runReplicaTransaction,
  type SqliteReplica,
  type SqliteReplicaHandle,
} from "@store/sync/sql-client";
import { layerNodeSqliteReplica } from "@store/sync/sqlite";
import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { replicaSyncActivityOf } from "./activity";
import { enqueuedCommand, openReplicaRuntime } from "./replica-runtime";
import {
  layerSeededReplica,
  readReplicaStamp,
  runReplicaQuery,
  sqliteReplicaReads,
  type SqliteReplicaIdentity,
} from "./sql-client-session";
import type { ReplicaCommitNotice, ReplicaHandle, SqliteParameter, SqliteResultRow } from "./types";

type NodeReplicaIdentity = SqliteReplicaIdentity;

type NodeReplicaSqlite = ReplicaHandle & {
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
): Layer.Layer<SqliteReplica> => layerSeededReplica(layerNodeSqliteReplica(path), identity);

export const openNodeReplicaSqlite = async (
  identity: NodeReplicaIdentity,
  path = ":memory:",
): Promise<NodeReplicaSqlite> => {
  const workspaceToken = crypto.randomUUID();
  const { booted, run, subscribe, publish, close } = await openReplicaRuntime(
    workspaceToken,
    (commitForwarding) =>
      commitForwarding.pipe(
        Layer.provideMerge(layerSqliteReplicaStore(workspaceToken)),
        Layer.provideMerge(layerSeededSqliteReplica(path, identity)),
      ),
    Effect.gen(function* () {
      const store = yield* ReplicaStore;
      return { store, replicaId: (yield* store.readSyncCursor()).replicaId };
    }),
  );
  const { store, replicaId } = booted;
  const { reads, readOutboxActivity, withHandle } = sqliteReplicaReads(run, workspaceToken);

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
    publish(notice);
    return notice;
  };

  return {
    ...reads,
    workspaceToken,
    replicaId,
    query: (sql, parameters) => withHandle((handle) => runReplicaQuery(handle, sql, parameters)),
    readSyncActivity: () => readOutboxActivity().then(replicaSyncActivityOf),
    enqueueCommand: async (request) =>
      enqueuedCommand(workspaceToken, (await run(store.enqueueCommand(request))).value),
    readCommandStatus: (operationId) => run(store.readCommandStatus(operationId)),
    subscribe,
    withWrite,
    close,
  };
};

export { layerNodeLocalReplica, layerNodeReplicaSync } from "./node-sync";
export { openReadonlySnapshotRunner, type NodeSqliteRow } from "./node-readonly";
export { readSnapshotBatch, readSnapshotSubset, readSnapshotSummary } from "./snapshot-read";
export type { ReplicaSnapshotRunner } from "./snapshot-read";
export type { SqliteReplicaServices } from "./sql-client-session";
export { makePinnedHttp, type PinnedHttp } from "./pinned-http";
export { layerNodeSqliteReadonlyReplica } from "@store/sync/sqlite";
