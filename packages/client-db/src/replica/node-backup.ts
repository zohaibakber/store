import { closeSync, copyFileSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { invoices, products, purchaseOrders, replicaState } from "@store/db/replica.schema";
import { replicaMigrations } from "@store/db/replica/migrations";
import {
  judgeMigrationLedger,
  REPLICA_LEDGER_TABLE,
  REPLICA_LEGACY_LEDGER_TABLE,
} from "@store/sync/sql-client";
import { count, eq, getTableName, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

class ReplicaFileFailure extends Schema.TaggedError<ReplicaFileFailure>()("ReplicaFileFailure", {
  reason: Schema.Literals([
    "notBackup",
    "damaged",
    "newerVersion",
    "unknownVersion",
    "busy",
    "storage",
  ]),
  message: Schema.String,
}) {}

export type ReplicaFileSummary = {
  readonly organizationId: string;
  readonly userId: string;
  readonly generation: number;
  readonly localCommitVersion: number;
  readonly products: number;
  readonly sales: number;
  readonly purchaseOrders: number;
};

const BUSY_TIMEOUT_MILLIS = 5_000;

const SQLITE_MAGIC = "SQLite format 3\u0000";

const WAL_SUFFIXES = ["-wal", "-shm"];

const FILE_SUFFIXES = ["", ...WAL_SUFFIXES, "-journal"];

const causeMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : "The file could not be read.";

const storageFailure = (cause: unknown) =>
  new ReplicaFileFailure({ reason: "storage", message: causeMessage(cause) });

const notBackup = () =>
  new ReplicaFileFailure({ reason: "notBackup", message: "This file is not a Tabaaq backup." });

const damaged = () =>
  new ReplicaFileFailure({
    reason: "damaged",
    message: "This backup file is damaged and cannot be restored.",
  });

const withDatabase = <A, E>(
  path: string,
  mode: "read" | "write",
  use: (db: DatabaseSync) => Effect.Effect<A, E>,
): Effect.Effect<A, E | ReplicaFileFailure> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => new DatabaseSync(path, { readOnly: mode === "read" }),
      catch: storageFailure,
    }),
    (db) =>
      Effect.try({
        try: () => db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MILLIS}`),
        catch: storageFailure,
      }).pipe(Effect.andThen(use(db))),
    (db) => Effect.try(() => db.close()).pipe(Effect.ignore),
  );

const removeFiles = (path: string, suffixes: ReadonlyArray<string> = FILE_SUFFIXES) =>
  Effect.forEach(
    suffixes,
    (suffix) => Effect.try(() => rmSync(`${path}${suffix}`, { force: true })).pipe(Effect.ignore),
    { discard: true },
  );

const hasSqliteHeader = (path: string): boolean => {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    return (
      readSync(file, header, 0, header.length, 0) === header.length &&
      header.toString("latin1") === SQLITE_MAGIC
    );
  } finally {
    closeSync(file);
  }
};

const decodeTables = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })));
const decodeLedger = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String })),
);
const decodeLegacyLedger = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ key: Schema.String })),
);
const decodeQuickCheck = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ quick_check: Schema.String })),
);
const decodeCheckpoint = Schema.decodeUnknownSync(Schema.Struct({ busy: Schema.Number }));
const decodeJournalMode = Schema.decodeUnknownSync(Schema.Struct({ journal_mode: Schema.String }));

const isSound = (db: DatabaseSync): boolean => {
  const rows = decodeQuickCheck(db.prepare("PRAGMA quick_check").all());
  return rows.length === 1 && rows[0]?.quick_check === "ok";
};

const appliedMigrations = (db: DatabaseSync): ReadonlyArray<string> | undefined => {
  const tables = new Set(
    decodeTables(
      db
        .prepare("select name from sqlite_master where type = 'table' and name in (?, ?)")
        .all(REPLICA_LEDGER_TABLE, REPLICA_LEGACY_LEDGER_TABLE),
    ).map((table) => table.name),
  );
  if (tables.size === 0) return undefined;
  const current = tables.has(REPLICA_LEDGER_TABLE)
    ? decodeLedger(
        db.prepare(`select migration_id as id, name from "${REPLICA_LEDGER_TABLE}"`).all(),
      ).map((row) => `${row.id}_${row.name}`)
    : [];
  const legacy = tables.has(REPLICA_LEGACY_LEDGER_TABLE)
    ? decodeLegacyLedger(db.prepare(`select key from "${REPLICA_LEGACY_LEDGER_TABLE}"`).all()).map(
        (row) => row.key,
      )
    : [];
  return [...current, ...legacy];
};

const singleton = eq(replicaState.id, "singleton");

const summarize = (db: DatabaseSync): ReplicaFileSummary | undefined => {
  const orm = drizzle({ client: db });
  const state = orm
    .select({
      organizationId: replicaState.organizationId,
      userId: replicaState.userId,
      generation: replicaState.activeGeneration,
      localCommitVersion: replicaState.localCommitVersion,
    })
    .from(replicaState)
    .where(singleton)
    .get();
  if (state === undefined) return undefined;
  const present = new Set(
    decodeTables(db.prepare("select name from sqlite_master where type = 'table'").all()).map(
      (table) => table.name,
    ),
  );
  const rowsOf = (table: SQLiteTable): number =>
    present.has(getTableName(table))
      ? (orm.select({ rows: count() }).from(table).get()?.rows ?? 0)
      : 0;
  return {
    ...state,
    products: rowsOf(products),
    sales: rowsOf(invoices),
    purchaseOrders: rowsOf(purchaseOrders),
  };
};

const ledgerFailure = (
  verdict: Exclude<ReturnType<typeof judgeMigrationLedger>, "openable">,
): ReplicaFileFailure => {
  switch (verdict) {
    case "newer":
      return new ReplicaFileFailure({
        reason: "newerVersion",
        message: "This backup was made by a newer version of Tabaaq. Update the app, then restore.",
      });
    case "unknown":
      return new ReplicaFileFailure({
        reason: "unknownVersion",
        message: "This backup was made by a version of Tabaaq that this app cannot read.",
      });
  }
};

const inspect = (path: string): Effect.Effect<ReplicaFileSummary, ReplicaFileFailure> =>
  withDatabase(path, "read", (db) =>
    Effect.gen(function* () {
      if (!(yield* Effect.try({ try: () => isSound(db), catch: damaged }))) return yield* damaged();
      const applied = yield* Effect.try({ try: () => appliedMigrations(db), catch: damaged });
      if (applied === undefined) return yield* notBackup();
      const verdict = judgeMigrationLedger(applied, replicaMigrations);
      if (verdict !== "openable") return yield* ledgerFailure(verdict);
      const summary = yield* Effect.try({ try: () => summarize(db), catch: damaged });
      return summary === undefined ? yield* notBackup() : summary;
    }),
  );

export const readReplicaFileSummary = Effect.fn("ReplicaBackup.readSummary")(function* (
  path: string,
) {
  const summary = yield* withDatabase(path, "read", (db) =>
    Effect.try({ try: () => summarize(db), catch: storageFailure }),
  );
  return summary === undefined ? yield* notBackup() : summary;
});

const useRollbackJournal = (db: DatabaseSync) =>
  Effect.try({
    try: () => decodeJournalMode(db.prepare("PRAGMA journal_mode = DELETE").get()).journal_mode,
    catch: storageFailure,
  }).pipe(
    Effect.flatMap((mode) =>
      mode === "delete"
        ? Effect.void
        : Effect.fail(
            new ReplicaFileFailure({
              reason: "busy",
              message: "The file is still in use and could not be finished.",
            }),
          ),
    ),
  );

export const backUpReplicaFile = Effect.fn("ReplicaBackup.backUp")(function* (input: {
  readonly databasePath: string;
  readonly destinationPath: string;
}) {
  const partial = `${input.destinationPath}.${crypto.randomUUID()}.partial`;
  return yield* Effect.gen(function* () {
    yield* withDatabase(input.databasePath, "read", (db) =>
      Effect.try({
        try: () => {
          db.prepare("VACUUM INTO ?").run(partial);
        },
        catch: storageFailure,
      }),
    );
    yield* withDatabase(partial, "write", useRollbackJournal);
    return yield* Effect.try({
      try: () => {
        renameSync(partial, input.destinationPath);
        return { bytes: statSync(input.destinationPath).size };
      },
      catch: storageFailure,
    });
  }).pipe(Effect.onError(() => removeFiles(partial)));
});

export const stageReplicaBackup = Effect.fn("ReplicaBackup.stage")(function* (input: {
  readonly sourcePath: string;
  readonly stagedPath: string;
}) {
  const recognised = yield* Effect.try({
    try: () => hasSqliteHeader(input.sourcePath),
    catch: storageFailure,
  });
  if (!recognised) return yield* notBackup();
  return yield* Effect.try({
    try: () => copyFileSync(input.sourcePath, input.stagedPath),
    catch: storageFailure,
  }).pipe(
    Effect.andThen(inspect(input.stagedPath)),
    Effect.onError(() => removeFiles(input.stagedPath)),
  );
});

export const discardReplicaFile = (path: string): Effect.Effect<void> => removeFiles(path);

export const settleReplicaFile = Effect.fn("ReplicaBackup.settle")(function* (path: string) {
  const busy = yield* withDatabase(path, "write", (db) =>
    Effect.try({
      try: () => decodeCheckpoint(db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()).busy,
      catch: storageFailure,
    }),
  );
  if (busy !== 0) {
    return yield* new ReplicaFileFailure({
      reason: "busy",
      message: "The workspace is still being read. Try again in a moment.",
    });
  }
});

export const sealReplicaFile = Effect.fn("ReplicaBackup.seal")(function* (
  path: string,
  versionFloor: number,
) {
  yield* withDatabase(path, "write", (db) =>
    Effect.try({
      try: () => {
        drizzle({ client: db })
          .update(replicaState)
          .set({
            localCommitVersion: sql`max(${replicaState.localCommitVersion}, ${versionFloor}) + 1`,
          })
          .where(singleton)
          .run();
      },
      catch: storageFailure,
    }).pipe(Effect.andThen(useRollbackJournal(db))),
  );
  yield* removeFiles(path, WAL_SUFFIXES);
});
