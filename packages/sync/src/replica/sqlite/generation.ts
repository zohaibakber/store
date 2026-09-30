import { SyncTransactionGroup } from "@store/contracts";
import {
  batches,
  categories,
  generationJournal,
  generationState,
  invoiceItems,
  invoices,
  pendingRowJournal,
  pendingRowMarks,
  products,
  snapshotStagedRows,
  stockMovements,
  stockOverlays,
} from "@store/db/replica.schema";
import { eq, getTableName, max, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ReplicaStorageError } from "../errors";
import type { ReplicaDb } from "../sql-client/drizzle";

export const GENERATION_TABLES = [
  categories,
  products,
  batches,
  invoices,
  invoiceItems,
  stockMovements,
  pendingRowMarks,
  pendingRowJournal,
  stockOverlays,
].map(getTableName);

export const GENERATION_SEARCH_TABLES = ["products_search"] as const;

const STANDBY_SUFFIX = "_standby";

const SWAP_SUFFIX = "_swap";

const CLEANUP_FIRST_CHUNK_ROWS = 250;

const CLEANUP_MAX_CHUNK_ROWS = 20_000;

const CLEANUP_TURN_MILLIS = 60;

export const IMPORT_TURN_MILLIS = 120;

export const IMPORT_TURN_INITIAL_ROWS = 500;

export const IMPORT_TURN_MIN_ROWS = 50;

export const IMPORT_TURN_MAX_ROWS = 2_000;

export const IMPORT_FLUSH_PARTS = 4;

export const IMPORT_WAL_CHECKPOINT_PAGES = 4_000;

export const IMPORT_CACHE_SIZE = -65_536;

const ANALYSIS_LIMIT = 1_000;

export const standbyTable = (table: string): string => `${table}${STANDBY_SUFFIX}`;

const GroupJson = Schema.fromJsonString(SyncTransactionGroup);

export const encodeGroupJson = Schema.encodeSync(GroupJson);

export const decodeGroupJson = Schema.decodeUnknownEffect(GroupJson);

type JournalEntry = typeof generationJournal.$inferInsert;

export const loadGenerationState = Effect.fn("ReplicaGeneration.loadState")(function* (
  tx: ReplicaDb,
) {
  const row = yield* tx.select().from(generationState).get();
  if (!row) {
    return yield* Effect.fail(
      ReplicaStorageError.make({ message: "Replica generation state is missing." }),
    );
  }
  return row;
});

const rename = (tx: ReplicaDb, from: string, to: string) =>
  tx.run(sql`alter table ${sql.identifier(from)} rename to ${sql.identifier(to)}`);

const swapNames = (tx: ReplicaDb, table: string) =>
  Effect.gen(function* () {
    yield* rename(tx, table, `${table}${SWAP_SUFFIX}`);
    yield* rename(tx, standbyTable(table), table);
    yield* rename(tx, `${table}${SWAP_SUFFIX}`, standbyTable(table));
  });

export const swapGenerationRoles = Effect.fn("ReplicaGeneration.swapRoles")(function* (
  tx: ReplicaDb,
) {
  yield* tx.run(sql`pragma legacy_alter_table = on`);
  yield* Effect.forEach(GENERATION_TABLES, (table) => swapNames(tx, table), {
    discard: true,
  }).pipe(Effect.ensuring(tx.run(sql`pragma legacy_alter_table = off`).pipe(Effect.orDie)));
});

export const swapSearchIndexes = Effect.fn("ReplicaGeneration.swapSearchIndexes")(function* (
  tx: ReplicaDb,
) {
  yield* tx.run(sql`pragma legacy_alter_table = off`);
  yield* Effect.forEach(GENERATION_SEARCH_TABLES, (table) => swapNames(tx, table), {
    discard: true,
  });
});

export const withStandbyActive = <A, E, R>(
  tx: ReplicaDb,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | EffectDrizzleQueryError, R> =>
  swapGenerationRoles(tx).pipe(
    Effect.andThen(effect),
    Effect.tap(() => swapGenerationRoles(tx)),
  );

export const recordActiveMutation = Effect.fn("ReplicaGeneration.recordMutation")(function* (
  tx: ReplicaDb,
  entry: () => JournalEntry,
) {
  const state = yield* loadGenerationState(tx);
  if (state.standby !== "candidate") return;
  yield* tx.insert(generationJournal).values(entry());
});

export const journalHead = Effect.fn("ReplicaGeneration.journalHead")(function* (tx: ReplicaDb) {
  const row = yield* tx
    .select({ head: max(generationJournal.seq) })
    .from(generationJournal)
    .get();
  return row?.head ?? 0;
});

const tableExists = Effect.fn("ReplicaGeneration.tableExists")(function* (
  tx: ReplicaDb,
  name: string,
) {
  const rows = yield* tx.all<unknown>(
    sql`select 1 from sqlite_master where type = 'table' and name = ${name}`,
  );
  return rows.length > 0;
});

const dropStandbyStatistics = Effect.fn("ReplicaGeneration.dropStandbyStatistics")(function* (
  tx: ReplicaDb,
) {
  if (!(yield* tableExists(tx, "sqlite_stat1"))) return;
  yield* Effect.forEach(
    GENERATION_TABLES,
    (table) => tx.run(sql`delete from sqlite_stat1 where tbl = ${standbyTable(table)}`),
    { discard: true },
  );
});

type CleanupTarget = {
  readonly table: string;
  readonly search: boolean;
  readonly bulk: boolean;
};

type CleanupStep = { readonly remaining: boolean; readonly awaitingIdle: boolean };

export type BulkClear = "defer" | "allow";

export const BULK_CLEAR_IDLE_MILLIS = 1_000;

const BULK_CLEARED_TABLES: ReadonlyArray<string> = [
  batches,
  invoices,
  invoiceItems,
  stockMovements,
].map(getTableName);

const LEFTOVER_TARGETS: ReadonlyArray<CleanupTarget> = [generationJournal, snapshotStagedRows].map(
  (table) => ({ table: getTableName(table), search: false, bulk: false }),
);

const RETIRED_TARGETS: ReadonlyArray<CleanupTarget> = [
  ...GENERATION_SEARCH_TABLES.map((table) => ({
    table: standbyTable(table),
    search: true,
    bulk: false,
  })),
  ...GENERATION_TABLES.filter((table) => !BULK_CLEARED_TABLES.includes(table)).map((table) => ({
    table: standbyTable(table),
    search: false,
    bulk: false,
  })),
  ...LEFTOVER_TARGETS,
  ...BULK_CLEARED_TABLES.map((table) => ({
    table: standbyTable(table),
    search: false,
    bulk: true,
  })),
];

const cleanupTargets = (standby: typeof generationState.$inferSelect.standby) =>
  standby === "retired" ? RETIRED_TARGETS : LEFTOVER_TARGETS;

const isEmpty = Effect.fn("ReplicaGeneration.isEmpty")(function* (tx: ReplicaDb, table: string) {
  const rows = yield* tx.all<unknown>(sql`select rowid from ${sql.identifier(table)} limit 1`);
  return rows.length === 0;
});

const hasTriggers = Effect.fn("ReplicaGeneration.hasTriggers")(function* (
  tx: ReplicaDb,
  table: string,
) {
  const rows = yield* tx.all<unknown>(
    sql`select 1 from sqlite_master where type = 'trigger' and tbl_name = ${table} limit 1`,
  );
  return rows.length > 0;
});

const deleteChunk = Effect.fn("ReplicaGeneration.deleteChunk")(function* (
  tx: ReplicaDb,
  table: string,
  rows: number,
) {
  const deleted = yield* tx.all<unknown>(
    sql`delete from ${sql.identifier(table)} where rowid in (select rowid from ${sql.identifier(table)} order by rowid limit ${rows}) returning 1`,
  );
  return deleted.length;
});

const nextChunkRows = (deleted: number, tookMillis: number, leftMillis: number): number =>
  Math.min(
    CLEANUP_MAX_CHUNK_ROWS,
    Math.max(
      CLEANUP_FIRST_CHUNK_ROWS,
      Math.floor((deleted / Math.max(1, tookMillis)) * leftMillis),
    ),
  );

const clearTarget = Effect.fn("ReplicaGeneration.clearTarget")(function* (
  tx: ReplicaDb,
  target: CleanupTarget,
  deadline: number,
) {
  if (target.search) {
    yield* tx.run(
      sql`insert into ${sql.identifier(target.table)} (${sql.identifier(target.table)}) values ('delete-all')`,
    );
    return;
  }
  if (!(yield* hasTriggers(tx, target.table))) {
    yield* tx.run(sql`delete from ${sql.identifier(target.table)}`);
    return;
  }
  let rows = CLEANUP_FIRST_CHUNK_ROWS;
  let started = yield* Clock.currentTimeMillis;
  let deleted = yield* deleteChunk(tx, target.table, rows);
  let finished = yield* Clock.currentTimeMillis;
  while (deleted === rows && finished < deadline) {
    rows = nextChunkRows(deleted, finished - started, deadline - finished);
    started = finished;
    deleted = yield* deleteChunk(tx, target.table, rows);
    finished = yield* Clock.currentTimeMillis;
  }
});

export const clearRetiredStep = Effect.fn("ReplicaGeneration.clearRetiredStep")(function* (
  tx: ReplicaDb,
  bulkClear: BulkClear = "allow",
  budgetMillis: number = CLEANUP_TURN_MILLIS,
) {
  const state = yield* loadGenerationState(tx);
  if (state.standby === "candidate") {
    return { remaining: false, awaitingIdle: false } satisfies CleanupStep;
  }
  const deadline = (yield* Clock.currentTimeMillis) + budgetMillis;
  for (const target of cleanupTargets(state.standby)) {
    while (!(yield* isEmpty(tx, target.table))) {
      if (target.bulk && bulkClear === "defer") {
        return { remaining: true, awaitingIdle: true } satisfies CleanupStep;
      }
      yield* clearTarget(tx, target, deadline);
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        return { remaining: true, awaitingIdle: false } satisfies CleanupStep;
      }
    }
  }
  if (state.standby === "retired") {
    yield* dropStandbyStatistics(tx);
    yield* tx
      .update(generationState)
      .set({ standby: "empty", candidateSnapshotId: null })
      .where(eq(generationState.id, state.id));
  }
  return { remaining: false, awaitingIdle: false } satisfies CleanupStep;
});

export const refreshPlannerStats = Effect.fn("ReplicaGeneration.refreshPlannerStats")(function* (
  tx: ReplicaDb,
) {
  const state = yield* loadGenerationState(tx);
  if (!state.statsStale) return false;
  if (yield* tableExists(tx, "sqlite_stat1")) {
    yield* tx.run(sql.raw(`pragma analysis_limit = ${ANALYSIS_LIMIT}`));
    yield* Effect.forEach(
      GENERATION_TABLES,
      (table) => tx.run(sql`analyze ${sql.identifier(table)}`),
      {
        discard: true,
      },
    ).pipe(Effect.ensuring(tx.run(sql.raw("pragma analysis_limit = 0")).pipe(Effect.orDie)));
  }
  yield* tx
    .update(generationState)
    .set({ statsStale: false })
    .where(eq(generationState.id, state.id));
  return true;
});
