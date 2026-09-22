import type { SyncEntity } from "@store/contracts";
import { replicaMigrations } from "@store/db/replica/migrations";
import { betterSqliteMigrationTarget } from "@store/sync/better-sqlite-target";
import { runMigrations } from "@store/sync/migrations";
import Database from "better-sqlite3";

import { openReplicaHandleScope } from "./handle-scope";
import { createReplicaCommitPublisher, type ReplicaCommitPublisher } from "./publisher";
import { decodeReplicaStampRow, decodeSqliteResultRow } from "./sqlite-row";
import type {
  ReplicaCommitNotice,
  ReplicaHandle,
  ReplicaQueryStamp,
  SqliteParameter,
  SqliteResultRow,
} from "./types";

const toParameter = (value: SqliteParameter): string | number | bigint | Buffer | null => {
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
};

export type NodeReplicaIdentity = {
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
};

export type NodeReplicaSqlite = ReplicaHandle & {
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
  const lifetime = openReplicaHandleScope();
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  runMigrations(replicaMigrations, betterSqliteMigrationTarget(sqlite));
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
  lifetime.addSyncFinalizer(() => {
    publisher.dispose();
    sqlite.close();
  });

  const query = (
    sql: string,
    parameters: ReadonlyArray<SqliteParameter>,
  ): ReadonlyArray<SqliteResultRow> => {
    const statement = sqlite.prepare(sql);
    const bindings = parameters.map(toParameter);
    if (!statement.reader) {
      statement.run(...bindings);
      return [];
    }
    const rows = statement.all(...bindings);
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
    queryStamped: (sql, parameters) => ({
      stamp: readStamp(sqlite, workspaceToken),
      rows: query(sql, parameters),
    }),
    subscribe: publisher.subscribe,
    publish: publisher.publish,
    withWrite,
    close: lifetime.closeSync,
  };
};

export { openNodeReplicaSyncSession } from "./node-sync";
export type { NodeReplicaSyncIdentity, NodeReplicaSyncSession } from "./node-sync";
export { makeProxySyncTransport } from "./proxy-transport";
export type { SyncProxyFetch } from "./proxy-transport";
