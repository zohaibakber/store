import { syncProtocolError, type SyncEntity } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/replica.schema";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ReplicaDb } from "../sql-client/drizzle";
import { standbyTable } from "./generation";

const entityTables = {
  category: { table: categories, rowVersion: categories.rowVersion },
  product: { table: products, rowVersion: products.rowVersion },
  batch: { table: batches, rowVersion: batches.rowVersion },
  invoice: { table: invoices, rowVersion: invoices.rowVersion },
  invoiceItem: { table: invoiceItems, rowVersion: invoiceItems.rowVersion },
  stockMovement: { table: stockMovements, rowVersion: undefined },
} as const;

const UPSERTED_ROWS_PER_STATEMENT = 400;

const SnapshotCell = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
type SnapshotCell = typeof SnapshotCell.Type;

const SnapshotRecord = Schema.Record(Schema.String, SnapshotCell);
type SnapshotRecord = typeof SnapshotRecord.Type;

const decodeSnapshotRecord = Schema.decodeUnknownSync(SnapshotRecord);

const cell = (value: SnapshotCell | undefined): string | number | null =>
  value === true ? 1 : value === false ? 0 : (value ?? null);

const upsertStatement = (
  entity: SyncEntity,
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<SnapshotRecord>,
): SQL => {
  const { table, rowVersion } = entityTables[entity];
  const conflictTarget = sql.join(
    [table.organizationId, table.id].map((column) => sql.identifier(column.name)),
    sql`, `,
  );
  const newerRowVersion =
    rowVersion === undefined
      ? sql``
      : sql` where excluded.${sql.identifier(rowVersion.name)} >= ${sql.identifier(rowVersion.name)}`;
  const columnList = sql.join(
    columns.map((column) => sql.identifier(column)),
    sql`, `,
  );
  const tuples = sql.join(
    rows.map(
      (row) =>
        sql`(${sql.join(
          columns.map((column) => sql`${cell(row[column])}`),
          sql`, `,
        )})`,
    ),
    sql`, `,
  );
  const assignments = sql.join(
    columns.map((column) => sql`${sql.identifier(column)} = excluded.${sql.identifier(column)}`),
    sql`, `,
  );
  return sql`insert into ${sql.identifier(standbyTable(getTableName(table)))} (${columnList}) values ${tuples} on conflict (${conflictTarget}) do update set ${assignments}${newerRowVersion}`;
};

const invalid = () =>
  syncProtocolError("SNAPSHOT_UNAVAILABLE", "The snapshot part contained an invalid row.");

export const upsertSnapshotRows = Effect.fn("ReplicaSnapshotRows.upsert")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  rows: ReadonlyArray<unknown>,
) {
  const columns = Object.values(getTableColumns(entityTables[entity].table)).map(
    (column) => column.name,
  );
  const decode = Schema.decodeUnknownSync(syncEntityRows[entity].schema);
  const decoded = yield* Effect.try({
    try: () => rows.map((row) => decodeSnapshotRecord(decode(row))),
    catch: invalid,
  });
  for (const chunk of Array.chunksOf(decoded, UPSERTED_ROWS_PER_STATEMENT)) {
    yield* tx.run(upsertStatement(entity, columns, chunk));
  }
});
