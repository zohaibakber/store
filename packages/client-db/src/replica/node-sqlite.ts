import type { SyncEntity } from "@store/contracts";
import { replicaMigrations } from "@store/db/replica/migrations";
import Database from "better-sqlite3";

import { createReplicaCommitPublisher, type ReplicaCommitPublisher } from "./publisher";
import {
  decodeAppliedMigrationKeys,
  decodeReplicaStampRow,
  decodeSqliteResultRow,
} from "./sqlite-row";
import type {
  ReplicaCommitNotice,
  ReplicaQueryStamp,
  ReplicaSqliteHandle,
  SqliteParameter,
  SqliteResultRow,
} from "./types";

const LEDGER_TABLE = "__store_replica_migrations";
const STATEMENT_SEPARATOR = "--> statement-breakpoint";
const MIGRATION_KEY_PATTERN = /^[0-9a-z_]+$/u;

const migrationStatements = (migration: string): ReadonlyArray<string> =>
  migration
    .split(STATEMENT_SEPARATOR)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const runReplicaMigrations = (sqlite: Database.Database): void => {
  sqlite.exec(`create table if not exists ${LEDGER_TABLE} (key text primary key not null)`);
  const applied = new Set(
    decodeAppliedMigrationKeys(sqlite.prepare(`select key from ${LEDGER_TABLE}`).pluck().all()),
  );
  for (const key of Object.keys(replicaMigrations).sort()) {
    if (applied.has(key)) continue;
    if (!MIGRATION_KEY_PATTERN.test(key)) {
      throw new Error(`Replica migration key ${key} is not a safe identifier.`);
    }
    const migration = replicaMigrations[key];
    if (migration === undefined) continue;
    for (const statement of migrationStatements(migration)) sqlite.exec(statement);
    sqlite.prepare(`insert into ${LEDGER_TABLE} (key) values (?)`).run(key);
  }
};

const toParameter = (value: SqliteParameter): string | number | bigint | Buffer | null => {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
};

export type NodeReplicaIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export type NodeReplicaSqlite = ReplicaSqliteHandle & {
  readonly publish: ReplicaCommitPublisher["publish"];
  readonly withWrite: (
    write: (sqlite: Database.Database) => void,
    touchedEntities: ReadonlyArray<SyncEntity>,
    touchedKeys: ReadonlyArray<string>,
  ) => ReplicaCommitNotice;
};

const readStamp = (sqlite: Database.Database, workspaceToken: string): ReplicaQueryStamp => {
  const decoded = decodeReplicaStampRow(
    sqlite
      .prepare(
        `select activeGeneration as generation, localCommitVersion as version from replica_state where id = 'singleton'`,
      )
      .get(),
  );
  return {
    workspaceToken,
    generationId: String(decoded.generation),
    localCommitVersion: decoded.version,
  };
};

export const openNodeReplicaSqlite = (
  identity: NodeReplicaIdentity,
  path = ":memory:",
): NodeReplicaSqlite => {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runReplicaMigrations(sqlite);
  const existing = sqlite.prepare(`select id from replica_state where id = 'singleton'`).get();
  if (existing === undefined) {
    sqlite
      .prepare(
        `insert into replica_state (
          id, organizationId, userId, replicaId, epoch, incarnation,
          appliedCommitSequence, nextClientSequence, localCommitVersion, activeGeneration
        ) values ('singleton', ?, ?, ?, '1', 'local', '0', '1', 0, 1)`,
      )
      .run(identity.organizationId, identity.userId, identity.replicaId);
  }
  const workspaceToken = crypto.randomUUID();
  const publisher = createReplicaCommitPublisher();

  const query = (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ): ReadonlyArray<SqliteResultRow> => {
    const statement = sqlite.prepare(sql);
    const rows = statement.all(...parameters.map(toParameter));
    const result: Array<SqliteResultRow> = [];
    for (const row of rows) {
      result.push(decodeSqliteResultRow(row));
    }
    return result;
  };

  const withWrite: NodeReplicaSqlite["withWrite"] = (write, touchedEntities, touchedKeys) => {
    const apply = sqlite.transaction(() => {
      write(sqlite);
      sqlite
        .prepare(
          `update replica_state set localCommitVersion = localCommitVersion + 1 where id = 'singleton'`,
        )
        .run();
      return readStamp(sqlite, workspaceToken);
    });
    const stamp = apply();
    const notice: ReplicaCommitNotice = {
      workspaceToken: stamp.workspaceToken,
      generationId: stamp.generationId,
      localCommitVersion: stamp.localCommitVersion,
      touchedEntities,
      touchedKeys,
    };
    publisher.publish(notice);
    return notice;
  };

  return {
    workspaceToken,
    stamp: () => readStamp(sqlite, workspaceToken),
    query,
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    withWrite,
    close: () => {
      publisher.dispose();
      sqlite.close();
    },
  };
};
