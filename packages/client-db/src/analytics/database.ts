import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import { analyticsFailure, type AnalyticsFailure } from "./errors";

const ANALYTICS_SCHEMA_VERSION = 2;

const BUSY_TIMEOUT_MILLIS = 5_000;
const PREPARED_STATEMENTS = 64;
const WAL_AUTOCHECKPOINT_PAGES = 30_000;

export type AnalyticsParameter = string | number | null;

type AnalyticsCell = string | number | bigint | Uint8Array | null;

type AnalyticsRow = Readonly<Record<string, AnalyticsCell>>;

export type AnalyticsDatabase = {
  readonly run: (sql: string, parameters?: ReadonlyArray<AnalyticsParameter>) => void;
  readonly all: (
    sql: string,
    parameters?: ReadonlyArray<AnalyticsParameter>,
  ) => ReadonlyArray<AnalyticsRow>;
  readonly iterate: (
    sql: string,
    parameters?: ReadonlyArray<AnalyticsParameter>,
  ) => IterableIterator<AnalyticsRow>;
  readonly get: (
    sql: string,
    parameters?: ReadonlyArray<AnalyticsParameter>,
  ) => AnalyticsRow | undefined;
  readonly transaction: <A>(work: () => A) => A;
  readonly close: () => void;
};

const SCHEMA = [
  `CREATE TABLE published (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    runId INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    kind TEXT NOT NULL,
    completedAt INTEGER NOT NULL,
    generatedAt INTEGER NOT NULL,
    sourceGeneration TEXT NOT NULL,
    sourceVersion INTEGER NOT NULL,
    policyVersion TEXT NOT NULL,
    algorithmVersion INTEGER NOT NULL,
    today INTEGER NOT NULL,
    utcOffsetMinutes INTEGER NOT NULL,
    productCount INTEGER NOT NULL,
    summaryJson TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE run_sequence (id INTEGER PRIMARY KEY AUTOINCREMENT) STRICT`,
  `CREATE TABLE product_insight (
    runId INTEGER NOT NULL,
    productId TEXT NOT NULL,
    name TEXT NOT NULL,
    nameKey TEXT NOT NULL,
    status TEXT NOT NULL,
    abc TEXT NOT NULL,
    priority REAL NOT NULL,
    hasOrder INTEGER NOT NULL,
    revenue90d REAL NOT NULL,
    unitCost REAL,
    trend TEXT NOT NULL,
    periodRevenue7 REAL NOT NULL,
    periodUnits7 REAL NOT NULL,
    periodRevenue30 REAL NOT NULL,
    periodUnits30 REAL NOT NULL,
    periodRevenue90 REAL NOT NULL,
    periodUnits90 REAL NOT NULL,
    valueAtCost INTEGER NOT NULL,
    valueAtRetail INTEGER NOT NULL,
    deadStockValue INTEGER NOT NULL,
    expiryRiskValue INTEGER NOT NULL,
    expiredValue INTEGER NOT NULL,
    reorderCost INTEGER NOT NULL,
    missingCost INTEGER NOT NULL,
    insightJson TEXT NOT NULL,
    PRIMARY KEY (runId, productId)
  ) STRICT`,
  `CREATE INDEX product_insight_restock_idx
    ON product_insight (runId, priority DESC, nameKey, productId, status, hasOrder)`,
  `CREATE TABLE insight_alert (
    runId INTEGER NOT NULL,
    productId TEXT NOT NULL,
    kind TEXT NOT NULL,
    severityRank INTEGER NOT NULL,
    impact REAL NOT NULL,
    alertJson TEXT NOT NULL,
    PRIMARY KEY (runId, productId, kind)
  ) WITHOUT ROWID, STRICT`,
  `CREATE INDEX insight_alert_rank_idx ON insight_alert (runId, severityRank, impact DESC)`,
  `CREATE TABLE expiring_batch (
    runId INTEGER NOT NULL,
    productId TEXT NOT NULL,
    seq INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    batchJson TEXT NOT NULL,
    PRIMARY KEY (runId, productId, seq)
  ) WITHOUT ROWID, STRICT`,
  `CREATE INDEX expiring_batch_expiry_idx ON expiring_batch (runId, expiresAt, productId, seq)`,
  `CREATE TABLE work_sales (
    runId INTEGER NOT NULL,
    productId TEXT NOT NULL,
    day INTEGER NOT NULL,
    units REAL NOT NULL,
    revenue REAL NOT NULL,
    PRIMARY KEY (runId, productId, day)
  ) WITHOUT ROWID, STRICT`,
  `CREATE TABLE work_product (
    runId INTEGER NOT NULL,
    productId TEXT NOT NULL,
    stagedJson TEXT NOT NULL,
    PRIMARY KEY (runId, productId)
  ) WITHOUT ROWID, STRICT`,
] as const;

const wrap = (db: DatabaseSync): AnalyticsDatabase => {
  const statements = new Map<string, StatementSync>();
  const prepare = (sql: string) => {
    const cached = statements.get(sql);
    if (cached !== undefined) return cached;
    if (statements.size >= PREPARED_STATEMENTS) statements.clear();
    const created = db.prepare(sql);
    statements.set(sql, created);
    return created;
  };
  const bind = (parameters: ReadonlyArray<AnalyticsParameter>) =>
    // SAFETY: AnalyticsParameter is a subset of the values node:sqlite accepts as bindings.
    parameters as Array<SQLInputValue>;
  return {
    run: (sql, parameters = []) => {
      prepare(sql).run(...bind(parameters));
    },
    all: (sql, parameters = []) => prepare(sql).all(...bind(parameters)),
    iterate: (sql, parameters = []) => prepare(sql).iterate(...bind(parameters)),
    get: (sql, parameters = []) => prepare(sql).get(...bind(parameters)),
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
    close: () => {
      statements.clear();
      db.close();
    },
  };
};

const removeFiles = (file: string) => {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(`${file}${suffix}`, { force: true });
};

const openConfigured = (file: string) => {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLIS}`);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`PRAGMA wal_autocheckpoint = ${WAL_AUTOCHECKPOINT_PAGES}`);
  db.exec("PRAGMA temp_store = MEMORY");
  return db;
};

const UserVersionRow = Schema.Struct({ user_version: Schema.Number });
const decodeUserVersion = Schema.decodeUnknownSync(UserVersionRow);

const versionOf = (db: DatabaseSync) =>
  decodeUserVersion(db.prepare("PRAGMA user_version").get()).user_version;

const initialise = (db: DatabaseSync) => {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of SCHEMA) db.exec(statement);
    db.exec(`PRAGMA user_version = ${ANALYTICS_SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
};

const openReady = (file: string): DatabaseSync => {
  const db = openConfigured(file);
  const version = versionOf(db);
  if (version === ANALYTICS_SCHEMA_VERSION) return db;
  db.close();
  removeFiles(file);
  const fresh = openConfigured(file);
  initialise(fresh);
  return fresh;
};

export const analyticsDatabasePath = (replicaDatabasePath: string): string =>
  replicaDatabasePath.endsWith(".sqlite")
    ? `${replicaDatabasePath.slice(0, -".sqlite".length)}.analytics.sqlite`
    : `${replicaDatabasePath}.analytics.sqlite`;

export const openAnalyticsDatabase = (
  file: string,
): Effect.Effect<AnalyticsDatabase, AnalyticsFailure, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        mkdirSync(path.dirname(file), { recursive: true });
        try {
          return wrap(openReady(file));
        } catch {
          removeFiles(file);
          return wrap(openReady(file));
        }
      },
      catch: analyticsFailure,
    }),
    (database) => Effect.sync(() => database.close()).pipe(Effect.ignore),
  );
