import {
  compareDecimalSequence,
  type SyncEntity,
  type SyncLiveServerFrame,
  type SyncPullResult,
  type SyncTransactionGroup,
} from "@store/contracts";
import {
  replicaEntitySchemas,
  type ReplicaBatchRow,
  type ReplicaCategoryRow,
  type ReplicaInvoiceItemRow,
  type ReplicaInvoiceRow,
  type ReplicaProductRow,
  type ReplicaStockMovementRow,
} from "@store/contracts/sync/replica-model";
import {
  batches,
  categories,
  commandOutbox,
  invoiceItems,
  invoices,
  products,
  replicaState,
  stockMovements,
  stockOverlays,
} from "@store/db/replica.schema";
import { eq } from "drizzle-orm";
import * as Schema from "effect/Schema";

import { runWrite } from "../sqlite";
import { loadReplicaState } from "./commands";
import { updateCoverageFromPull } from "./coverage";
import { shouldApplyCommitSequence } from "./decisions";
import type { ReplicaDb } from "./storage";

export type PullApplyResult = {
  readonly appliedThrough: string;
  readonly repairRequired: boolean;
};

export type ReplicaFeedMode =
  | {
      readonly _tag: "catchingUp";
      readonly targetCommitSequence: string;
    }
  | {
      readonly _tag: "following";
    };

export const isFollowingFeed = (feed: ReplicaFeedMode): boolean => feed._tag === "following";

export const feedAfterPull = (
  feed: ReplicaFeedMode,
  pulled: SyncPullResult,
  appliedThrough: string,
): ReplicaFeedMode => {
  if (compareDecimalSequence(appliedThrough, pulled.horizon) >= 0) {
    return { _tag: "following" };
  }
  return {
    _tag: "catchingUp",
    targetCommitSequence: pulled.horizon,
  };
};

const softDelete = (
  tx: ReplicaDb,
  table:
    | typeof categories
    | typeof products
    | typeof batches
    | typeof invoices
    | typeof invoiceItems,
  entityId: string,
  deletedAt: number,
): void => {
  const existing = tx.select().from(table).where(eq(table.id, entityId)).get();
  if (!existing) return;
  runWrite(tx.update(table).set({ deletedAt }).where(eq(table.id, entityId)));
};

const upsertCategory = (tx: ReplicaDb, row: ReplicaCategoryRow): void => {
  const existing = tx.select().from(categories).where(eq(categories.id, row.id)).get();
  if (existing) {
    runWrite(tx.update(categories).set(row).where(eq(categories.id, row.id)));
    return;
  }
  runWrite(tx.insert(categories).values(row));
};

const upsertProduct = (tx: ReplicaDb, row: ReplicaProductRow): void => {
  const existing = tx.select().from(products).where(eq(products.id, row.id)).get();
  if (existing) {
    runWrite(tx.update(products).set(row).where(eq(products.id, row.id)));
    return;
  }
  runWrite(tx.insert(products).values(row));
};

const upsertBatch = (tx: ReplicaDb, row: ReplicaBatchRow): void => {
  const existing = tx.select().from(batches).where(eq(batches.id, row.id)).get();
  if (existing) {
    runWrite(tx.update(batches).set(row).where(eq(batches.id, row.id)));
    return;
  }
  runWrite(tx.insert(batches).values(row));
};

const upsertInvoice = (tx: ReplicaDb, row: ReplicaInvoiceRow): void => {
  const existing = tx.select().from(invoices).where(eq(invoices.id, row.id)).get();
  if (existing) {
    runWrite(tx.update(invoices).set(row).where(eq(invoices.id, row.id)));
    return;
  }
  runWrite(tx.insert(invoices).values(row));
};

const upsertInvoiceItem = (tx: ReplicaDb, row: ReplicaInvoiceItemRow): void => {
  const existing = tx.select().from(invoiceItems).where(eq(invoiceItems.id, row.id)).get();
  if (existing) {
    runWrite(tx.update(invoiceItems).set(row).where(eq(invoiceItems.id, row.id)));
    return;
  }
  runWrite(tx.insert(invoiceItems).values(row));
};

const upsertStockMovement = (tx: ReplicaDb, row: ReplicaStockMovementRow): void => {
  const existing = tx.select().from(stockMovements).where(eq(stockMovements.id, row.id)).get();
  if (existing) {
    runWrite(tx.update(stockMovements).set(row).where(eq(stockMovements.id, row.id)));
    return;
  }
  runWrite(tx.insert(stockMovements).values(row));
};

const deleteTimestamp = (row: {
  readonly deletedAt?: number | null;
  readonly updatedAt?: number;
}): number => row.deletedAt ?? row.updatedAt ?? Date.now();

const applyChange = (tx: ReplicaDb, change: SyncTransactionGroup["changes"][number]): void => {
  const entity: SyncEntity = change.entity;
  if (change.action === "delete") {
    switch (entity) {
      case "category": {
        const row = Schema.decodeUnknownSync(replicaEntitySchemas.category)(change.row);
        softDelete(tx, categories, change.entityId, deleteTimestamp(row));
        return;
      }
      case "product": {
        const row = Schema.decodeUnknownSync(replicaEntitySchemas.product)(change.row);
        softDelete(tx, products, change.entityId, deleteTimestamp(row));
        return;
      }
      case "batch": {
        const row = Schema.decodeUnknownSync(replicaEntitySchemas.batch)(change.row);
        softDelete(tx, batches, change.entityId, deleteTimestamp(row));
        return;
      }
      case "invoice": {
        const row = Schema.decodeUnknownSync(replicaEntitySchemas.invoice)(change.row);
        softDelete(tx, invoices, change.entityId, deleteTimestamp(row));
        return;
      }
      case "invoiceItem": {
        const row = Schema.decodeUnknownSync(replicaEntitySchemas.invoiceItem)(change.row);
        softDelete(tx, invoiceItems, change.entityId, deleteTimestamp(row));
        return;
      }
      case "stockMovement": {
        runWrite(tx.delete(stockMovements).where(eq(stockMovements.id, change.entityId)));
        return;
      }
    }
  }
  switch (entity) {
    case "category":
      upsertCategory(tx, Schema.decodeUnknownSync(replicaEntitySchemas.category)(change.row));
      return;
    case "product":
      upsertProduct(tx, Schema.decodeUnknownSync(replicaEntitySchemas.product)(change.row));
      return;
    case "batch":
      upsertBatch(tx, Schema.decodeUnknownSync(replicaEntitySchemas.batch)(change.row));
      return;
    case "invoice":
      upsertInvoice(tx, Schema.decodeUnknownSync(replicaEntitySchemas.invoice)(change.row));
      return;
    case "invoiceItem":
      upsertInvoiceItem(tx, Schema.decodeUnknownSync(replicaEntitySchemas.invoiceItem)(change.row));
      return;
    case "stockMovement":
      upsertStockMovement(
        tx,
        Schema.decodeUnknownSync(replicaEntitySchemas.stockMovement)(change.row),
      );
      return;
  }
};

export const applyTransactionGroup = (tx: ReplicaDb, group: SyncTransactionGroup) => {
  const state = loadReplicaState(tx);
  if (!shouldApplyCommitSequence(state.appliedCommitSequence, group.commitSequence)) {
    return state.appliedCommitSequence;
  }
  for (const change of group.changes) {
    applyChange(tx, change);
  }
  runWrite(tx.delete(stockOverlays).where(eq(stockOverlays.commandId, group.operationId)));
  const outbox = tx
    .select()
    .from(commandOutbox)
    .where(eq(commandOutbox.operationId, group.operationId))
    .get();
  if (outbox && outbox.status !== "rejected") {
    runWrite(
      tx
        .update(commandOutbox)
        .set({ status: "integrated" })
        .where(eq(commandOutbox.operationId, group.operationId)),
    );
  }
  runWrite(
    tx
      .update(replicaState)
      .set({
        appliedCommitSequence: group.commitSequence,
        localCommitVersion: state.localCommitVersion + 1,
      })
      .where(eq(replicaState.id, state.id)),
  );
  return group.commitSequence;
};

export const applyPullResult = (tx: ReplicaDb, pulled: SyncPullResult): PullApplyResult => {
  let appliedThrough = loadReplicaState(tx).appliedCommitSequence;
  for (const group of pulled.transactions) {
    appliedThrough = applyTransactionGroup(tx, group);
  }
  const coverage = updateCoverageFromPull(tx, pulled, appliedThrough);
  return { appliedThrough, repairRequired: coverage.repairRequired };
};

export const applyLiveFrame = (
  tx: ReplicaDb,
  feed: ReplicaFeedMode,
  frame: Extract<SyncLiveServerFrame, { readonly _tag: "transactions" }>,
): boolean => {
  if (!isFollowingFeed(feed)) return false;
  for (const group of frame.transactions) {
    applyTransactionGroup(tx, group);
  }
  return true;
};
