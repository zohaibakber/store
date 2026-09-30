import { SqliteReplica, type SqliteReplicaHandle } from "@store/sync/sql-client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { lowerSqliteSubset, lowerSqliteSummary } from "./compile";
import { UnsupportedSubsetQuery, type ReplicaSnapshotFailure } from "./errors";
import { MAX_BATCH_ROWS, MAX_BATCH_SPECS } from "./sources";
import { decodeReplicaStampRow, decodeSqliteResultRow } from "./sqlite-row";
import type { InventorySubsetSpec, InventorySubsetSummarySpec } from "./subset-spec";
import type {
  ReplicaBatchRead,
  ReplicaQueryStamp,
  ReplicaSubsetRead,
  ReplicaSummaryRead,
  SqliteParameter,
  SqliteResultRow,
} from "./types";

type SnapshotFailure = SqlError | ReplicaSnapshotFailure;

export type SnapshotQuery = (
  sql: string,
  parameters: ReadonlyArray<SqliteParameter>,
) => Effect.Effect<ReadonlyArray<SqliteResultRow>, SnapshotFailure>;

export type ReplicaSnapshotRunner = <A, E>(
  work: (query: SnapshotQuery) => Effect.Effect<A, E>,
) => Effect.Effect<A, E | SnapshotFailure>;

export class ReplicaSnapshotReader extends Context.Service<
  ReplicaSnapshotReader,
  ReplicaSnapshotRunner
>()("@store/client-db/ReplicaSnapshotReader") {}

const STAMP_SQL =
  'select "activeGeneration" as generation, "localCommitVersion" as version from replica_state where id = \'singleton\'';

export const snapshotRunnerFromHandle =
  (handle: SqliteReplicaHandle): ReplicaSnapshotRunner =>
  (work) =>
    handle.sql.withTransaction(
      Effect.suspend(() =>
        work((sql, parameters) =>
          handle.sql
            .unsafe(sql, parameters)
            .pipe(Effect.map((rows) => rows.map((row) => decodeSqliteResultRow(row)))),
        ),
      ),
    );

export const layerHandleSnapshotReader: Layer.Layer<ReplicaSnapshotReader, never, SqliteReplica> =
  Layer.effect(ReplicaSnapshotReader)(
    SqliteReplica.use((handle) => Effect.succeed(snapshotRunnerFromHandle(handle))),
  );

const readSnapshotStamp = (
  query: SnapshotQuery,
  workspaceToken: string,
): Effect.Effect<ReplicaQueryStamp, SnapshotFailure> =>
  query(STAMP_SQL, []).pipe(
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

export const readSnapshotSubset = Effect.fn("ReplicaSnapshot.readSubset")(function* (
  snapshot: ReplicaSnapshotRunner,
  workspaceToken: string,
  spec: InventorySubsetSpec,
) {
  const statement = yield* lowerSqliteSubset(spec);
  return yield* snapshot((query) =>
    Effect.gen(function* () {
      const stamp = yield* readSnapshotStamp(query, workspaceToken);
      const rows = yield* query(statement.sql, statement.parameters);
      return { stamp, rows } satisfies ReplicaSubsetRead;
    }),
  );
});

export const validateBatchSpecs = (specs: ReadonlyArray<InventorySubsetSpec>) =>
  specs.length === 0 ||
  specs.length > MAX_BATCH_SPECS ||
  specs.some((spec) => spec.limit > MAX_BATCH_ROWS)
    ? Effect.fail(
        new UnsupportedSubsetQuery({
          message: `Unsupported batch read: at most ${MAX_BATCH_SPECS} specifications of ${MAX_BATCH_ROWS} rows`,
          reason: `batch of ${specs.length} specifications exceeds the bound`,
        }),
      )
    : Effect.void;

export const readSnapshotBatch = Effect.fn("ReplicaSnapshot.readBatch")(function* (
  snapshot: ReplicaSnapshotRunner,
  workspaceToken: string,
  specs: ReadonlyArray<InventorySubsetSpec>,
) {
  yield* validateBatchSpecs(specs);
  const statements = yield* Effect.forEach(specs, lowerSqliteSubset);
  return yield* snapshot((query) =>
    Effect.gen(function* () {
      const stamp = yield* readSnapshotStamp(query, workspaceToken);
      const reads: Array<ReadonlyArray<SqliteResultRow>> = [];
      for (const statement of statements) {
        reads.push(yield* query(statement.sql, statement.parameters));
      }
      return { stamp, reads } satisfies ReplicaBatchRead;
    }),
  );
});

export const readSnapshotSummary = Effect.fn("ReplicaSnapshot.summarizeSubset")(function* (
  snapshot: ReplicaSnapshotRunner,
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
