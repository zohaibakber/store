import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Semaphore from "effect/Semaphore";

import { ReplicaSnapshotFailure } from "./errors";
import type { ReplicaSnapshotRunner, SnapshotQuery } from "./snapshot-read";

export type NodeSqliteRow = Record<string, SQLOutputValue>;

const READ_BUSY_TIMEOUT_MILLIS = 5_000;

const PREPARED_STATEMENTS = 128;

const snapshotFailure = (cause: unknown) =>
  new ReplicaSnapshotFailure({
    message: cause instanceof Error ? cause.message : "The replica snapshot read failed.",
  });

export const openReadonlySnapshotRunner = (path: string) =>
  Effect.gen(function* () {
    const db = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new DatabaseSync(path, { readOnly: true }),
        catch: snapshotFailure,
      }),
      (opened) => Effect.sync(() => opened.close()),
    );
    db.exec(`PRAGMA busy_timeout = ${READ_BUSY_TIMEOUT_MILLIS}`);
    const turn = yield* Semaphore.make(1);
    const statements = yield* Cache.makeWith(
      (sql: string) => Effect.try({ try: () => db.prepare(sql), catch: snapshotFailure }),
      {
        capacity: PREPARED_STATEMENTS,
        timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
      },
    );
    const query: SnapshotQuery<NodeSqliteRow> = (sql, parameters) =>
      Cache.get(statements, sql).pipe(
        Effect.flatMap((statement) =>
          Effect.try({
            try: () => statement.all(...parameters),
            catch: snapshotFailure,
          }),
        ),
      );
    const runner: ReplicaSnapshotRunner<NodeSqliteRow> = (work) =>
      turn.withPermits(1)(
        Effect.acquireUseRelease(
          Effect.try({ try: () => db.exec("BEGIN"), catch: snapshotFailure }),
          () => work(query),
          () => Effect.try(() => db.exec("ROLLBACK")).pipe(Effect.ignore),
        ),
      );
    return runner;
  });
