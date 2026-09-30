import { SqliteReplica, type SqliteReplicaHandle } from "@store/sync/sql-client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { lowerSqliteSubset, lowerSqliteSummary, toStatement } from "./compile";
import type { ReplicaSnapshotFailure } from "./errors";
import { replicaStampQuery } from "./replica-queries";
import { decodeReplicaStampRow } from "./sqlite-row";
import type { InventorySubsetSpec, InventorySubsetSummarySpec } from "./subset-spec";
import type {
  ReplicaBatchRead,
  ReplicaQueryStamp,
  ReplicaRow,
  ReplicaSubsetRead,
  ReplicaSummaryRead,
  SqliteParameter,
  SqliteResultRow,
} from "./types";
import { validateBatchSpecs } from "./validate";

type SnapshotFailure = SqlError | ReplicaSnapshotFailure;

export type SnapshotQuery<Row extends ReplicaRow = SqliteResultRow> = (
  sql: string,
  parameters: ReadonlyArray<SqliteParameter>,
) => Effect.Effect<ReadonlyArray<Row>, SnapshotFailure>;

export type ReplicaSnapshotRunner<Row extends ReplicaRow = SqliteResultRow> = <A, E>(
  work: (query: SnapshotQuery<Row>) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | SnapshotFailure>;

export class ReplicaSnapshotReader extends Context.Service<
  ReplicaSnapshotReader,
  ReplicaSnapshotRunner<ReplicaRow>
>()("@store/client-db/ReplicaSnapshotReader") {}

const stampStatement = toStatement(replicaStampQuery);

export const snapshotRunnerFromHandle =
  (handle: SqliteReplicaHandle): ReplicaSnapshotRunner<ReplicaRow> =>
  (work) =>
    handle.sql.withTransaction(
      Effect.suspend(() => work((sql, parameters) => handle.sql.unsafe(sql, parameters))),
    );

export const layerHandleSnapshotReader: Layer.Layer<ReplicaSnapshotReader, never, SqliteReplica> =
  Layer.effect(ReplicaSnapshotReader)(
    SqliteReplica.use((handle) => Effect.succeed(snapshotRunnerFromHandle(handle))),
  );

const readSnapshotStamp = (
  query: SnapshotQuery<ReplicaRow>,
  workspaceToken: string,
): Effect.Effect<ReplicaQueryStamp, SnapshotFailure> =>
  query(stampStatement.sql, stampStatement.parameters).pipe(
    Effect.map((rows) => {
      const decoded = decodeReplicaStampRow(rows[0]);
      return {
        workspaceToken,
        generationId: String(decoded.generation),
        localCommitVersion: decoded.version,
      } satisfies ReplicaQueryStamp;
    }),
  );

const SummaryCountRow = Schema.Struct({ count: Schema.Number });
const SummaryValueRow = Schema.Struct({ value: Schema.String });

export const readSnapshotSubset = Effect.fn("ReplicaSnapshot.readSubset")(function* <
  Row extends ReplicaRow,
>(snapshot: ReplicaSnapshotRunner<Row>, workspaceToken: string, spec: InventorySubsetSpec) {
  const statement = yield* lowerSqliteSubset(spec);
  return yield* snapshot((query) =>
    Effect.gen(function* () {
      const stamp = yield* readSnapshotStamp(query, workspaceToken);
      const rows = yield* query(statement.sql, statement.parameters);
      return { stamp, rows } satisfies ReplicaSubsetRead;
    }),
  );
});

export const readSnapshotBatch = Effect.fn("ReplicaSnapshot.readBatch")(function* <
  Row extends ReplicaRow,
>(
  snapshot: ReplicaSnapshotRunner<Row>,
  workspaceToken: string,
  specs: ReadonlyArray<InventorySubsetSpec>,
) {
  yield* validateBatchSpecs(specs);
  const statements = yield* Effect.forEach(specs, lowerSqliteSubset);
  return yield* snapshot((query) =>
    Effect.gen(function* () {
      const stamp = yield* readSnapshotStamp(query, workspaceToken);
      const reads: Array<ReadonlyArray<Row>> = [];
      for (const statement of statements) {
        reads.push(yield* query(statement.sql, statement.parameters));
      }
      return { stamp, reads } satisfies ReplicaBatchRead;
    }),
  );
});

export const readSnapshotSummary = Effect.fn("ReplicaSnapshot.summarizeSubset")(function* (
  snapshot: ReplicaSnapshotRunner<ReplicaRow>,
  workspaceToken: string,
  spec: InventorySubsetSummarySpec,
) {
  const statements = yield* lowerSqliteSummary(spec);
  return yield* snapshot((query) =>
    Effect.gen(function* () {
      const stamp = yield* readSnapshotStamp(query, workspaceToken);
      const [countRow] = yield* Schema.decodeUnknownEffect(Schema.Array(SummaryCountRow))(
        yield* query(statements.count.sql, statements.count.parameters),
      );
      const distinct = yield* Effect.forEach(statements.distinct, ({ column, statement }) =>
        query(statement.sql, statement.parameters).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SummaryValueRow))),
          Effect.map((rows) => ({ column, values: rows.map((row) => row.value) })),
        ),
      );
      return {
        stamp,
        summary: { count: countRow?.count ?? 0, distinct },
      } satisfies ReplicaSummaryRead;
    }),
  );
});
