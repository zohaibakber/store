import {
  MAX_SYNC_PULL_TRANSACTIONS,
  OPERATIONAL_SUBSCRIPTION,
  type CommandReceipt,
  type SyncCommandEnvelope,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
} from "@store/contracts/sync/fixtures";
import { batches, commandReceipts, inventoryState, invoices } from "@store/db/inventory.schema";
import { inventoryMigrations } from "@store/db/inventory/migrations";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { betterSqliteMigrationTarget } from "../better-sqlite-target";
import { runMigrations } from "../migrations";
import { runSqlSavepoint, runSqliteTransaction, type SqliteDatabase } from "../sqlite";
import {
  commitPreparedCommand,
  getReceipt,
  pullTransactions,
  registerReplica,
  type InventoryActor,
  type InventoryDb,
} from "./commands";
import { lastUnitActor } from "./seed";

export { LAST_UNIT_USER_ID, lastUnitActor, seedLastUnitCatalog } from "./seed";

export type InventoryStore = {
  readonly sqlite: Database.Database;
  readonly db: SqliteDatabase;
  readonly close: () => void;
};

export const openInventoryStore = (path = ":memory:"): InventoryStore => {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  runMigrations(inventoryMigrations, betterSqliteMigrationTarget(sqlite));
  const db = drizzle({ client: sqlite });
  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
};

export const runCommit = (
  db: SqliteDatabase,
  envelope: SyncCommandEnvelope,
  actor: InventoryActor = lastUnitActor,
  receivedAt = 1_700_000_000_000,
): CommandReceipt =>
  runSqliteTransaction(db, (tx) =>
    commitPreparedCommand(tx, {
      actor,
      envelope,
      receivedAt,
      isolateAttempt: (run) => runSqlSavepoint(tx, "command_attempt", run),
    }),
  );

export const runRegisterReplica = (
  db: SqliteDatabase,
  request: { readonly replicaId: string; readonly deviceLabel?: string },
  actor: InventoryActor = lastUnitActor,
) => runSqliteTransaction(db, (tx) => registerReplica(tx, actor, request, 1_700_000_000_000));

export const runGetReceipt = (
  db: SqliteDatabase,
  operationId: string,
  actor: InventoryActor = lastUnitActor,
) => runSqliteTransaction(db, (tx) => getReceipt(tx, actor, operationId));

export const runPull = (
  db: SqliteDatabase,
  input: {
    readonly epoch?: string;
    readonly afterCommitSequence?: string;
    readonly limit?: number;
  } = {},
  actor: InventoryActor = lastUnitActor,
) =>
  runSqliteTransaction(db, (tx) =>
    pullTransactions(tx, {
      organizationId: actor.organizationId,
      epoch: input.epoch ?? LAST_UNIT_EPOCH,
      subscription: OPERATIONAL_SUBSCRIPTION,
      afterCommitSequence: input.afterCommitSequence ?? "0",
      limit: input.limit ?? MAX_SYNC_PULL_TRANSACTIONS,
    }),
  );

export const loadBatch = (db: InventoryDb, batchId = LAST_UNIT_BATCH_ID) =>
  db
    .select()
    .from(batches)
    .where(and(eq(batches.organizationId, LAST_UNIT_ORGANIZATION_ID), eq(batches.id, batchId)))
    .get();

export const countInvoices = (db: InventoryDb) => db.select().from(invoices).all().length;

export const loadReceiptAttempts = (
  db: InventoryDb,
  operationId: string,
  organizationId = LAST_UNIT_ORGANIZATION_ID,
) =>
  db
    .select({
      attempts: commandReceipts.attempts,
      decision: commandReceipts.decision,
      resultJson: commandReceipts.resultJson,
    })
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.organizationId, organizationId),
        eq(commandReceipts.operationId, operationId),
      ),
    )
    .get();

export const loadInventoryHead = (db: InventoryDb, organizationId = LAST_UNIT_ORGANIZATION_ID) =>
  db.select().from(inventoryState).where(eq(inventoryState.organizationId, organizationId)).get();
