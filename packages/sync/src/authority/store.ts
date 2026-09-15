import {
  MAX_SYNC_PULL_TRANSACTIONS,
  padDecimalSequence,
  type CommandReceipt,
  type SyncCommandEnvelope,
} from "@store/contracts";
import {
  LAST_UNIT_BATCH_ID,
  LAST_UNIT_EPOCH,
  LAST_UNIT_ORGANIZATION_ID,
  LAST_UNIT_PRODUCT_ID,
  LAST_UNIT_REPLICA_A,
  LAST_UNIT_REPLICA_B,
} from "@store/contracts/sync/fixtures";
import {
  batches,
  categories,
  inventoryState,
  invoices,
  products,
  replicas,
} from "@store/db/inventory.schema";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { runSqliteTransaction, type SqliteDatabase } from "../sqlite";
import {
  commitPreparedCommand,
  getReceipt,
  pullTransactions,
  registerReplica,
  type InventoryActor,
  type InventoryDb,
} from "./commands";
import { INVENTORY_SCHEMA_SQL } from "./schema-sql";

export const LAST_UNIT_USER_ID = "user-1";

export const lastUnitActor: InventoryActor = {
  organizationId: LAST_UNIT_ORGANIZATION_ID,
  userId: LAST_UNIT_USER_ID,
};

export type InventoryStore = {
  readonly sqlite: Database.Database;
  readonly db: SqliteDatabase;
  readonly close: () => void;
};

export const openInventoryStore = (path = ":memory:"): InventoryStore => {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(INVENTORY_SCHEMA_SQL);
  const db = drizzle({ client: sqlite });
  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
};

export const seedLastUnitCatalog = (
  db: SqliteDatabase,
  input: {
    readonly organizationId?: string;
    readonly userId?: string;
    readonly unitQuantity?: number;
  } = {},
) => {
  const organizationId = input.organizationId ?? LAST_UNIT_ORGANIZATION_ID;
  const userId = input.userId ?? LAST_UNIT_USER_ID;
  const occurredAt = 1_700_000_000_000;
  runSqliteTransaction(db, (tx) => {
    tx.insert(inventoryState)
      .values({
        organizationId,
        status: "ready",
        epoch: LAST_UNIT_EPOCH,
        commitSequence: padDecimalSequence("0"),
        retentionFloor: padDecimalSequence("0"),
      })
      .run();
    tx.insert(categories)
      .values({
        id: "general",
        name: "General",
        tracksPacks: true,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        deletedAt: null,
        organizationId,
        createdByUserId: userId,
        updatedByUserId: userId,
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "seed-category",
        rowVersion: 1,
      })
      .run();
    tx.insert(products)
      .values({
        id: LAST_UNIT_PRODUCT_ID,
        name: "Last unit",
        categoryId: "general",
        aisle: null,
        composition: null,
        strength: null,
        unitsPerPack: 1,
        purchasePrice: 50,
        retailPrice: 100,
        unitPrice: 100,
        visible: true,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        deletedAt: null,
        organizationId,
        createdByUserId: userId,
        updatedByUserId: userId,
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "seed-product",
        rowVersion: 1,
      })
      .run();
    tx.insert(batches)
      .values({
        id: LAST_UNIT_BATCH_ID,
        productId: LAST_UNIT_PRODUCT_ID,
        batchNumber: "B-1",
        expiresAt: null,
        packQuantity: 0,
        unitQuantity: input.unitQuantity ?? 1,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        deletedAt: null,
        organizationId,
        createdByUserId: userId,
        updatedByUserId: userId,
        deviceId: LAST_UNIT_REPLICA_A,
        operationId: "seed-batch",
        rowVersion: 1,
      })
      .run();
    for (const replicaId of [LAST_UNIT_REPLICA_A, LAST_UNIT_REPLICA_B]) {
      tx.insert(replicas)
        .values({
          organizationId,
          replicaId,
          ownerUserId: userId,
          deviceLabel: replicaId,
          lastClientSequence: padDecimalSequence("0"),
        })
        .run();
    }
  });
};

export const runCommit = (
  db: SqliteDatabase,
  envelope: SyncCommandEnvelope,
  actor: InventoryActor = lastUnitActor,
  receivedAt = 1_700_000_000_000,
): CommandReceipt =>
  runSqliteTransaction(db, (tx) => commitPreparedCommand(tx, { actor, envelope, receivedAt }));

export const runRegisterReplica = (
  db: SqliteDatabase,
  request: { readonly replicaId: string; readonly deviceLabel?: string },
  actor: InventoryActor = lastUnitActor,
) => runSqliteTransaction(db, (tx) => registerReplica(tx, actor, request));

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
