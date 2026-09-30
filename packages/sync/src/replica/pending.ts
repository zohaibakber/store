import { SyncEntity, type SyncCommandEnvelope } from "@store/contracts";
import type { ReplicaCategoryRow, ReplicaInvoiceRow } from "@store/contracts/sync/replica-model";
import {
  categories,
  commandOutbox,
  invoices,
  pendingRowJournal,
  pendingRowMarks,
} from "@store/db/replica.schema";
import { and, eq } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";

import { decodeEntity, decodeRowJson, encodeRowJson } from "./codecs";
import { nextFreeCategoryName } from "./collisions";
import { loadReplicaState } from "./commands";
import { byEntityDependency, decideJournalRestore, freeInvoiceNumber } from "./decisions";
import {
  readCategoryNameHolder,
  readHighestInvoiceNumber,
  readInvoiceNumberHolder,
} from "./lookup";
import {
  projectCommand,
  type CommandProjection,
  type PendingRestoreResult,
  type ProjectionActor,
  type ReplicaCatalogLookup,
} from "./projection";
import { removeEntityRow, selectEntityRow, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";

const pendingMarkFor = Effect.fn("ReplicaPending.pendingMarkFor")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
) {
  const row = yield* tx
    .select()
    .from(pendingRowMarks)
    .where(and(eq(pendingRowMarks.entity, entity), eq(pendingRowMarks.entityId, entityId)))
    .get();
  return row?.operationId;
});

const clearMark = Effect.fn("ReplicaPending.clearMark")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
) {
  yield* tx
    .delete(pendingRowMarks)
    .where(and(eq(pendingRowMarks.entity, entity), eq(pendingRowMarks.entityId, entityId)));
});

const withFreeInvoiceNumber = Effect.fn("ReplicaPending.withFreeInvoiceNumber")(function* (
  tx: ReplicaDb,
  organizationId: string,
  row: ReplicaInvoiceRow,
) {
  const holder = yield* readInvoiceNumberHolder(tx, organizationId, row.invoiceNumber, row.id);
  if (!holder) return row;
  const highest = yield* readHighestInvoiceNumber(tx, organizationId, row.id);
  return { ...row, invoiceNumber: freeInvoiceNumber(row.invoiceNumber, highest) };
});

const withFreeCategoryName = Effect.fn("ReplicaPending.withFreeCategoryName")(function* (
  tx: ReplicaDb,
  organizationId: string,
  row: ReplicaCategoryRow,
) {
  const holder = yield* readCategoryNameHolder(tx, organizationId, row.name, row.id);
  if (!holder) return row;
  const name = yield* nextFreeCategoryName(row.name, (candidate) =>
    readCategoryNameHolder(tx, organizationId, candidate, row.id).pipe(
      Effect.map((other) => other !== undefined),
    ),
  );
  return { ...row, name };
});

export const writePendingProjection = Effect.fn("ReplicaPending.writePendingProjection")(function* (
  tx: ReplicaDb,
  envelope: SyncCommandEnvelope,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
  resolveCollisions = false,
) {
  const { organizationId } = actor;
  const projection = projectCommand(envelope, actor, lookup);
  for (const projected of projection.rows) {
    const journaled = yield* tx
      .select()
      .from(pendingRowJournal)
      .where(
        and(
          eq(pendingRowJournal.operationId, envelope.operationId),
          eq(pendingRowJournal.entity, projected.entity),
          eq(pendingRowJournal.entityId, projected.entityId),
        ),
      )
      .get();
    if (!journaled) {
      const prior = yield* selectEntityRow(
        tx,
        organizationId,
        projected.entity,
        projected.entityId,
      );
      yield* tx.insert(pendingRowJournal).values({
        operationId: envelope.operationId,
        entity: projected.entity,
        entityId: projected.entityId,
        priorRowJson: prior ? encodeRowJson(prior) : null,
      });
    }
    if (projected.row === null) {
      yield* removeEntityRow(tx, organizationId, projected.entity, projected.entityId);
    } else if (projected.entity === "category" && resolveCollisions) {
      yield* writeEntityRow(
        tx,
        projected.entity,
        yield* withFreeCategoryName(tx, organizationId, projected.row),
      );
    } else if (projected.entity === "invoice" && resolveCollisions) {
      yield* writeEntityRow(
        tx,
        projected.entity,
        yield* withFreeInvoiceNumber(tx, organizationId, projected.row),
      );
    } else {
      yield* writeEntityRow(tx, projected.entity, projected.row);
    }
    yield* tx
      .insert(pendingRowMarks)
      .values({
        entity: projected.entity,
        entityId: projected.entityId,
        operationId: envelope.operationId,
      })
      .onConflictDoUpdate({
        target: [pendingRowMarks.entity, pendingRowMarks.entityId],
        set: { operationId: envelope.operationId },
      });
  }
  return projection satisfies CommandProjection;
});

export const renumberCollidingShadowInvoice = Effect.fn(
  "ReplicaPending.renumberCollidingShadowInvoice",
)(function* (
  tx: ReplicaDb,
  organizationId: string,
  incoming: { readonly id: string; readonly invoiceNumber: number },
  operationId: string,
) {
  const collision = yield* readInvoiceNumberHolder(
    tx,
    organizationId,
    incoming.invoiceNumber,
    incoming.id,
  );
  if (!collision) return undefined;
  const mark = yield* pendingMarkFor(tx, "invoice", collision.id);
  if (mark === undefined || mark === operationId) return undefined;
  const highest = yield* readHighestInvoiceNumber(tx, organizationId);
  yield* tx
    .update(invoices)
    .set({ invoiceNumber: freeInvoiceNumber(incoming.invoiceNumber, highest) })
    .where(and(eq(invoices.organizationId, organizationId), eq(invoices.id, collision.id)));
  return `invoice:${collision.id}`;
});

export const renameCollidingShadowCategory = Effect.fn(
  "ReplicaPending.renameCollidingShadowCategory",
)(function* (
  tx: ReplicaDb,
  organizationId: string,
  incoming: { readonly id: string; readonly name: string },
  operationId: string,
) {
  const collision = yield* readCategoryNameHolder(tx, organizationId, incoming.name, incoming.id);
  if (!collision) return undefined;
  const mark = yield* pendingMarkFor(tx, "category", collision.id);
  if (mark === undefined || mark === operationId) return undefined;
  const name = yield* nextFreeCategoryName(collision.name, (candidate) =>
    candidate === incoming.name
      ? Effect.succeed(true)
      : readCategoryNameHolder(tx, organizationId, candidate, "").pipe(
          Effect.map((other) => other !== undefined),
        ),
  );
  yield* tx
    .update(categories)
    .set({ name })
    .where(and(eq(categories.organizationId, organizationId), eq(categories.id, collision.id)));
  return `category:${collision.id}`;
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

export const clearPendingProjection = Effect.fn("ReplicaPending.clearPendingProjection")(function* (
  tx: ReplicaDb,
  operationId: string,
) {
  yield* tx.delete(pendingRowMarks).where(eq(pendingRowMarks.operationId, operationId));
  yield* tx.delete(pendingRowJournal).where(eq(pendingRowJournal.operationId, operationId));
});

const setMark = Effect.fn("ReplicaPending.setMark")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
  operationId: string | undefined,
) {
  if (operationId === undefined) {
    yield* clearMark(tx, entity, entityId);
    return;
  }
  yield* tx
    .insert(pendingRowMarks)
    .values({ entity, entityId, operationId })
    .onConflictDoUpdate({
      target: [pendingRowMarks.entity, pendingRowMarks.entityId],
      set: { operationId },
    });
});

const journalHoldersFor = Effect.fn("ReplicaPending.journalHoldersFor")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
  excludedOperationId: string,
) {
  const rows = yield* tx
    .select({
      operationId: pendingRowJournal.operationId,
      clientSequence: commandOutbox.clientSequence,
    })
    .from(pendingRowJournal)
    .innerJoin(commandOutbox, eq(commandOutbox.operationId, pendingRowJournal.operationId))
    .where(and(eq(pendingRowJournal.entity, entity), eq(pendingRowJournal.entityId, entityId)))
    .all();
  return rows.filter((row) => row.operationId !== excludedOperationId);
});

export const restorePendingProjection = Effect.fn("ReplicaPending.restorePendingProjection")(
  function* (tx: ReplicaDb, operationId: string) {
    const { organizationId } = yield* loadReplicaState(tx);
    const outbox = yield* tx
      .select({ clientSequence: commandOutbox.clientSequence })
      .from(commandOutbox)
      .where(eq(commandOutbox.operationId, operationId))
      .get();
    const rejected = { operationId, clientSequence: outbox?.clientSequence ?? "0" };
    const entries = yield* tx
      .select()
      .from(pendingRowJournal)
      .where(eq(pendingRowJournal.operationId, operationId))
      .all();
    const touchedEntities = new Set<SyncEntity>();
    const touchedKeys: Array<string> = [];
    const ordered = Array.sort(
      entries.map((entry) => ({
        entity: decodeEntity(entry.entity),
        entityId: entry.entityId,
        priorRowJson: entry.priorRowJson,
      })),
      byEntityDependency,
    );
    const restores: Array<{
      readonly entity: SyncEntity;
      readonly entityId: string;
      readonly priorRowJson: string | null;
      readonly nextMark: string | undefined;
    }> = [];
    for (const entry of ordered) {
      const mark = yield* pendingMarkFor(tx, entry.entity, entry.entityId);
      const others = yield* journalHoldersFor(tx, entry.entity, entry.entityId, operationId);
      const decision = decideJournalRestore(rejected, mark, others);
      if (decision._tag === "handDown") {
        yield* tx
          .update(pendingRowJournal)
          .set({ priorRowJson: entry.priorRowJson })
          .where(
            and(
              eq(pendingRowJournal.operationId, decision.successor),
              eq(pendingRowJournal.entity, entry.entity),
              eq(pendingRowJournal.entityId, entry.entityId),
            ),
          );
      }
      if (decision._tag === "restore") restores.push({ ...entry, nextMark: decision.nextMark });
    }
    for (const entry of restores) {
      if (entry.priorRowJson === null) continue;
      yield* writeEntityRow(tx, entry.entity, decodeRowJson(entry.priorRowJson));
    }
    for (const entry of [...restores].reverse()) {
      if (entry.priorRowJson !== null) continue;
      yield* removeEntityRow(tx, organizationId, entry.entity, entry.entityId);
    }
    for (const entry of restores) {
      yield* setMark(tx, entry.entity, entry.entityId, entry.nextMark);
      touchedEntities.add(entry.entity);
      touchedKeys.push(`${entry.entity}:${entry.entityId}`);
    }
    yield* tx.delete(pendingRowJournal).where(eq(pendingRowJournal.operationId, operationId));
    return {
      touchedEntities: [...touchedEntities],
      touchedKeys,
    } satisfies PendingRestoreResult;
  },
);

export const resolveRemoteRow = Effect.fn("ReplicaPending.resolveRemoteRow")(function* (
  tx: ReplicaDb,
  entity: SyncEntity,
  entityId: string,
) {
  yield* tx
    .delete(pendingRowJournal)
    .where(and(eq(pendingRowJournal.entity, entity), eq(pendingRowJournal.entityId, entityId)));
  yield* clearMark(tx, entity, entityId);
});
