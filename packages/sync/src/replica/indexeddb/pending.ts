import type { SyncEntity, SyncEntityChange } from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeStoredEnvelope, type NamedEntity, type NumberedEntity } from "../codecs";
import { byClientSequence, OUTSTANDING_COMMAND_STATUSES, type JournalHolder } from "../decisions";
import { loadCommandContext, type CatalogReads } from "../footprint";
import { writePendingProjection, type PendingRowStore } from "../pending";
import type { CatalogEntity, ProjectionActor, ReplicaEntityRowImage } from "../projection";
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

const renameRow = (
  api: ReplicaQueryBuilder,
  generation: number,
  entity: NamedEntity,
  entityId: string,
  name: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const store = api.from(entityStore(entity));
    const [row] = yield* store.select().equals([generation, entityId]);
    if (row) yield* store.upsert({ ...row, name });
  });

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

export const indexedDbCatalogReads = (
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
  visibleStock: (batchRows) => readVisibleStock(api, batchRows),
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

const takeOverlayBatchIds = (api: ReplicaQueryBuilder, operationId: string) =>
  Effect.gen(function* () {
    const overlays = yield* api.from("stock_overlays").select("byCommand").equals(operationId);
    if (overlays.length > 0) {
      yield* api.from("stock_overlays").delete("byCommand").equals(operationId);
    }
    return overlays.map((overlay) => overlay.batchId);
  });

export const indexedDbPendingRows = (
  api: ReplicaQueryBuilder,
  generation: number,
): PendingRowStore<unknown> => ({
  readRow: (entity, entityId) => selectEntityRow(api, generation, entity, entityId),
  writeRow: (entity, row) => writeEntityRow(api, generation, entity, row),
  removeRow: (entity, entityId) => removeEntityRow(api, generation, entity, entityId),
  markOf: (entity, entityId) => pendingMark(api, entity, entityId),
  setMark: (entity, entityId, operationId) =>
    operationId === undefined
      ? api.from("pending_row_marks").delete().equals([entity, entityId])
      : api.from("pending_row_marks").upsert({ entity, entityId, operationId }),
  isJournaled: (operationId, entity, entityId) =>
    api
      .from("pending_row_journal")
      .select()
      .equals([operationId, entity, entityId])
      .pipe(Effect.map((rows) => rows.length > 0)),
  putJournalEntry: (entry) => api.from("pending_row_journal").upsert(entry),
  journalOf: (operationId) =>
    api.from("pending_row_journal").select("byOperation").equals(operationId),
  journalHolders: (entity, entityId, excludedOperationId) =>
    journalHolders(api, entity, entityId, excludedOperationId),
  dropJournalOf: (operationId) =>
    api.from("pending_row_journal").delete("byOperation").equals(operationId),
  dropJournalOfRow: (entity, entityId) =>
    api.from("pending_row_journal").delete("byEntity").equals([entity, entityId]),
  clientSequenceOf: (operationId) => clientSequenceOf(api, operationId),
  addOverlay: (overlay) => api.from("stock_overlays").insert(overlay),
  takeOverlayBatchIds: (operationId) => takeOverlayBatchIds(api, operationId),
  numberHolder: (entity, number, excludedId) =>
    numberHolder(api, generation, entity, number, excludedId),
  highestNumber: (entity, excludedId) => highestNumber(api, generation, entity, excludedId),
  renumber: (entity, entityId, number) => renumberRow(api, generation, entity, entityId, number),
  nameHolder: (entity, name, excludedId) => nameHolder(api, generation, entity, name, excludedId),
  rename: (entity, entityId, name) => renameRow(api, generation, entity, entityId, name),
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
    const rows = indexedDbPendingRows(api, generation);
    const reads = indexedDbCatalogReads(api, generation);
    for (const row of outstanding) {
      const envelope = yield* decodeStoredEnvelope(row);
      const { lookup } = yield* loadCommandContext(envelope.command, reads, {
        checkRules: false,
        withStock: false,
      });
      yield* writePendingProjection(rows, envelope, actor, lookup, true);
    }
  });
