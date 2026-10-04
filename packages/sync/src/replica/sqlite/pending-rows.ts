import {
  categories,
  commandOutbox,
  invoices,
  pendingRowJournal,
  pendingRowMarks,
  purchaseOrders,
  stockOverlays,
  suppliers,
} from "@store/db/replica.schema";
import { and, eq, max, ne, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as Effect from "effect/Effect";

import { decodeEntity } from "../codecs";
import type { PendingRowStore } from "../pending";
import { removeEntityRow, selectEntityRow, writeEntityRow } from "../rows";
import type { ReplicaDb } from "../sql-client/drizzle";

const numberedTables = {
  invoice: { table: invoices, number: invoices.invoiceNumber },
  purchaseOrder: { table: purchaseOrders, number: purchaseOrders.orderNumber },
} as const;

const namedTables = {
  category: categories,
  supplier: suppliers,
} as const;

export const sqlitePendingRows = (
  tx: ReplicaDb,
  organizationId: string,
): PendingRowStore<EffectDrizzleQueryError> => ({
  readRow: (entity, entityId) => selectEntityRow(tx, organizationId, entity, entityId),
  writeRow: (entity, row) => writeEntityRow(tx, entity, row),
  removeRow: (entity, entityId) => removeEntityRow(tx, organizationId, entity, entityId),
  markOf: (entity, entityId) =>
    tx
      .select({ operationId: pendingRowMarks.operationId })
      .from(pendingRowMarks)
      .where(and(eq(pendingRowMarks.entity, entity), eq(pendingRowMarks.entityId, entityId)))
      .get()
      .pipe(Effect.map((row) => row?.operationId)),
  setMark: (entity, entityId, operationId) =>
    operationId === undefined
      ? tx
          .delete(pendingRowMarks)
          .where(and(eq(pendingRowMarks.entity, entity), eq(pendingRowMarks.entityId, entityId)))
      : tx
          .insert(pendingRowMarks)
          .values({ entity, entityId, operationId })
          .onConflictDoUpdate({
            target: [pendingRowMarks.entity, pendingRowMarks.entityId],
            set: { operationId },
          }),
  isJournaled: (operationId, entity, entityId) =>
    tx
      .select({ operationId: pendingRowJournal.operationId })
      .from(pendingRowJournal)
      .where(
        and(
          eq(pendingRowJournal.operationId, operationId),
          eq(pendingRowJournal.entity, entity),
          eq(pendingRowJournal.entityId, entityId),
        ),
      )
      .get()
      .pipe(Effect.map((row) => row !== undefined)),
  putJournalEntry: (entry) =>
    tx
      .insert(pendingRowJournal)
      .values(entry)
      .onConflictDoUpdate({
        target: [
          pendingRowJournal.operationId,
          pendingRowJournal.entity,
          pendingRowJournal.entityId,
        ],
        set: { priorRowJson: entry.priorRowJson },
      }),
  journalOf: (operationId) =>
    tx.select().from(pendingRowJournal).where(eq(pendingRowJournal.operationId, operationId)).all(),
  journalHolders: (entity, entityId, excludedOperationId) =>
    tx
      .select({
        operationId: pendingRowJournal.operationId,
        clientSequence: commandOutbox.clientSequence,
      })
      .from(pendingRowJournal)
      .innerJoin(commandOutbox, eq(commandOutbox.operationId, pendingRowJournal.operationId))
      .where(and(eq(pendingRowJournal.entity, entity), eq(pendingRowJournal.entityId, entityId)))
      .all()
      .pipe(Effect.map((rows) => rows.filter((row) => row.operationId !== excludedOperationId))),
  dropJournalOf: (operationId) =>
    tx.delete(pendingRowJournal).where(eq(pendingRowJournal.operationId, operationId)),
  dropJournalOfRow: (entity, entityId) =>
    tx
      .delete(pendingRowJournal)
      .where(and(eq(pendingRowJournal.entity, entity), eq(pendingRowJournal.entityId, entityId))),
  clientSequenceOf: (operationId) =>
    tx
      .select({ clientSequence: commandOutbox.clientSequence })
      .from(commandOutbox)
      .where(eq(commandOutbox.operationId, operationId))
      .get()
      .pipe(Effect.map((row) => row?.clientSequence)),
  addOverlay: (overlay) => tx.insert(stockOverlays).values(overlay),
  takeOverlayBatchIds: (operationId) =>
    Effect.gen(function* () {
      const overlays = yield* tx
        .select({ batchId: stockOverlays.batchId })
        .from(stockOverlays)
        .where(eq(stockOverlays.commandId, operationId))
        .all();
      yield* tx.delete(stockOverlays).where(eq(stockOverlays.commandId, operationId));
      return overlays.map((overlay) => overlay.batchId);
    }),
  numberHolder: (entity, number, excludedId) => {
    const numbered = numberedTables[entity];
    return tx
      .select({ id: numbered.table.id })
      .from(numbered.table)
      .where(
        and(
          eq(numbered.table.organizationId, organizationId),
          eq(numbered.number, number),
          ne(numbered.table.id, excludedId),
        ),
      )
      .limit(1)
      .get();
  },
  highestNumber: (entity, excludedId) => {
    const numbered = numberedTables[entity];
    return tx
      .select({ highest: max(numbered.number) })
      .from(numbered.table)
      .where(
        excludedId === undefined
          ? eq(numbered.table.organizationId, organizationId)
          : and(
              eq(numbered.table.organizationId, organizationId),
              ne(numbered.table.id, excludedId),
            ),
      )
      .get()
      .pipe(Effect.map((row) => row?.highest ?? 0));
  },
  renumber: (entity, entityId, number) => {
    switch (entity) {
      case "invoice":
        return tx
          .update(invoices)
          .set({ invoiceNumber: number })
          .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, entityId)));
      case "purchaseOrder":
        return tx
          .update(purchaseOrders)
          .set({ orderNumber: number })
          .where(
            and(eq(purchaseOrders.organizationId, organizationId), eq(purchaseOrders.id, entityId)),
          );
    }
  },
  nameHolder: (entity, name, excludedId) => {
    const table = namedTables[entity];
    return tx
      .select({ id: table.id, name: table.name })
      .from(table)
      .where(
        and(
          eq(table.organizationId, organizationId),
          eq(table.name, name),
          ne(table.id, excludedId),
        ),
      )
      .limit(1)
      .get();
  },
  rename: (entity, entityId, name) => {
    const table = namedTables[entity];
    return tx
      .update(table)
      .set({ name })
      .where(and(eq(table.organizationId, organizationId), eq(table.id, entityId)));
  },
});

export const hasPendingProjection = Effect.fn("ReplicaPending.hasPendingProjection")(function* (
  tx: ReplicaDb,
) {
  const held = yield* tx
    .select({ held: sql`1` })
    .from(pendingRowMarks)
    .unionAll(tx.select({ held: sql`1` }).from(pendingRowJournal))
    .unionAll(tx.select({ held: sql`1` }).from(stockOverlays))
    .limit(1)
    .get();
  return held !== undefined;
});

export const listPendingMarks = Effect.fn("ReplicaPending.listPendingMarks")(function* (
  tx: ReplicaDb,
) {
  const rows = yield* tx.select().from(pendingRowMarks).all();
  return rows.map((row) => ({
    entity: decodeEntity(row.entity),
    entityId: row.entityId,
    operationId: row.operationId,
  }));
});
