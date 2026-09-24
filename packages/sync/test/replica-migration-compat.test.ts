import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { categories } from "@store/db/replica.schema";
import { replicaMigrations } from "@store/db/replica/migrations";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { migrationStatements } from "../src/migrations";
import { openReplicaStore, runReplicaTransaction } from "../src/replica/storage";

const LEDGER_TABLE = "__store_sync_migrations";

const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })));
const decodeKeys = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ key: Schema.String })));

const runLegacyMigrations = (database: DatabaseSync, migrations: Record<string, string>): void => {
  database
    .prepare(`create table if not exists ${LEDGER_TABLE} (key text primary key not null)`)
    .run();
  const applied = new Set(
    decodeKeys(database.prepare(`select key from ${LEDGER_TABLE}`).all()).map((row) => row.key),
  );
  for (const key of Object.keys(migrations).sort()) {
    if (applied.has(key)) continue;
    const migration = migrations[key];
    if (migration === undefined) continue;
    for (const statement of migrationStatements(migration)) database.prepare(statement).run();
    database.prepare(`insert into ${LEDGER_TABLE} (key) values (?)`).run(key);
  }
};

const HARD_DELETE_MIGRATION = "20260922140000_drop_replica_soft_deletes";

const legacyDatabaseAt = (path: string, throughLastMigration: boolean): void => {
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  const keys = Object.keys(replicaMigrations).sort();
  const selected = throughLastMigration ? keys : keys.slice(0, keys.indexOf(HARD_DELETE_MIGRATION));
  runLegacyMigrations(
    database,
    Object.fromEntries(selected.map((key) => [key, replicaMigrations[key] ?? ""])),
  );
  const insertCategory = database.prepare(
    `insert into categories (
      id, name, tracksPacks, createdAt, updatedAt${throughLastMigration ? "" : ", deletedAt"},
      organizationId, createdByUserId, updatedByUserId, deviceId, operationId, rowVersion
    ) values (?, ?, 1, 1, 1, ${throughLastMigration ? "" : "?, "}'org-1', 'user-1', 'user-1', 'replica-1', 'seed', 1)`,
  );
  if (throughLastMigration) {
    insertCategory.run("category-live", "Live");
  } else {
    insertCategory.run("category-live", "Live", null);
    insertCategory.run("category-gone", "Gone", 2);
  }
  database.close();
};

const temporaryPath = (name: string): string =>
  join(mkdtempSync(join(tmpdir(), "store-replica-compat-")), name);

describe("replica migration history", () => {
  it("upgrades a database the previous runner left before the hard-delete migration", async () => {
    const path = temporaryPath("legacy.sqlite");
    legacyDatabaseAt(path, false);
    const rows = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openReplicaStore(path);
          return yield* runReplicaTransaction(store, (tx) =>
            tx.select({ id: categories.id }).from(categories).all(),
          );
        }),
      ),
    );
    expect(rows.map((row) => row.id)).toStrictEqual(["category-live"]);
  });

  it("reapplies nothing when the previous runner already applied every migration", async () => {
    const path = temporaryPath("current.sqlite");
    legacyDatabaseAt(path, true);
    const seen = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openReplicaStore(path);
          const ledger = yield* store.sql.unsafe(`select key from ${LEDGER_TABLE} order by key`);
          const rows = yield* store.sql.unsafe(`select id from categories`);
          const journal = yield* store.sql.unsafe(`PRAGMA journal_mode`);
          return {
            keys: decodeKeys(ledger).map((row) => row.key),
            ids: decodeIds(rows).map((row) => row.id),
            journal,
          };
        }),
      ),
    );
    expect(seen.keys).toStrictEqual(Object.keys(replicaMigrations).sort());
    expect(seen.ids).toStrictEqual(["category-live"]);
    expect(seen.journal).toEqual([{ journal_mode: "wal" }]);
  });
});
