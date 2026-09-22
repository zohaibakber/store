import { SyncCommandEnvelope } from "@store/contracts";
import type { CommandStatus } from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ReplicaStorageError } from "./errors";
import { makeIndexedDbReplicaStore, type IndexedDbReplicaStore } from "./indexeddb/store";

const MIGRATION_VERSION = 1;
export const INDEXED_DB_REPLICA_NAME_PREFIX = `tabaaq-replica-v${MIGRATION_VERSION}`;
export const PENDING_MIGRATION_CHECKPOINT_SUBSCRIPTION = `__pending_migration_v${MIGRATION_VERSION}__`;

export const indexedDbReplicaDatabaseName = (organizationId: string, userId: string): string =>
  `${INDEXED_DB_REPLICA_NAME_PREFIX}:${organizationId}:${userId}`;

export type PendingCommandExport = {
  readonly operationId: string;
  readonly status: CommandStatus;
  readonly envelope: SyncCommandEnvelope;
  readonly clientSequence: string;
  readonly createdAt: number;
  readonly attempts: number;
  readonly outcomeUncertain: boolean;
  readonly commitSequence: string | null;
};

export type PendingMigrationCheckpoint = {
  readonly version: number;
  readonly exportedCount: number;
  readonly importedCount: number;
  readonly verified: boolean;
};

type SqliteOutboxRow = {
  readonly operationId: string;
  readonly status: CommandStatus;
  readonly envelopeJson: string;
  readonly clientSequence: string;
  readonly createdAt: number;
  readonly attempts: number;
  readonly outcomeUncertain: number | boolean;
  readonly commitSequence: string | null;
};

export type SqlitePendingCommandSource = {
  readonly prepare: (sql: string) => {
    readonly all: (...params: ReadonlyArray<unknown>) => ReadonlyArray<SqliteOutboxRow>;
  };
};

const compareClientSequence = (left: string, right: string): number => {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
};

export const exportPendingCommandsFromSqlite = (
  sqlite: SqlitePendingCommandSource,
): ReadonlyArray<PendingCommandExport> => {
  const rows = sqlite
    .prepare(
      `select operationId, status, envelopeJson, clientSequence, createdAt, attempts,
              outcomeUncertain, commitSequence
       from command_outbox
       where status in ('pending', 'sending', 'accepted_awaiting_integration')
       order by length(clientSequence), clientSequence`,
    )
    .all();

  return rows.map((row) => {
    const envelope = Schema.decodeUnknownSync(Schema.fromJsonString(SyncCommandEnvelope))(
      row.envelopeJson,
    );
    if (envelope.operationId !== row.operationId) {
      throw ReplicaStorageError.make({
        message: `Outbox operation identity mismatch for ${row.operationId}.`,
      });
    }
    if (envelope.clientSequence !== row.clientSequence) {
      throw ReplicaStorageError.make({
        message: `Outbox sequence identity mismatch for ${row.operationId}.`,
      });
    }
    return {
      operationId: row.operationId,
      status: row.status,
      envelope,
      clientSequence: row.clientSequence,
      createdAt: row.createdAt,
      attempts: row.attempts,
      outcomeUncertain: Boolean(row.outcomeUncertain),
      commitSequence: row.commitSequence,
    };
  });
};

export const validatePendingCommandExport = (
  commands: ReadonlyArray<PendingCommandExport>,
): void => {
  const seen = new Set<string>();
  for (const command of commands) {
    if (seen.has(command.operationId)) {
      throw ReplicaStorageError.make({
        message: `Duplicate pending operation ${command.operationId}.`,
      });
    }
    seen.add(command.operationId);
    if (command.envelope.operationId !== command.operationId) {
      throw ReplicaStorageError.make({
        message: `Envelope identity does not match outbox row ${command.operationId}.`,
      });
    }
    if (command.envelope.clientSequence !== command.clientSequence) {
      throw ReplicaStorageError.make({
        message: `Envelope sequence does not match outbox row ${command.operationId}.`,
      });
    }
  }
};

const MIGRATION_STATUSES = new Set<CommandStatus>([
  "pending",
  "sending",
  "accepted_awaiting_integration",
]);

export const importPendingCommandsToIndexedDb = (
  store: IndexedDbReplicaStore,
  commands: ReadonlyArray<PendingCommandExport>,
): Effect.Effect<PendingMigrationCheckpoint, unknown> =>
  Effect.gen(function* () {
    validatePendingCommandExport(commands);
    const ordered = [...commands].sort((left, right) =>
      compareClientSequence(left.clientSequence, right.clientSequence),
    );
    let imported = 0;
    for (const command of ordered) {
      if (!MIGRATION_STATUSES.has(command.status)) {
        return yield* Effect.fail(
          ReplicaStorageError.make({
            message: `Cannot migrate settled command ${command.operationId}.`,
          }),
        );
      }
      const queued = yield* store.enqueueCommand(command.envelope, command.createdAt);
      if (queued.value.operationId !== command.operationId) {
        return yield* Effect.fail(
          ReplicaStorageError.make({
            message: `Import rewrote operation identity for ${command.operationId}.`,
          }),
        );
      }
      if (command.status !== "pending" || command.attempts > 0 || command.outcomeUncertain) {
        yield* store.restoreMigratedOutboxFields({
          operationId: command.operationId,
          status: command.status,
          attempts: command.attempts,
          outcomeUncertain: command.outcomeUncertain,
          commitSequence: command.commitSequence,
        });
      }
      imported += 1;
    }
    const checkpoint: PendingMigrationCheckpoint = {
      version: MIGRATION_VERSION,
      exportedCount: commands.length,
      importedCount: imported,
      verified: imported === commands.length,
    };
    yield* store.writePendingMigrationCheckpoint(checkpoint);
    return checkpoint;
  });

export const openIndexedDbForMigration = (input: {
  readonly databaseName: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly replicaId: string;
  readonly indexedDB: IDBFactory;
  readonly IDBKeyRange: typeof IDBKeyRange;
}) =>
  makeIndexedDbReplicaStore({
    databaseName: input.databaseName,
    databaseIdentity: input.databaseName,
    identity: {
      organizationId: input.organizationId,
      userId: input.userId,
      replicaId: input.replicaId,
    },
    indexedDB: input.indexedDB,
    IDBKeyRange: input.IDBKeyRange,
  });
