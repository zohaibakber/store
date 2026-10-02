import { SyncEntity, type SyncCommandEnvelope } from "@store/contracts";
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
import { and, eq, sql } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  decodeEntity,
  decodeRowJson,
  encodeRowJson,
  type NamedEntity,
  type NamedImage,
  type NumberedEntity,
  type NumberedImage,
} from "./codecs";
import { nextFreeName } from "./collisions";
import { loadReplicaState } from "./commands";
import { byEntityDependency, decideJournalRestore, freeDocumentNumber } from "./decisions";
import { readHighestNumber, readNameHolder, readNumberHolder } from "./lookup";
import {
  projectCommand,
  type CommandProjection,
  type PendingRestoreResult,
  type ProjectedUpsert,
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

const freeName = Effect.fn("ReplicaPending.freeName")(function* (
  tx: ReplicaDb,
  organizationId: string,
  entity: NamedEntity,
  row: NamedImage,
) {
  const holder = yield* readNameHolder(tx, organizationId, entity, row.name, row.id);
  if (!holder) return row.name;
  return yield* nextFreeName(row.name, (candidate) =>
    readNameHolder(tx, organizationId, entity, candidate, row.id).pipe(
      Effect.map((other) => other !== undefined),
    ),
  );
});

const freeInvoiceNumber = Effect.fn("ReplicaPending.freeInvoiceNumber")(function* (
  tx: ReplicaDb,
  organizationId: string,
  row: NumberedImage,
) {
  const holder = yield* readNumberHolder(tx, organizationId, "invoice", row.number, row.id);
  if (!holder) return row.number;
  const highest = yield* readHighestNumber(tx, organizationId, "invoice", row.id);
  return freeDocumentNumber(row.number, highest);
});

const withoutCollisions = Effect.fn("ReplicaPending.withoutCollisions")(function* (
  tx: ReplicaDb,
  organizationId: string,
  projected: ProjectedUpsert,
) {
  switch (projected.entity) {
    case "category":
    case "supplier":
      return {
        ...projected.row,
        name: yield* freeName(tx, organizationId, projected.entity, projected.row),
      };
    case "invoice":
      return {
        ...projected.row,
        invoiceNumber: yield* freeInvoiceNumber(tx, organizationId, {
          id: projected.row.id,
          number: projected.row.invoiceNumber,
        }),
      };
    case "product":
    case "batch":
    case "invoiceItem":
    case "stockMovement":
    case "purchaseOrder":
    case "purchaseOrderItem":
      return projected.row;
  }
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
    } else if (resolveCollisions) {
      yield* writeEntityRow(
        tx,
        projected.entity,
        yield* withoutCollisions(tx, organizationId, projected),
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

const renumberRow = (
  tx: ReplicaDb,
  organizationId: string,
  entity: NumberedEntity,
  entityId: string,
  number: number,
) => {
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
};

export const renumberCollidingShadow = Effect.fn("ReplicaPending.renumberCollidingShadow")(
  function* (
    tx: ReplicaDb,
    organizationId: string,
    entity: NumberedEntity,
    incoming: NumberedImage,
    operationId: string,
  ) {
    const collision = yield* readNumberHolder(
      tx,
      organizationId,
      entity,
      incoming.number,
      incoming.id,
    );
    if (!collision) return undefined;
    const mark = yield* pendingMarkFor(tx, entity, collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const highest = yield* readHighestNumber(tx, organizationId, entity);
    yield* renumberRow(
      tx,
      organizationId,
      entity,
      collision.id,
      freeDocumentNumber(incoming.number, highest),
    );
    return `${entity}:${collision.id}`;
  },
);

const renameRow = (
  tx: ReplicaDb,
  organizationId: string,
  entity: NamedEntity,
  entityId: string,
  name: string,
) => {
  switch (entity) {
    case "category":
      return tx
        .update(categories)
        .set({ name })
        .where(and(eq(categories.organizationId, organizationId), eq(categories.id, entityId)));
    case "supplier":
      return tx
        .update(suppliers)
        .set({ name })
        .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.id, entityId)));
  }
};

export const renameCollidingShadow = Effect.fn("ReplicaPending.renameCollidingShadow")(function* (
  tx: ReplicaDb,
  organizationId: string,
  entity: NamedEntity,
  incoming: NamedImage,
  operationId: string,
) {
  const collision = yield* readNameHolder(tx, organizationId, entity, incoming.name, incoming.id);
  if (!collision) return undefined;
  const mark = yield* pendingMarkFor(tx, entity, collision.id);
  if (mark === undefined || mark === operationId) return undefined;
  const name = yield* nextFreeName(collision.name, (candidate) =>
    candidate === incoming.name
      ? Effect.succeed(true)
      : readNameHolder(tx, organizationId, entity, candidate, "").pipe(
          Effect.map((other) => other !== undefined),
        ),
  );
  yield* renameRow(tx, organizationId, entity, collision.id, name);
  return `${entity}:${collision.id}`;
});

const PendingPresence = Schema.Tuple([Schema.Struct({ pending: Schema.Number })]);

const decodePendingPresence = Schema.decodeUnknownEffect(PendingPresence);

export const hasPendingProjection = Effect.fn("ReplicaPending.hasPendingProjection")(function* (
  tx: ReplicaDb,
) {
  const [presence] = yield* tx
    .all(
      sql`select (exists(select 1 from ${pendingRowMarks}) or exists(select 1 from ${pendingRowJournal}) or exists(select 1 from ${stockOverlays})) as pending`,
    )
    .pipe(Effect.flatMap(decodePendingPresence));
  return presence.pending !== 0;
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
