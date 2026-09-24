import * as SqliteClient from "@effect/sql-sqlite-react-native/SqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

const REPLICA_PRAGMAS: ReadonlyArray<string> = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = FULL",
];

export const replicaSqlClient = (filename: string): Layer.Layer<SqlClient, SqlError> =>
  Layer.effect(
    SqlClient,
    SqliteClient.make({ filename }).pipe(
      Effect.tap((sql) => Effect.forEach(REPLICA_PRAGMAS, (pragma) => sql.unsafe(pragma))),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
