import type { SyncEntity } from "@store/contracts";
import { syncEntityRows, type SyncEntityRow } from "@store/contracts/entity-rows";
import {
  batches,
  commandOutbox,
  pendingRowMarks,
  products,
  purchaseOrderItems,
  purchaseOrders,
  stockOverlays,
  suppliers,
} from "@store/db/replica.schema";
import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { withPendingOverlays, type VisibleStock } from "./decisions";
import type { CatalogReads } from "./footprint";
import type { CatalogEntity } from "./projection";
import type { ReplicaDb } from "./sql-client/drizzle";

const decodeBatch = Schema.decodeUnknownSync(syncEntityRows.batch.schema);

const IDS_PER_QUERY = 400;

const chunked = (ids: ReadonlyArray<string>) => Array.chunksOf(ids, IDS_PER_QUERY);

const selectRowsById = Effect.fn("ReplicaLookup.selectRowsById")(function* (
  tx: ReplicaDb,
  organizationId: string,
  entity: SyncEntity,
  ids: ReadonlyArray<string>,
) {
  const { table } = syncEntityRows[entity];
  const rows = yield* Effect.forEach(chunked(ids), (chunk) =>
    tx
      .select()
      .from(table)
      .where(and(eq(table.organizationId, organizationId), inArray(table.id, chunk)))
      .all(),
  );
  return rows.flat();
});

const readRowsById = <Entity extends CatalogEntity>(
  tx: ReplicaDb,
  organizationId: string,
  entity: Entity,
  ids: ReadonlyArray<string>,
) => {
  const decode = Schema.decodeUnknownSync(syncEntityRows[entity].schema);
  return selectRowsById(tx, organizationId, entity, ids).pipe(
    Effect.map((rows): ReadonlyArray<SyncEntityRow<Entity>> => rows.map((row) => decode(row))),
  );
};

export const sqliteCatalogReads = (
  tx: ReplicaDb,
  organizationId: string,
): CatalogReads<unknown, never> => ({
  rowsOf: (footprint) =>
    Effect.all({
      category: readRowsById(tx, organizationId, "category", footprint.category),
      product: readRowsById(tx, organizationId, "product", footprint.product),
      batch: readRowsById(tx, organizationId, "batch", footprint.batch),
      supplier: readRowsById(tx, organizationId, "supplier", footprint.supplier),
      purchaseOrder: readRowsById(tx, organizationId, "purchaseOrder", footprint.purchaseOrder),
      purchaseOrderItem: readRowsById(
        tx,
        organizationId,
        "purchaseOrderItem",
        footprint.purchaseOrderItem,
      ),
    }),
  productInCategory: (categoryId) =>
    tx
      .select({ categoryId: products.categoryId })
      .from(products)
      .where(and(eq(products.organizationId, organizationId), eq(products.categoryId, categoryId)))
      .limit(1)
      .get(),
  stockedBatchOfProduct: (productId) =>
    tx
      .select()
      .from(batches)
      .where(
        and(
          eq(batches.organizationId, organizationId),
          eq(batches.productId, productId),
          or(gt(batches.packQuantity, 0), gt(batches.unitQuantity, 0)),
        ),
      )
      .limit(1)
      .get()
      .pipe(Effect.map((row) => (row ? decodeBatch(row) : undefined))),
  supplierNamed: (name) =>
    tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.organizationId, organizationId), eq(suppliers.name, name)))
      .limit(1)
      .get(),
  purchaseOrdersOfSupplier: (supplierId, limit) =>
    tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.organizationId, organizationId),
          eq(purchaseOrders.supplierId, supplierId),
        ),
      )
      .limit(limit)
      .all(),
  itemsOfPurchaseOrder: (purchaseOrderId, limit) =>
    tx
      .select({ id: purchaseOrderItems.id })
      .from(purchaseOrderItems)
      .where(
        and(
          eq(purchaseOrderItems.organizationId, organizationId),
          eq(purchaseOrderItems.purchaseOrderId, purchaseOrderId),
        ),
      )
      .limit(limit)
      .all(),
  purchaseOrderNumbered: (orderNumber) =>
    tx
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.organizationId, organizationId),
          eq(purchaseOrders.orderNumber, orderNumber),
        ),
      )
      .limit(1)
      .get(),
  highestPurchaseOrders: (limit) =>
    tx
      .select({ id: purchaseOrders.id, orderNumber: purchaseOrders.orderNumber })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.organizationId, organizationId))
      .orderBy(desc(purchaseOrders.orderNumber))
      .limit(limit)
      .all(),
  visibleStock: (batchRows) => readVisibleStock(tx, batchRows),
});

const readVisibleStock = Effect.fn("ReplicaLookup.readVisibleStock")(function* (
  tx: ReplicaDb,
  batchRows: ReadonlyArray<VisibleStock & { readonly id: string }>,
) {
  const batchIds = batchRows.map((batch) => batch.id);
  const overlayRows = (yield* Effect.forEach(chunked(batchIds), (chunk) =>
    tx.select().from(stockOverlays).where(inArray(stockOverlays.batchId, chunk)).all(),
  )).flat();
  const markRows = (yield* Effect.forEach(chunked(batchIds), (chunk) =>
    tx
      .select()
      .from(pendingRowMarks)
      .where(and(eq(pendingRowMarks.entity, "batch"), inArray(pendingRowMarks.entityId, chunk)))
      .all(),
  )).flat();
  const operationIds = [
    ...new Set([
      ...overlayRows.map((overlay) => overlay.commandId),
      ...markRows.map((mark) => mark.operationId),
    ]),
  ];
  const sequenceRows = (yield* Effect.forEach(chunked(operationIds), (chunk) =>
    tx
      .select({
        operationId: commandOutbox.operationId,
        clientSequence: commandOutbox.clientSequence,
      })
      .from(commandOutbox)
      .where(inArray(commandOutbox.operationId, chunk))
      .all(),
  )).flat();
  const sequenceOf = new Map(sequenceRows.map((row) => [row.operationId, row.clientSequence]));
  const absoluteSequence = new Map(
    markRows.map((mark) => [mark.entityId, sequenceOf.get(mark.operationId)]),
  );
  const overlaysByBatch = Array.groupBy(overlayRows, (overlay) => overlay.batchId);
  return new Map<string, VisibleStock>(
    batchRows.map((batch) => [
      batch.id,
      withPendingOverlays(
        batch,
        (overlaysByBatch[batch.id] ?? []).map((overlay) => ({
          packDelta: overlay.packDelta,
          unitDelta: overlay.unitDelta,
          clientSequence: sequenceOf.get(overlay.commandId),
        })),
        absoluteSequence.get(batch.id),
      ),
    ]),
  );
});

export const readUnitsPerPack = Effect.fn("ReplicaLookup.readUnitsPerPack")(function* (
  tx: ReplicaDb,
  organizationId: string,
  productIds: ReadonlyArray<string>,
) {
  const rows = yield* readRowsById(tx, organizationId, "product", [...new Set(productIds)]);
  const unitsPerPack = new Map<string, number>(rows.map((row) => [row.id, row.unitsPerPack]));
  return (productId: string) => unitsPerPack.get(productId) ?? 1;
});
