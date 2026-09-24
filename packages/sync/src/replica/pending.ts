import { SyncEntity, type SyncCommandEnvelope } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import type {
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaProductRow,
} from "@store/contracts/sync/replica-model";
import {
  batches,
  categories,
  commandOutbox,
  invoices,
  pendingRowJournal,
  pendingRowMarks,
  products,
} from "@store/db/replica.schema";
import { and, eq, inArray } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeEntity, decodeRowJson, encodeRowJson } from "./codecs";
import { loadReplicaState, parseStoredEnvelope } from "./commands";
import {
  byClientSequence,
  byEntityDependency,
  decideJournalRestore,
  freeCategoryName,
  OUTSTANDING_COMMAND_STATUSES,
} from "./decisions";
import {
  projectCommand,
  type CommandProjection,
  type PendingRestoreResult,
  type ProjectionActor,
  type ReplicaCatalogLookup,
} from "./projection";
import { removeEntityRow, selectEntityRow, writeEntityRow } from "./rows";
import type { ReplicaDb } from "./sql-client/drizzle";

const decodeCategory = Schema.decodeUnknownSync(syncEntityRows.category.schema);
const decodeProduct = Schema.decodeUnknownSync(syncEntityRows.product.schema);
const decodeBatch = Schema.decodeUnknownSync(syncEntityRows.batch.schema);

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

export const replicaCatalogLookup = Effect.fn("ReplicaPending.replicaCatalogLookup")(function* (
  tx: ReplicaDb,
) {
  const categoryRows = (yield* tx.select().from(categories).all()).map((row) =>
    decodeCategory(row),
  );
  const productRows = (yield* tx.select().from(products).all()).map((row) => decodeProduct(row));
  const batchRows = (yield* tx.select().from(batches).all()).map((row) => decodeBatch(row));
  return {
    category: (categoryId: string) => categoryRows.find((row) => row.id === categoryId),
    product: (productId: string) => productRows.find((row) => row.id === productId),
    batch: (batchId: string) => batchRows.find((row) => row.id === batchId),
    productsByCategory: (categoryId: string): ReadonlyArray<ReplicaProductRow> =>
      productRows.filter((row) => row.categoryId === categoryId),
    batchesByProduct: (productId: string): ReadonlyArray<ReplicaBatchRow> =>
      batchRows.filter((row) => row.productId === productId),
  } satisfies ReplicaCatalogLookup;
});

const projectionActorFor = Effect.fn("ReplicaPending.projectionActorFor")(function* (
  tx: ReplicaDb,
) {
  const state = yield* loadReplicaState(tx);
  return {
    organizationId: state.organizationId,
    userId: state.userId,
  } satisfies ProjectionActor;
});

const withFreeCategoryName = Effect.fn("ReplicaPending.withFreeCategoryName")(function* (
  tx: ReplicaDb,
  row: ReplicaCategoryRow,
) {
  const others = (yield* tx.select().from(categories).all()).filter((other) => other.id !== row.id);
  if (!others.some((other) => other.name === row.name)) return row;
  return { ...row, name: freeCategoryName(row.name, new Set(others.map((other) => other.name))) };
});

export const writePendingProjection = Effect.fn("ReplicaPending.writePendingProjection")(function* (
  tx: ReplicaDb,
  envelope: SyncCommandEnvelope,
  renameCollidingCategories = false,
) {
  const actor = yield* projectionActorFor(tx);
  const lookup = yield* replicaCatalogLookup(tx);
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
      const prior = yield* selectEntityRow(tx, projected.entity, projected.entityId);
      yield* tx.insert(pendingRowJournal).values({
        operationId: envelope.operationId,
        entity: projected.entity,
        entityId: projected.entityId,
        priorRowJson: prior ? encodeRowJson(prior) : null,
      });
    }
    if (projected.row === null) {
      yield* removeEntityRow(tx, projected.entity, projected.entityId);
    } else if (projected.entity === "category" && renameCollidingCategories) {
      yield* writeEntityRow(tx, projected.entity, yield* withFreeCategoryName(tx, projected.row));
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
  incoming: { readonly id: string; readonly invoiceNumber: number },
  operationId: string,
) {
  const rows = yield* tx.select().from(invoices).all();
  const collision = rows.find(
    (row) => row.invoiceNumber === incoming.invoiceNumber && row.id !== incoming.id,
  );
  if (!collision) return undefined;
  const mark = yield* pendingMarkFor(tx, "invoice", collision.id);
  if (mark === undefined || mark === operationId) return undefined;
  const nextNumber =
    rows.reduce((highest, row) => Math.max(highest, row.invoiceNumber), incoming.invoiceNumber) + 1;
  yield* tx
    .update(invoices)
    .set({ invoiceNumber: nextNumber })
    .where(eq(invoices.id, collision.id));
  return `invoice:${collision.id}`;
});

export const renameCollidingShadowCategory = Effect.fn(
  "ReplicaPending.renameCollidingShadowCategory",
)(function* (
  tx: ReplicaDb,
  incoming: { readonly id: string; readonly name: string },
  operationId: string,
) {
  const rows = yield* tx.select().from(categories).all();
  const collision = rows.find((row) => row.name === incoming.name && row.id !== incoming.id);
  if (!collision) return undefined;
  const mark = yield* pendingMarkFor(tx, "category", collision.id);
  if (mark === undefined || mark === operationId) return undefined;
  const taken = new Set([incoming.name, ...rows.map((row) => row.name)]);
  yield* tx
    .update(categories)
    .set({ name: freeCategoryName(collision.name, taken) })
    .where(eq(categories.id, collision.id));
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
      yield* removeEntityRow(tx, entry.entity, entry.entityId);
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

export const reapplyPendingProjections = Effect.fn("ReplicaPending.reapplyPendingProjections")(
  function* (tx: ReplicaDb) {
    yield* tx.delete(pendingRowMarks);
    yield* tx.delete(pendingRowJournal);
    const outstanding = yield* tx
      .select()
      .from(commandOutbox)
      .where(inArray(commandOutbox.status, [...OUTSTANDING_COMMAND_STATUSES]))
      .all();
    for (const row of Array.sort(outstanding, byClientSequence)) {
      yield* writePendingProjection(tx, yield* parseStoredEnvelope(row), true);
    }
  },
);
