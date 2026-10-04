import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Scope from "effect/Scope";
import type { SqlClient } from "effect/sql/SqlClient";

import {
  openReplicaStoreFromClient,
  SqliteReplica,
  type SqliteReplicaHandle,
} from "./replica/sql-client/handle";

const checkpointOnClose = (sql: SqliteClient.SqliteClient) =>
  Effect.addFinalizer(() =>
    sql`PRAGMA busy_timeout = 0`.pipe(
      Effect.andThen(sql`PRAGMA wal_checkpoint(TRUNCATE)`),
      Effect.ignore,
    ),
  );

export const openReplicaStore = (
  path = ":memory:",
): Effect.Effect<SqliteReplicaHandle, never, Scope.Scope> =>
  SqliteClient.make({ filename: path }).pipe(
    Effect.tap(checkpointOnClose),
    Effect.provide(Reactivity.layer),
    Effect.flatMap(openReplicaStoreFromClient),
    Effect.orDie,
  );

export const layerNodeSqliteReplica = (path?: string): Layer.Layer<SqliteReplica> =>
  Layer.effect(SqliteReplica, openReplicaStore(path));

export const layerNodeSqliteReadonlyReplica = (
  path: string,
): Layer.Layer<SqliteReplica | SqlClient> =>
  SqliteReplica.layerReadonlyFromClient.pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: path, readonly: true, disableWAL: true })),
  );
