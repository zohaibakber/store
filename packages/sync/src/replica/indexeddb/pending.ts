import { type SyncCommandEnvelope, type SyncEntity, type SyncEntityChange } from "@store/contracts";
import type { SyncCommand } from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  decodeEntity,
  decodeRowJson,
  decodeStoredEnvelope,
  encodeRowJson,
  type NamedEntity,
  type NamedImage,
  type NumberedEntity,
  type NumberedImage,
} from "../codecs";
import { nextFreeName } from "../collisions";
import {
  byClientSequence,
  byEntityDependency,
  decideJournalRestore,
  EMPTY_STOCK,
  freeDocumentNumber,
  OUTSTANDING_COMMAND_STATUSES,
  type JournalHolder,
  type VisibleStock,
} from "../decisions";
import { loadCatalog, type CatalogReads } from "../footprint";
import {
  projectCommand,
  type CatalogEntity,
  type CommandProjection,
  type PendingRestoreResult,
  type ProjectedRow,
  type ProjectedUpsert,
  type ProjectionActor,
  type ReplicaCatalogLookup,
  type ReplicaEntityRowImage,
} from "../projection";
import { generationBounds } from "./query";
import { entityStore, outboxWithStatus, storedEntityRow, type ReplicaQueryBuilder } from "./schema";
import { readVisibleStock } from "./stock";

const selectEntityRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  entityId: string,
): Effect.Effect<ReplicaEntityRowImage | undefined, unknown> =>
  api
    .from(entityStore(entity))
    .select()
    .equals([generation, entityId])
    .pipe(
      Effect.map(([row]) => {
        if (row === undefined) return undefined;
        const { generation: _generation, ...image } = row;
        return image;
      }),
    );

export const writeEntityRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  row: SyncEntityChange["row"],
): Effect.Effect<unknown, unknown> =>
  api.from(entityStore(entity)).upsert(storedEntityRow(generation, entity, row));

export const writeEntityRows = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  rows: ReadonlyArray<SyncEntityChange["row"]>,
): Effect.Effect<unknown, unknown> =>
  rows.length === 0
    ? Effect.void
    : api
        .from(entityStore(entity))
        .upsertAll(rows.map((row) => storedEntityRow(generation, entity, row)));

export const removeEntityRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: SyncEntity,
  entityId: string,
): Effect.Effect<unknown, unknown> =>
  api.from(entityStore(entity)).delete().equals([generation, entityId]);

const numberHolder = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NumberedEntity,
  number: number,
  excludedId: string,
): Effect.Effect<{ readonly id: string } | undefined, unknown> => {
  switch (entity) {
    case "invoice":
      return api
        .from("invoices")
        .select("byInvoiceNumber")
        .equals([generation, number])
        .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)));
    case "purchaseOrder":
      return api
        .from("purchase_orders")
        .select("byOrderNumber")
        .equals([generation, number])
        .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)));
  }
};

const highestNumber = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NumberedEntity,
  excludedId?: string,
): Effect.Effect<number, unknown> => {
  const [lower, upper] = generationBounds(generation);
  const limit = excludedId === undefined ? 1 : 2;
  switch (entity) {
    case "invoice":
      return api
        .from("invoices")
        .select("byInvoiceNumber")
        .between(lower, upper)
        .reverse()
        .limit(limit)
        .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)?.invoiceNumber ?? 0));
    case "purchaseOrder":
      return api
        .from("purchase_orders")
        .select("byOrderNumber")
        .between(lower, upper)
        .reverse()
        .limit(limit)
        .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)?.orderNumber ?? 0));
  }
};

const renumberRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NumberedEntity,
  entityId: string,
  number: number,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const key: [number, string] = [generation, entityId];
    switch (entity) {
      case "invoice": {
        const [row] = yield* api.from("invoices").select().equals(key);
        if (row) yield* api.from("invoices").upsert({ ...row, invoiceNumber: number });
        return;
      }
      case "purchaseOrder": {
        const [row] = yield* api.from("purchase_orders").select().equals(key);
        if (row) yield* api.from("purchase_orders").upsert({ ...row, orderNumber: number });
        return;
      }
    }
  });

const nameHolder = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NamedEntity,
  name: string,
  excludedId: string,
) =>
  api
    .from(entityStore(entity))
    .select("byName")
    .equals([generation, name])
    .pipe(Effect.map((rows) => rows.find((row) => row.id !== excludedId)));

const isStocked = (batch: { readonly packQuantity: number; readonly unitQuantity: number }) =>
  batch.packQuantity > 0 || batch.unitQuantity > 0;

const readRowsById = <Entity extends CatalogEntity>(
  api: ReplicaQueryBuilder,
  generation: number,
  entity: Entity,
  ids: ReadonlyArray<string>,
) => {
  const decode = Schema.decodeUnknownSync(syncEntityRows[entity].schema);
  return Effect.forEach(ids, (id) => selectEntityRow(api, generation, entity, id)).pipe(
    Effect.map((images): ReadonlyArray<SyncEntityRow<Entity>> =>
      images.flatMap((image) => (image === undefined ? [] : [decode(image)])),
    ),
  );
};

const indexedDbCatalogReads = (
  api: ReplicaQueryBuilder,
  generation: number,
): CatalogReads<unknown, never> => ({
  rowsOf: (footprint) =>
    Effect.all({
      category: readRowsById(api, generation, "category", footprint.category),
      product: readRowsById(api, generation, "product", footprint.product),
      batch: readRowsById(api, generation, "batch", footprint.batch),
      supplier: readRowsById(api, generation, "supplier", footprint.supplier),
      purchaseOrder: readRowsById(api, generation, "purchaseOrder", footprint.purchaseOrder),
      purchaseOrderItem: readRowsById(
        api,
        generation,
        "purchaseOrderItem",
        footprint.purchaseOrderItem,
      ),
    }),
  productInCategory: (categoryId) =>
    api
      .from("products")
      .select("byCategory")
      .equals([generation, categoryId])
      .limit(1)
      .pipe(Effect.map((rows) => (rows[0] ? { categoryId } : undefined))),
  stockedBatchOfProduct: (productId) =>
    api
      .from("batches")
      .select("byProduct")
      .equals([generation, productId])
      .pipe(
        Effect.map((rows) => {
          const stocked = rows.find(isStocked);
          if (!stocked) return undefined;
          const { generation: _generation, ...batch } = stocked;
          return batch;
        }),
      ),
  supplierNamed: (name) =>
    api
      .from("suppliers")
      .select("byName")
      .equals([generation, name])
      .limit(1)
      .pipe(Effect.map((rows) => rows[0])),
  purchaseOrdersOfSupplier: (supplierId, limit) =>
    api.from("purchase_orders").select("bySupplier").equals([generation, supplierId]).limit(limit),
  itemsOfPurchaseOrder: (purchaseOrderId, limit) =>
    api
      .from("purchase_order_items")
      .select("byPurchaseOrder")
      .equals([generation, purchaseOrderId])
      .limit(limit),
  purchaseOrderNumbered: (orderNumber) =>
    api
      .from("purchase_orders")
      .select("byOrderNumber")
      .equals([generation, orderNumber])
      .limit(1)
      .pipe(Effect.map((rows) => rows[0])),
  highestPurchaseOrders: (limit) => {
    const [lower, upper] = generationBounds(generation);
    return api
      .from("purchase_orders")
      .select("byOrderNumber")
      .between(lower, upper)
      .reverse()
      .limit(limit);
  },
});

export const readIndexedDbCommandContext = (
  api: ReplicaQueryBuilder,
  generation: number,
  command: SyncCommand,
  options: { readonly checkRules: boolean; readonly withStock: boolean },
) =>
  Effect.gen(function* () {
    const { rows, lookup } = yield* loadCatalog(command, indexedDbCatalogReads(api, generation), {
      checkRules: options.checkRules,
    });
    const stock = options.withStock
      ? yield* readVisibleStock(api, rows.batch)
      : new Map<string, VisibleStock>();
    return {
      lookup,
      unitsPerPackFor: (productId: string) => lookup.product(productId)?.unitsPerPack ?? 1,
      stockFor: (batchId: string) => stock.get(batchId) ?? EMPTY_STOCK,
    };
  });

export const readIndexedDbUnitsPerPack = (
  api: ReplicaQueryBuilder,
  generation: number,
  productIds: ReadonlyArray<string>,
): Effect.Effect<(productId: string) => number, unknown> =>
  Effect.gen(function* () {
    const rows = yield* Effect.forEach([...new Set(productIds)], (id) =>
      api.from("products").select().equals([generation, id]),
    );
    const unitsPerPack = new Map<string, number>(
      rows.flat().map((row) => [row.id, row.unitsPerPack]),
    );
    return (productId: string) => unitsPerPack.get(productId) ?? 1;
  });

const pendingMark = (api: ReplicaQueryBuilder, entity: SyncEntity, entityId: string) =>
  api
    .from("pending_row_marks")
    .select()
    .equals([entity, entityId])
    .pipe(Effect.map((rows) => rows[0]?.operationId));

const journalEntry = (
  api: ReplicaQueryBuilder,
  operationId: string,
  projected: ProjectedRow,
  generation: number,
) =>
  Effect.gen(function* () {
    const existing = yield* api
      .from("pending_row_journal")
      .select()
      .equals([operationId, projected.entity, projected.entityId]);
    if (existing[0]) return;
    const prior = yield* selectEntityRow(api, generation, projected.entity, projected.entityId);
    yield* api.from("pending_row_journal").upsert({
      operationId,
      entity: projected.entity,
      entityId: projected.entityId,
      priorRowJson: prior ? encodeRowJson(prior) : null,
    });
  });

const freeName = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NamedEntity,
  row: NamedImage,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const holder = yield* nameHolder(api, generation, entity, row.name, row.id);
    if (!holder) return row.name;
    return yield* nextFreeName(row.name, (candidate) =>
      nameHolder(api, generation, entity, candidate, row.id).pipe(
        Effect.map((other) => other !== undefined),
      ),
    );
  });

const freeInvoiceNumber = (
  api: ReplicaQueryBuilder,
  generation: number,
  row: NumberedImage,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* () {
    const holder = yield* numberHolder(api, generation, "invoice", row.number, row.id);
    if (!holder) return row.number;
    return freeDocumentNumber(row.number, yield* highestNumber(api, generation, "invoice", row.id));
  });

const withoutCollisions = (
  api: ReplicaQueryBuilder,
  generation: number,
  projected: ProjectedUpsert,
): Effect.Effect<ReplicaEntityRowImage, unknown> =>
  Effect.gen(function* () {
    switch (projected.entity) {
      case "category":
      case "supplier":
        return {
          ...projected.row,
          name: yield* freeName(api, generation, projected.entity, projected.row),
        };
      case "invoice":
        return {
          ...projected.row,
          invoiceNumber: yield* freeInvoiceNumber(api, generation, {
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

export const writeIndexedDbPendingProjection = (
  api: ReplicaQueryBuilder,
  generation: number,
  actor: ProjectionActor,
  lookup: ReplicaCatalogLookup,
  envelope: SyncCommandEnvelope,
  resolveCollisions = false,
): Effect.Effect<CommandProjection, unknown> =>
  Effect.gen(function* () {
    const projection = projectCommand(envelope, actor, lookup);
    for (const projected of projection.rows) {
      yield* journalEntry(api, envelope.operationId, projected, generation);
      if (projected.row === null) {
        yield* removeEntityRow(api, generation, projected.entity, projected.entityId);
      } else if (resolveCollisions) {
        yield* writeEntityRow(
          api,
          generation,
          projected.entity,
          yield* withoutCollisions(api, generation, projected),
        );
      } else {
        yield* writeEntityRow(api, generation, projected.entity, projected.row);
      }
      yield* api.from("pending_row_marks").upsert({
        entity: projected.entity,
        entityId: projected.entityId,
        operationId: envelope.operationId,
      });
    }
    return projection;
  });

export const renumberIndexedDbCollidingShadow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NumberedEntity,
  incoming: NumberedImage,
  operationId: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const collision = yield* numberHolder(api, generation, entity, incoming.number, incoming.id);
    if (!collision) return undefined;
    const mark = yield* pendingMark(api, entity, collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const highest = yield* highestNumber(api, generation, entity);
    yield* renumberRow(
      api,
      generation,
      entity,
      collision.id,
      freeDocumentNumber(incoming.number, highest),
    );
    return `${entity}:${collision.id}`;
  });

export const renameIndexedDbCollidingShadow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NamedEntity,
  incoming: NamedImage,
  operationId: string,
): Effect.Effect<string | undefined, unknown> =>
  Effect.gen(function* () {
    const collision = yield* nameHolder(api, generation, entity, incoming.name, incoming.id);
    if (!collision) return undefined;
    const mark = yield* pendingMark(api, entity, collision.id);
    if (mark === undefined || mark === operationId) return undefined;
    const name = yield* nextFreeName(collision.name, (candidate) =>
      candidate === incoming.name
        ? Effect.succeed(true)
        : nameHolder(api, generation, entity, candidate, "").pipe(
            Effect.map((other) => other !== undefined),
          ),
    );
    yield* api.from(entityStore(entity)).upsert({ ...collision, name });
    return `${entity}:${collision.id}`;
  });

const setIndexedDbMark = (
  api: ReplicaQueryBuilder,
  entity: SyncEntity,
  entityId: string,
  operationId: string | undefined,
) =>
  operationId === undefined
    ? api.from("pending_row_marks").delete().equals([entity, entityId])
    : api.from("pending_row_marks").upsert({ entity, entityId, operationId });

const clientSequenceOf = (api: ReplicaQueryBuilder, operationId: string) =>
  api
    .from("command_outbox")
    .select()
    .equals(operationId)
    .pipe(Effect.map((rows) => rows[0]?.clientSequence));

const journalHolders = (
  api: ReplicaQueryBuilder,
  entity: SyncEntity,
  entityId: string,
  excludedOperationId: string,
): Effect.Effect<ReadonlyArray<JournalHolder>, unknown> =>
  Effect.gen(function* () {
    const entries = yield* api
      .from("pending_row_journal")
      .select("byEntity")
      .equals([entity, entityId]);
    const holders: Array<JournalHolder> = [];
    for (const entry of entries) {
      if (entry.operationId === excludedOperationId) continue;
      const clientSequence = yield* clientSequenceOf(api, entry.operationId);
      if (clientSequence !== undefined) {
        holders.push({ operationId: entry.operationId, clientSequence });
      }
    }
    return holders;
  });

export const restoreIndexedDbPendingProjection = (
  api: ReplicaQueryBuilder,
  generation: number,
  operationId: string,
): Effect.Effect<PendingRestoreResult, unknown> =>
  Effect.gen(function* () {
    const rejected = {
      operationId,
      clientSequence: (yield* clientSequenceOf(api, operationId)) ?? "0",
    };
    const journal = yield* api
      .from("pending_row_journal")
      .select("byOperation")
      .equals(operationId);
    const touchedEntities = new Set<SyncEntity>();
    const touchedKeys: Array<string> = [];
    const ordered = Array.sort(
      journal.map((entry) => ({
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
      const mark = yield* pendingMark(api, entry.entity, entry.entityId);
      const others = yield* journalHolders(api, entry.entity, entry.entityId, operationId);
      const decision = decideJournalRestore(rejected, mark, others);
      if (decision._tag === "handDown") {
        yield* api.from("pending_row_journal").upsert({
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
      yield* writeEntityRow(api, generation, entry.entity, decodeRowJson(entry.priorRowJson));
    }
    for (const entry of [...restores].reverse()) {
      if (entry.priorRowJson !== null) continue;
      yield* removeEntityRow(api, generation, entry.entity, entry.entityId);
    }
    for (const entry of restores) {
      yield* setIndexedDbMark(api, entry.entity, entry.entityId, entry.nextMark);
      touchedEntities.add(entry.entity);
      touchedKeys.push(`${entry.entity}:${entry.entityId}`);
    }
    yield* api.from("pending_row_journal").delete("byOperation").equals(operationId);
    return { touchedEntities: [...touchedEntities], touchedKeys };
  });

export const resolveIndexedDbRemoteRow = (
  api: ReplicaQueryBuilder,
  entity: SyncEntity,
  entityId: string,
) =>
  Effect.gen(function* () {
    yield* api.from("pending_row_journal").delete("byEntity").equals([entity, entityId]);
    yield* api.from("pending_row_marks").delete().equals([entity, entityId]);
  });

export const reapplyIndexedDbPendingProjections = (
  api: ReplicaQueryBuilder,
  generation: number,
  actor: ProjectionActor,
) =>
  Effect.gen(function* () {
    yield* api.from("pending_row_marks").clear;
    yield* api.from("pending_row_journal").clear;
    const byStatus = yield* Effect.forEach(OUTSTANDING_COMMAND_STATUSES, (status) =>
      outboxWithStatus(api, status),
    );
    const outstanding = Array.sort(byStatus.flat(), byClientSequence);
    for (const row of outstanding) {
      const envelope = yield* decodeStoredEnvelope(row);
      const { lookup } = yield* readIndexedDbCommandContext(api, generation, envelope.command, {
        checkRules: false,
        withStock: false,
      });
      yield* writeIndexedDbPendingProjection(api, generation, actor, lookup, envelope, true);
    }
  });
