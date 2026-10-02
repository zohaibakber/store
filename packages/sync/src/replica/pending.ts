import type {
  SyncCommandEnvelope,
  SyncEntity,
  SyncEntityChange,
  SyncTransactionGroup,
} from "@store/contracts";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";

import {
  decodeEntity,
  decodeNamedRow,
  decodeNumberedRow,
  decodeRowJson,
  encodeRowJson,
  type NamedEntity,
  type NamedImage,
  type NumberedEntity,
  type NumberedImage,
} from "./codecs";
import { nextFreeName } from "./collisions";
import {
  mergeTouched,
  touchedOfChange,
  touchedOfKey,
  withStockTouched,
  type TouchedSet,
} from "./commit-hub";
import {
  byEntityDependency,
  decideJournalRestore,
  decideOverlays,
  freeDocumentNumber,
  type JournalHolder,
  type StockOverlayDelta,
} from "./decisions";
import type { CommandContext } from "./footprint";
import {
  projectCommand,
  type CommandProjection,
  type PendingRestoreResult,
  type ProjectedRow,
  type ProjectedUpsert,
  type ProjectionActor,
  type ReplicaCatalogLookup,
  type ReplicaEntityRowImage,
} from "./projection";

type PendingJournalEntry = {
  readonly operationId: string;
  readonly entity: SyncEntity;
  readonly entityId: string;
  readonly priorRowJson: string | null;
};

type StoredJournalEntry = {
  readonly entity: string;
  readonly entityId: string;
  readonly priorRowJson: string | null;
};

export type PendingRowStore<E> = {
  readonly readRow: (
    entity: SyncEntity,
    entityId: string,
  ) => Effect.Effect<ReplicaEntityRowImage | undefined, E>;
  readonly writeRow: (
    entity: SyncEntity,
    row: SyncEntityChange["row"],
  ) => Effect.Effect<unknown, E>;
  readonly removeRow: (entity: SyncEntity, entityId: string) => Effect.Effect<unknown, E>;
  readonly markOf: (entity: SyncEntity, entityId: string) => Effect.Effect<string | undefined, E>;
  readonly setMark: (
    entity: SyncEntity,
    entityId: string,
    operationId: string | undefined,
  ) => Effect.Effect<unknown, E>;
  readonly isJournaled: (
    operationId: string,
    entity: SyncEntity,
    entityId: string,
  ) => Effect.Effect<boolean, E>;
  readonly putJournalEntry: (entry: PendingJournalEntry) => Effect.Effect<unknown, E>;
  readonly journalOf: (operationId: string) => Effect.Effect<ReadonlyArray<StoredJournalEntry>, E>;
  readonly journalHolders: (
    entity: SyncEntity,
    entityId: string,
    excludedOperationId: string,
  ) => Effect.Effect<ReadonlyArray<JournalHolder>, E>;
  readonly dropJournalOf: (operationId: string) => Effect.Effect<unknown, E>;
  readonly dropJournalOfRow: (entity: SyncEntity, entityId: string) => Effect.Effect<unknown, E>;
  readonly clientSequenceOf: (operationId: string) => Effect.Effect<string | undefined, E>;
  readonly addOverlay: (overlay: StockOverlayDelta) => Effect.Effect<unknown, E>;
  readonly takeOverlayBatchIds: (operationId: string) => Effect.Effect<ReadonlyArray<string>, E>;
  readonly numberHolder: (
    entity: NumberedEntity,
    number: number,
    excludedId: string,
  ) => Effect.Effect<{ readonly id: string } | undefined, E>;
  readonly highestNumber: (entity: NumberedEntity, excludedId?: string) => Effect.Effect<number, E>;
  readonly renumber: (
    entity: NumberedEntity,
    entityId: string,
    number: number,
  ) => Effect.Effect<unknown, E>;
  readonly nameHolder: (
    entity: NamedEntity,
    name: string,
    excludedId: string,
  ) => Effect.Effect<NamedImage | undefined, E>;
  readonly rename: (
    entity: NamedEntity,
    entityId: string,
    name: string,
  ) => Effect.Effect<unknown, E>;
};

const freeName = <E>(rows: PendingRowStore<E>, entity: NamedEntity, row: NamedImage) =>
  Effect.gen(function* () {
    const holder = yield* rows.nameHolder(entity, row.name, row.id);
    if (!holder) return row.name;
    return yield* nextFreeName(row.name, (candidate) =>
      rows.nameHolder(entity, candidate, row.id).pipe(Effect.map((other) => other !== undefined)),
    );
  });

const freeInvoiceNumber = <E>(rows: PendingRowStore<E>, row: NumberedImage) =>
  Effect.gen(function* () {
    const holder = yield* rows.numberHolder("invoice", row.number, row.id);
    if (!holder) return row.number;
    return freeDocumentNumber(row.number, yield* rows.highestNumber("invoice", row.id));
  });

const withoutCollisions = <E>(
  rows: PendingRowStore<E>,
  projected: ProjectedUpsert,
): Effect.Effect<ReplicaEntityRowImage, E> =>
  Effect.gen(function* () {
    switch (projected.entity) {
      case "category":
      case "supplier":
        return {
          ...projected.row,
          name: yield* freeName(rows, projected.entity, projected.row),
        };
      case "invoice":
        return {
          ...projected.row,
          invoiceNumber: yield* freeInvoiceNumber(rows, {
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

const journalPriorImage = <E>(
  rows: PendingRowStore<E>,
  operationId: string,
  projected: ProjectedRow,
) =>
  Effect.gen(function* () {
    if (yield* rows.isJournaled(operationId, projected.entity, projected.entityId)) return;
    const prior = yield* rows.readRow(projected.entity, projected.entityId);
    yield* rows.putJournalEntry({
      operationId,
      entity: projected.entity,
      entityId: projected.entityId,
      priorRowJson: prior ? encodeRowJson(prior) : null,
    });
  });

export const writePendingProjection = Effect.fn("ReplicaPending.writePendingProjection")(function* <
  E,
>(
  rows: PendingRowStore<E>,
  envelope: SyncCommandEnvelope,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
  resolveCollisions = false,
): Effect.fn.Return<CommandProjection, E> {
  const projection = projectCommand(envelope, actor, lookup);
  for (const projected of projection.rows) {
    yield* journalPriorImage(rows, envelope.operationId, projected);
    if (projected.row === null) {
      yield* rows.removeRow(projected.entity, projected.entityId);
    } else if (resolveCollisions) {
      yield* rows.writeRow(projected.entity, yield* withoutCollisions(rows, projected));
    } else {
      yield* rows.writeRow(projected.entity, projected.row);
    }
    yield* rows.setMark(projected.entity, projected.entityId, envelope.operationId);
  }
  return projection;
});

const pendingShadowOf = <E>(
  rows: PendingRowStore<E>,
  entity: SyncEntity,
  holder: { readonly id: string } | undefined,
  operationId: string,
) =>
  Effect.gen(function* () {
    if (!holder) return undefined;
    const mark = yield* rows.markOf(entity, holder.id);
    return mark === undefined || mark === operationId ? undefined : holder.id;
  });

const renumberCollidingShadow = Effect.fn("ReplicaPending.renumberCollidingShadow")(function* <E>(
  rows: PendingRowStore<E>,
  entity: NumberedEntity,
  incoming: NumberedImage,
  operationId: string,
): Effect.fn.Return<string | undefined, E> {
  const shadowId = yield* pendingShadowOf(
    rows,
    entity,
    yield* rows.numberHolder(entity, incoming.number, incoming.id),
    operationId,
  );
  if (shadowId === undefined) return undefined;
  const highest = yield* rows.highestNumber(entity);
  yield* rows.renumber(entity, shadowId, freeDocumentNumber(incoming.number, highest));
  return `${entity}:${shadowId}`;
});

const renameCollidingShadow = Effect.fn("ReplicaPending.renameCollidingShadow")(function* <E>(
  rows: PendingRowStore<E>,
  entity: NamedEntity,
  incoming: NamedImage,
  operationId: string,
): Effect.fn.Return<string | undefined, E> {
  const collision = yield* rows.nameHolder(entity, incoming.name, incoming.id);
  const shadowId = yield* pendingShadowOf(rows, entity, collision, operationId);
  if (collision === undefined || shadowId === undefined) return undefined;
  const name = yield* nextFreeName(collision.name, (candidate) =>
    candidate === incoming.name
      ? Effect.succeed(true)
      : rows.nameHolder(entity, candidate, "").pipe(Effect.map((other) => other !== undefined)),
  );
  yield* rows.rename(entity, shadowId, name);
  return `${entity}:${shadowId}`;
});

const displaceCollidingShadow = <E>(
  rows: PendingRowStore<E>,
  change: SyncEntityChange,
  operationId: string,
): Effect.Effect<string | undefined, E> => {
  switch (change.entity) {
    case "invoice":
    case "purchaseOrder":
      return renumberCollidingShadow(
        rows,
        change.entity,
        decodeNumberedRow(change.entity, change.row),
        operationId,
      );
    case "category":
    case "supplier":
      return renameCollidingShadow(
        rows,
        change.entity,
        decodeNamedRow(change.entity, change.row),
        operationId,
      );
    case "product":
    case "batch":
    case "invoiceItem":
    case "stockMovement":
    case "purchaseOrderItem":
      return Effect.succeed(undefined);
  }
};

export const restorePendingProjection = Effect.fn("ReplicaPending.restorePendingProjection")(
  function* <E>(
    rows: PendingRowStore<E>,
    operationId: string,
  ): Effect.fn.Return<PendingRestoreResult, E> {
    const rejected = {
      operationId,
      clientSequence: (yield* rows.clientSequenceOf(operationId)) ?? "0",
    };
    const ordered = Array.sort(
      (yield* rows.journalOf(operationId)).map((entry) => ({
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
      const mark = yield* rows.markOf(entry.entity, entry.entityId);
      const others = yield* rows.journalHolders(entry.entity, entry.entityId, operationId);
      const decision = decideJournalRestore(rejected, mark, others);
      if (decision._tag === "handDown") {
        yield* rows.putJournalEntry({
          operationId: decision.successor,
          entity: entry.entity,
          entityId: entry.entityId,
          priorRowJson: entry.priorRowJson,
        });
      }
      if (decision._tag === "restore") restores.push({ ...entry, nextMark: decision.nextMark });
    }
    for (const entry of restores) {
      if (entry.priorRowJson === null) continue;
      yield* rows.writeRow(entry.entity, decodeRowJson(entry.priorRowJson));
    }
    for (const entry of [...restores].reverse()) {
      if (entry.priorRowJson !== null) continue;
      yield* rows.removeRow(entry.entity, entry.entityId);
    }
    const touchedEntities = new Set<SyncEntity>();
    const touchedKeys: Array<string> = [];
    for (const entry of restores) {
      yield* rows.setMark(entry.entity, entry.entityId, entry.nextMark);
      touchedEntities.add(entry.entity);
      touchedKeys.push(`${entry.entity}:${entry.entityId}`);
    }
    yield* rows.dropJournalOf(operationId);
    return { touchedEntities: [...touchedEntities], touchedKeys };
  },
);

export const projectLocalCommand = Effect.fn("ReplicaPending.projectLocalCommand")(function* <E>(
  rows: PendingRowStore<E>,
  envelope: SyncCommandEnvelope,
  actor: ProjectionActor,
  context: Pick<CommandContext, "lookup" | "unitsPerPackFor">,
): Effect.fn.Return<TouchedSet, E> {
  const overlays = decideOverlays(envelope, context.unitsPerPackFor);
  for (const overlay of overlays) {
    yield* rows.addOverlay(overlay);
  }
  const projection = yield* writePendingProjection(rows, envelope, actor, context.lookup);
  return withStockTouched(
    projection,
    overlays.map((overlay) => overlay.batchId),
  );
});

export const undoLocalEffects = Effect.fn("ReplicaPending.undoLocalEffects")(function* <E>(
  rows: PendingRowStore<E>,
  operationId: string,
): Effect.fn.Return<PendingRestoreResult, E> {
  const batchIds = yield* rows.takeOverlayBatchIds(operationId);
  const restored = yield* restorePendingProjection(rows, operationId);
  return withStockTouched(restored, batchIds);
});

export const integrateGroupOverPending = Effect.fn("ReplicaPending.integrateGroupOverPending")(
  function* <E>(
    rows: PendingRowStore<E>,
    group: SyncTransactionGroup,
  ): Effect.fn.Return<TouchedSet, E> {
    const touched: Array<TouchedSet> = [];
    for (const change of group.changes) {
      touched.push(touchedOfChange(change.entity, change.entityId));
      if (change.action === "delete") {
        yield* rows.removeRow(change.entity, change.entityId);
      } else {
        const displaced = yield* displaceCollidingShadow(rows, change, group.operationId);
        if (displaced) touched.push(touchedOfKey(displaced));
        yield* rows.writeRow(change.entity, change.row);
      }
      yield* rows.dropJournalOfRow(change.entity, change.entityId);
      yield* rows.setMark(change.entity, change.entityId, undefined);
    }
    touched.push(yield* restorePendingProjection(rows, group.operationId));
    const batchIds = yield* rows.takeOverlayBatchIds(group.operationId);
    return withStockTouched(mergeTouched(...touched), batchIds);
  },
);
