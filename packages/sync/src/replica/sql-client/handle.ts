import { replicaMigrations } from "@store/db/replica/migrations";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import {
  runMigrations,
  sqlClientMigrationTarget,
  type SyncMigrationKeyInvalid,
} from "../../migrations";
import { makeReplicaDb, type ReplicaDb } from "./drizzle";

export type SqliteReplicaHandle = {
  readonly sql: SqlClient;
  readonly db: ReplicaDb;
};

export type ReplicaOpenError = SqlError | SyncMigrationKeyInvalid;

export const openReplicaStoreFromClient = (
  sql: SqlClient,
): Effect.Effect<SqliteReplicaHandle, ReplicaOpenError> =>
  Effect.gen(function* () {
    yield* runMigrations(replicaMigrations, sqlClientMigrationTarget(sql));
    const db = yield* makeReplicaDb(sql);
    return { sql, db } satisfies SqliteReplicaHandle;
  });

export const runReplicaTransaction = <A, E, R>(
  handle: SqliteReplicaHandle,
  run: (tx: ReplicaDb) => Effect.Effect<A, E, R>,
) => handle.sql.withTransaction(Effect.suspend(() => run(handle.db)));

export class SqliteReplica extends Context.Service<SqliteReplica, SqliteReplicaHandle>()(
  "@store/sync/SqliteReplica",
) {
  static readonly layerFromClient: Layer.Layer<SqliteReplica, ReplicaOpenError, SqlClient> =
    Layer.effect(SqliteReplica, SqlClient.use(openReplicaStoreFromClient));
}
