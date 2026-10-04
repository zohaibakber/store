import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
  type StatementSync,
} from "node:sqlite";

import { analyticsMigrations } from "@store/db/analytics/migrations";
import type { Query } from "drizzle-orm";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import { AnalyticsFailure, analyticsFailure } from "./errors";

const PRE_MIGRATION_SCHEMA_VERSIONS = 1;
const ANALYTICS_SCHEMA_VERSION =
  PRE_MIGRATION_SCHEMA_VERSIONS + Object.keys(analyticsMigrations).length;

const BUSY_TIMEOUT_MILLIS = 5_000;
const PREPARED_STATEMENTS = 64;
const WAL_AUTOCHECKPOINT_PAGES = 30_000;

type AnalyticsOrm = NodeSQLiteDatabase;

type AnalyticsRow = Readonly<Record<string, SQLOutputValue>>;

export type AnalyticsDatabase = {
  readonly orm: AnalyticsOrm;
  readonly statement: (sql: string) => StatementSync;
  readonly iterate: (query: Query) => IterableIterator<AnalyticsRow>;
  readonly transaction: <A>(work: () => A) => A;
  readonly checkpoint: () => void;
  readonly close: () => void;
};

const wrap = (db: DatabaseSync): AnalyticsDatabase => {
  const statements = new Map<string, StatementSync>();
  const prepare = (query: string) => {
    const cached = statements.get(query);
    if (cached !== undefined) return cached;
    if (statements.size >= PREPARED_STATEMENTS) statements.clear();
    const created = db.prepare(query);
    statements.set(query, created);
    return created;
  };
  return {
    orm: drizzle({ client: db }),
    statement: prepare,
    iterate: (query) =>
      // SAFETY: drizzle binds only strings, numbers and nulls, which node:sqlite accepts.
      prepare(query.sql).iterate(...(query.params as Array<SQLInputValue>)),
    transaction: (work) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        db.exec("COMMIT");
        return result;
      } catch (cause) {
        db.exec("ROLLBACK");
        throw cause;
      }
    },
    checkpoint: () => {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    },
    close: () => {
      statements.clear();
      db.close();
    },
  };
};

const removeFiles = (file: string) => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
};

const UserVersionRow = Schema.Struct({ user_version: Schema.Number });
const decodeUserVersion = Schema.decodeUnknownSync(UserVersionRow);

const versionOf = (db: DatabaseSync) =>
  decodeUserVersion(db.prepare("PRAGMA user_version").get()).user_version;

const initialise = (db: DatabaseSync) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const migration of Object.values(analyticsMigrations)) db.exec(migration);
    db.exec(`PRAGMA user_version = ${ANALYTICS_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
};

const closeHandle = (db: DatabaseSync) => Effect.try(() => db.close()).pipe(Effect.ignore);

const openConfigured = Effect.fnUntraced(function* (file: string) {
  const db = yield* Effect.acquireRelease(
    Effect.try({ try: () => new DatabaseSync(file), catch: analyticsFailure }),
    closeHandle,
  );
  yield* Effect.try({
    try: () => {
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLIS}`);
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
      db.exec(`PRAGMA wal_autocheckpoint = ${WAL_AUTOCHECKPOINT_PAGES}`);
      db.exec("PRAGMA temp_store = MEMORY");
    },
    catch: analyticsFailure,
  });
  return db;
});

const attempt = <A>(open: Effect.Effect<A, AnalyticsFailure, Scope.Scope>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    return yield* open.pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void)),
    );
  });

const openCurrent = (file: string) =>
  attempt(
    Effect.gen(function* () {
      const db = yield* openConfigured(file);
      const version = yield* Effect.try({ try: () => versionOf(db), catch: analyticsFailure });
      if (version !== ANALYTICS_SCHEMA_VERSION) {
        return yield* new AnalyticsFailure({ message: "The insights store is out of date." });
      }
      return db;
    }),
  );

const openFresh = (file: string) =>
  attempt(
    Effect.gen(function* () {
      yield* Effect.try({ try: () => removeFiles(file), catch: analyticsFailure });
      const db = yield* openConfigured(file);
      yield* Effect.try({ try: () => initialise(db), catch: analyticsFailure });
      return db;
    }),
  );

export const analyticsDatabasePath = (replicaDatabasePath: string): string =>
  replicaDatabasePath.endsWith(".sqlite")
    ? `${replicaDatabasePath.slice(0, -".sqlite".length)}.analytics.sqlite`
    : `${replicaDatabasePath}.analytics.sqlite`;

export const openAnalyticsDatabase = Effect.fn("openAnalyticsDatabase")(function* (file: string) {
  yield* Effect.try({
    try: () => mkdirSync(path.dirname(file), { recursive: true }),
    catch: analyticsFailure,
  });
  const db = yield* openCurrent(file).pipe(
    Effect.catch(() => openFresh(file).pipe(Effect.retry({ times: 1 }))),
  );
  return wrap(db);
});
