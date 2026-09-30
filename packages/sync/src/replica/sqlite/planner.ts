import { generationState } from "@store/db/replica.schema";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SqlClient } from "effect/unstable/sql/SqlClient";

import { makeReplicaDb } from "../sql-client/drizzle";
import { GENERATION_TABLES } from "./generation";

const ANALYSIS_LIMIT = 1_000;

const OPTIMIZE_EVERY_TABLE = "0x10002";

export const PLANNER_START_DELAY = Duration.seconds(30);

export const PLANNER_CHECK_INTERVAL = Duration.seconds(30);

export const PLANNER_REFRESH_MILLIS = 3_600_000;

export const PLANNER_IDLE_MILLIS = 2_000;

const PLANNER_TURN_MILLIS = 250;

type PlannerMaintenance = "optimized" | "seeding" | "deferred";

const decodeNameRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ name: Schema.String })),
);

const decodeIndexRows = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ name: Schema.String, table: Schema.String })),
);

const tableList = GENERATION_TABLES.map((table) => `'${table}'`).join(", ");

const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

export const maintainReplicaPlanner = Effect.fn("ReplicaPlanner.maintain")(function* (
  sql: SqlClient,
  budgetMillis: number = PLANNER_TURN_MILLIS,
) {
  const db = yield* makeReplicaDb(sql);
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* sql.reserve;
      const query = (statement: string) =>
        connection.execute(statement, [], undefined).pipe(Effect.orDie);
      const run = (statement: string) => connection.executeUnprepared(statement, [], undefined);
      const generation = yield* db
        .select({ standby: generationState.standby })
        .from(generationState)
        .get()
        .pipe(Effect.provideService(sql.transactionService, [connection, 0]), Effect.orDie);
      if (generation?.standby !== "empty") return "deferred" satisfies PlannerMaintenance;
      const analysed = yield* query(
        "select name from sqlite_master where type = 'table' and name = 'sqlite_stat1'",
      ).pipe(Effect.flatMap(decodeNameRows), Effect.orDie);
      const candidates = yield* query(
        `select name, tbl_name as "table" from sqlite_master where type = 'index' and tbl_name in (${tableList})${
          analysed.length === 0
            ? ""
            : " and name not in (select idx from sqlite_stat1 where idx is not null)"
        } order by tbl_name not in ('invoice_items', 'stock_movements'), tbl_name, name`,
      ).pipe(Effect.flatMap(decodeIndexRows), Effect.orDie);
      const occupied = yield* Effect.filter(
        [...new Set(candidates.map((candidate) => candidate.table))],
        (table) =>
          query(`select 1 from ${quoted(table)} limit 1`).pipe(
            Effect.map((rows) => rows.length > 0),
          ),
      );
      const unanalysed = candidates.filter((candidate) => occupied.includes(candidate.table));
      yield* run(`pragma analysis_limit = ${ANALYSIS_LIMIT}`);
      return yield* Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis;
        for (const [position, index] of unanalysed.entries()) {
          yield* run(`analyze ${quoted(index.name)}`);
          const more = position < unanalysed.length - 1;
          if (more && (yield* Clock.currentTimeMillis) - started >= budgetMillis) {
            return "seeding" satisfies PlannerMaintenance;
          }
        }
        yield* run(`pragma optimize = ${OPTIMIZE_EVERY_TABLE}`);
        return "optimized" satisfies PlannerMaintenance;
      }).pipe(Effect.ensuring(run("pragma analysis_limit = 0").pipe(Effect.ignore)));
    }),
  );
});
