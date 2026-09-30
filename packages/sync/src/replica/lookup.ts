import type { SyncCommand } from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  batches,
  categories,
  commandOutbox,
  invoices,
  pendingRowMarks,
  products,
  stockOverlays,
} from "@store/db/replica.schema";
import { and, eq, gt, inArray, max, ne, or } from "drizzle-orm";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EMPTY_STOCK, withPendingOverlays, type VisibleStock } from "./decisions";
import { loadCatalog, type CatalogReads, type CommandFootprint } from "./footprint";
import type { ReplicaCatalogLookup } from "./projection";
import type { ReplicaDb } from "./sql-client/drizzle";

const decodeCategory = Schema.decodeUnknownSync(syncEntityRows.category.schema);
const decodeProduct = Schema.decodeUnknownSync(syncEntityRows.product.schema);
const decodeBatch = Schema.decodeUnknownSync(syncEntityRows.batch.schema);

const IDS_PER_QUERY = 400;

const chunked = (ids: ReadonlyArray<string>) => Array.chunksOf(ids, IDS_PER_QUERY);

const readCategoriesById = Effect.fn("ReplicaLookup.readCategoriesById")(function* (
  tx: ReplicaDb,
  organizationId: string,
  ids: ReadonlyArray<string>,
) {
  const rows = yield* Effect.forEach(chunked(ids), (chunk) =>
    tx
      .select()
      .from(categories)
      .where(and(eq(categories.organizationId, organizationId), inArray(categories.id, chunk)))
      .all(),
  );
  return rows.flat().map((row) => decodeCategory(row));
});

const readProductsById = Effect.fn("ReplicaLookup.readProductsById")(function* (
  tx: ReplicaDb,
  organizationId: string,
  ids: ReadonlyArray<string>,
) {
  const rows = yield* Effect.forEach(chunked(ids), (chunk) =>
    tx
      .select()
      .from(products)
      .where(and(eq(products.organizationId, organizationId), inArray(products.id, chunk)))
      .all(),
  );
  return rows.flat().map((row) => decodeProduct(row));
});

const readBatchesById = Effect.fn("ReplicaLookup.readBatchesById")(function* (
  tx: ReplicaDb,
  organizationId: string,
  ids: ReadonlyArray<string>,
) {
  const rows = yield* Effect.forEach(chunked(ids), (chunk) =>
    tx
      .select()
      .from(batches)
      .where(and(eq(batches.organizationId, organizationId), inArray(batches.id, chunk)))
      .all(),
  );
  return rows.flat().map((row) => decodeBatch(row));
});

const sqliteCatalogReads = (
  tx: ReplicaDb,
  organizationId: string,
): CatalogReads<unknown, never> => ({
  rowsOf: (footprint: CommandFootprint) =>
    Effect.all({
      categories: readCategoriesById(tx, organizationId, footprint.categoryIds),
      products: readProductsById(tx, organizationId, footprint.productIds),
      batches: readBatchesById(tx, organizationId, footprint.batchIds),
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
});

export const readVisibleStock = Effect.fn("ReplicaLookup.readVisibleStock")(function* (
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

type CommandContext = {
  readonly lookup: ReplicaCatalogLookup;
  readonly unitsPerPackFor: (productId: string) => number;
  readonly stockFor: (batchId: string) => VisibleStock;
};

export const readCommandContext = Effect.fn("ReplicaLookup.readCommandContext")(function* (
  tx: ReplicaDb,
  organizationId: string,
  command: SyncCommand,
  options: { readonly checkRules: boolean; readonly withStock: boolean },
) {
  const { rows, lookup } = yield* loadCatalog(command, sqliteCatalogReads(tx, organizationId), {
    checkRules: options.checkRules,
  });
  const stock = options.withStock
    ? yield* readVisibleStock(tx, rows.batches)
    : new Map<string, VisibleStock>();
  return {
    lookup,
    unitsPerPackFor: (productId) => lookup.product(productId)?.unitsPerPack ?? 1,
    stockFor: (batchId) => stock.get(batchId) ?? EMPTY_STOCK,
  } satisfies CommandContext;
});

export const readUnitsPerPack = Effect.fn("ReplicaLookup.readUnitsPerPack")(function* (
  tx: ReplicaDb,
  organizationId: string,
  productIds: ReadonlyArray<string>,
) {
  const rows = yield* readProductsById(tx, organizationId, [...new Set(productIds)]);
  const unitsPerPack = new Map<string, number>(rows.map((row) => [row.id, row.unitsPerPack]));
  return (productId: string) => unitsPerPack.get(productId) ?? 1;
});

export const readVisibleBatchStock = Effect.fn("ReplicaLookup.readVisibleBatchStock")(function* (
  tx: ReplicaDb,
  organizationId: string,
  batchId: string,
) {
  const rows = yield* readBatchesById(tx, organizationId, [batchId]);
  return (yield* readVisibleStock(tx, rows)).get(batchId);
});

export const readInvoiceNumberHolder = (
  tx: ReplicaDb,
  organizationId: string,
  invoiceNumber: number,
  excludedId: string,
) =>
  tx
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, organizationId),
        eq(invoices.invoiceNumber, invoiceNumber),
        ne(invoices.id, excludedId),
      ),
    )
    .limit(1)
    .get();

export const readHighestInvoiceNumber = (
  tx: ReplicaDb,
  organizationId: string,
  excludedId?: string,
) =>
  tx
    .select({ highest: max(invoices.invoiceNumber) })
    .from(invoices)
    .where(
      excludedId === undefined
        ? eq(invoices.organizationId, organizationId)
        : and(eq(invoices.organizationId, organizationId), ne(invoices.id, excludedId)),
    )
    .get()
    .pipe(Effect.map((row) => row?.highest ?? 0));

export const readCategoryNameHolder = (
  tx: ReplicaDb,
  organizationId: string,
  name: string,
  excludedId: string,
) =>
  tx
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(
      and(
        eq(categories.organizationId, organizationId),
        eq(categories.name, name),
        ne(categories.id, excludedId),
      ),
    )
    .limit(1)
    .get();
