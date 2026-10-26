import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import type * as Scope from "effect/Scope";
import { SqlClient } from "effect/sql/SqlClient";

import { storageErrorOf, type ReplicaStorageError } from "./replica/errors";
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
): Effect.Effect<SqliteReplicaHandle, ReplicaStorageError, Scope.Scope> =>
  SqliteClient.make({ filename: path }).pipe(
    Effect.tap(checkpointOnClose),
    Effect.provide(Reactivity.layer),
    Effect.flatMap(openReplicaStoreFromClient),
    Effect.mapError(storageErrorOf),
  );

export const layerNodeSqliteReplica = (
  path?: string,
): Layer.Layer<SqliteReplica, ReplicaStorageError> =>
  Layer.effect(SqliteReplica, openReplicaStore(path));

export const layerNodeSqliteReadonlyReplica = (
  path: string,
): Layer.Layer<SqliteReplica | SqlClient, ReplicaStorageError> =>
  SqliteReplica.layerReadonlyFromClient.pipe(
    Layer.provideMerge(
      Layer.effectContext(
        SqliteClient.make({ filename: path, readonly: true, disableWAL: true }).pipe(
          Effect.map((client) =>
            Context.make(SqliteClient.SqliteClient, client).pipe(Context.add(SqlClient, client)),
          ),
          Effect.mapError(storageErrorOf),
        ),
      ).pipe(Layer.provide(Reactivity.layer)),
    ),
  );
