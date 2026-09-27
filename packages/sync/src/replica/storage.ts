import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import {
  openReplicaStoreFromClient,
  SqliteReplica as SqlClientReplica,
  type SqliteReplicaHandle,
} from "./sql-client/handle";

export type { ReplicaDb } from "./sql-client/drizzle";
export { runReplicaTransaction } from "./sql-client/handle";
export type { SqliteReplicaHandle } from "./sql-client/handle";

export const openReplicaStore = (
  path = ":memory:",
): Effect.Effect<SqliteReplicaHandle, never, Scope.Scope> =>
  SqliteClient.make({ filename: path }).pipe(
    Effect.provide(Reactivity.layer),
    Effect.flatMap(openReplicaStoreFromClient),
    Effect.orDie,
  );

export class SqliteReplica extends SqlClientReplica {
  static readonly layer = (path?: string): Layer.Layer<SqlClientReplica> =>
    Layer.effect(SqlClientReplica, openReplicaStore(path));
}
