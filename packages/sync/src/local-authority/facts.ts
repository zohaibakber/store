import {
  compareDecimalSequence,
  openPackMovementId,
  type CatalogRowWrite,
  type SyncEntity,
} from "@store/contracts";
import { syncEntityRows } from "@store/contracts/entity-rows";
import {
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaInvoiceItemRow,
  ReplicaInvoiceRow,
  ReplicaProductRow,
  ReplicaPurchaseOrderItemRow,
  ReplicaPurchaseOrderRow,
  ReplicaStockMovementRow,
  ReplicaSupplierRow,
} from "@store/contracts/sync/replica-model";
import {
  batches,
  categories,
  commandOutbox,
  invoices,
  pendingRowJournal,
  products,
  purchaseOrderItems,
  purchaseOrders,
  suppliers,
} from "@store/db/replica.schema";
import { and, count, desc, eq, gt, inArray, notExists, or, sql, type SQL } from "drizzle-orm";
import { QueryBuilder, type SQLiteColumn } from "drizzle-orm/sqlite-core";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ReplicaDb } from "../replica/sql-client/drizzle";
import {
  hasStock,
  type CatalogPayload,
  type CatalogRowsById,
  type InvoicePayload,
  type LocalCatalogFacts,
  type LocalInvoiceFacts,
  type PurchasingEntity,
} from "./decision";

const IDS_PER_QUERY = 400;

const SETTLED_IDS_PER_QUERY = 90;

const queryBuilder = new QueryBuilder();

const unjournaled = (entity: SyncEntity, id: SQLiteColumn) =>
  notExists(
    queryBuilder
      .select({ held: sql`1` })
      .from(pendingRowJournal)
      .where(and(eq(pendingRowJournal.entity, entity), eq(pendingRowJournal.entityId, id))),
  );

type JournalPrior = {
  readonly entityId: string;
  readonly priorRowJson: string | null;
  readonly clientSequence: string;
};

const NO_PRIORS: ReadonlyMap<string, JournalPrior> = new Map();

type PriorsOf = (entity: SyncEntity) => ReadonlyMap<string, JournalPrior>;

export type PendingJournal = {
  readonly priorsOf: PriorsOf;
  readonly unjournaled: (entity: SyncEntity, id: SQLiteColumn) => SQL | undefined;
  readonly idsPerQuery: number;
};

export const SETTLED_CATALOG: PendingJournal = {
  priorsOf: () => NO_PRIORS,
  unjournaled: () => undefined,
  idsPerQuery: SETTLED_IDS_PER_QUERY,
};

const earliestPriors = Effect.fn("LocalAuthority.earliestPriors")(function* (tx: ReplicaDb) {
  const rows = yield* tx
    .select({
      entity: pendingRowJournal.entity,
      entityId: pendingRowJournal.entityId,
      priorRowJson: pendingRowJournal.priorRowJson,
      clientSequence: commandOutbox.clientSequence,
    })
    .from(pendingRowJournal)
    .innerJoin(commandOutbox, eq(commandOutbox.operationId, pendingRowJournal.operationId))
    .all();
  const earliest = new Map<string, Map<string, JournalPrior>>();
  for (const row of rows) {
    const ofEntity = earliest.get(row.entity) ?? new Map<string, JournalPrior>();
    const held = ofEntity.get(row.entityId);
    if (held === undefined || compareDecimalSequence(row.clientSequence, held.clientSequence) < 0) {
      ofEntity.set(row.entityId, row);
    }
    earliest.set(row.entity, ofEntity);
  }
  return (entity: SyncEntity): ReadonlyMap<string, JournalPrior> =>
    earliest.get(entity) ?? NO_PRIORS;
});

const chunked = <Value>(journal: PendingJournal, values: ReadonlyArray<Value>) =>
  Array.chunksOf(values, journal.idsPerQuery);

export const replicaJournal = (tx: ReplicaDb) =>
  Effect.map(earliestPriors(tx), (priorsOf): PendingJournal => ({
    priorsOf,
    unjournaled,
    idsPerQuery: IDS_PER_QUERY,
  }));

const byId = <Row extends { readonly id: string }>(rows: Iterable<Row>): ReadonlyMap<string, Row> =>
  new Map(Array.fromIterable(rows).map((row) => [row.id, row]));

const authoritativeView = <Row extends { readonly id: string }, Encoded>(
  tx: ReplicaDb,
  organizationId: string,
  journal: PendingJournal,
  entity: SyncEntity,
  schema: Schema.Codec<Row, Encoded>,
) =>
  Effect.gen(function* () {
    const table = syncEntityRows[entity].table;
    const decodeStored = Schema.decodeUnknownEffect(Schema.Array(schema));
    const decodePrior = Schema.decodeUnknownEffect(Schema.fromJsonString(schema));
    const priors = journal.priorsOf(entity);
    const restored = byId(
      yield* Effect.forEach(
        [...priors.values()].flatMap((prior) =>
          prior.priorRowJson === null ? [] : [prior.priorRowJson],
        ),
        (json) => decodePrior(json),
      ),
    );
    const rowsOf = (ids: Iterable<string>) =>
      Effect.gen(function* () {
        const wanted = [...new Set(ids)];
        const stored = yield* Effect.forEach(
          chunked(
            journal,
            wanted.filter((id) => !priors.has(id)),
          ),
          (chunk) =>
            tx
              .select()
              .from(table)
              .where(and(eq(table.organizationId, organizationId), inArray(table.id, chunk)))
              .all()
              .pipe(Effect.flatMap(decodeStored)),
        );
        return byId([
          ...stored.flat(),
          ...wanted.flatMap((id) => {
            const row = restored.get(id);
            return row === undefined ? [] : [row];
          }),
        ]);
      });
    const settled = (condition: SQL | undefined) =>
      tx
        .select()
        .from(table)
        .where(
          and(
            eq(table.organizationId, organizationId),
            condition,
            journal.unjournaled(entity, table.id),
          ),
        );
    return {
      restored,
      journaled: (id: string) => priors.has(id),
      rowsOf,
      stored: (condition: SQL | undefined) =>
        settled(condition).all().pipe(Effect.flatMap(decodeStored)),
      firstStored: (condition: SQL | undefined, order: SQL | SQLiteColumn, limit: number) =>
        settled(condition).orderBy(order).limit(limit).all().pipe(Effect.flatMap(decodeStored)),
    };
  });

const CountedKeys = Schema.Array(Schema.Struct({ key: Schema.String, total: Schema.Number }));

const decodeCountedKeys = Schema.decodeUnknownEffect(CountedKeys);

const tally = <Row>(
  rows: Iterable<Row>,
  keyOf: (row: Row) => string,
): ReadonlyMap<string, number> => {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(keyOf(row), (totals.get(keyOf(row)) ?? 0) + 1);
  return totals;
};

type WriteReach = {
  readonly categoryIds: ReadonlyArray<string>;
  readonly categoryNames: ReadonlyArray<string>;
  readonly productIds: ReadonlyArray<string>;
  readonly batchIds: ReadonlyArray<string>;
  readonly movementIds: ReadonlyArray<string>;
  readonly supplierIds: ReadonlyArray<string>;
  readonly supplierNames: ReadonlyArray<string>;
  readonly orderIds: ReadonlyArray<string>;
  readonly orderNumbers: ReadonlyArray<number>;
  readonly lineIds: ReadonlyArray<string>;
  readonly deletedCategoryIds: ReadonlyArray<string>;
  readonly stockCheckedProductIds: ReadonlyArray<string>;
  readonly deletedSupplierIds: ReadonlyArray<string>;
  readonly deletedOrderIds: ReadonlyArray<string>;
  readonly writtenOrderIds: ReadonlyArray<string>;
  readonly writtenLineIds: ReadonlyArray<string>;
};

const NO_REACH: WriteReach = {
  categoryIds: [],
  categoryNames: [],
  productIds: [],
  batchIds: [],
  movementIds: [],
  supplierIds: [],
  supplierNames: [],
  orderIds: [],
  orderNumbers: [],
  lineIds: [],
  deletedCategoryIds: [],
  stockCheckedProductIds: [],
  deletedSupplierIds: [],
  deletedOrderIds: [],
  writtenOrderIds: [],
  writtenLineIds: [],
};

const reachOf = (write: CatalogRowWrite): WriteReach => {
  switch (write.entity) {
    case "category":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, categoryIds: [write.id], deletedCategoryIds: [write.id] };
        case "upsert":
          return { ...NO_REACH, categoryIds: [write.id], categoryNames: [write.row.name] };
      }
    case "product":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, productIds: [write.id], stockCheckedProductIds: [write.id] };
        case "upsert":
          return {
            ...NO_REACH,
            productIds: [write.id],
            stockCheckedProductIds: [write.id],
            categoryIds: [write.row.categoryId],
          };
      }
    case "batch":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, batchIds: [write.id] };
        case "upsert": {
          const lineIds = write.receipt === undefined ? [] : [write.receipt.purchaseOrderItemId];
          return {
            ...NO_REACH,
            batchIds: [write.id],
            productIds: [write.row.productId],
            movementIds: [write.movementId],
            lineIds,
            writtenLineIds: lineIds,
          };
        }
      }
    case "supplier":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, supplierIds: [write.id], deletedSupplierIds: [write.id] };
        case "upsert":
          return { ...NO_REACH, supplierIds: [write.id], supplierNames: [write.row.name] };
      }
    case "purchaseOrder":
      switch (write.action) {
        case "delete":
          return {
            ...NO_REACH,
            orderIds: [write.id],
            writtenOrderIds: [write.id],
            deletedOrderIds: [write.id],
          };
        case "upsert":
          return {
            ...NO_REACH,
            orderIds: [write.id],
            writtenOrderIds: [write.id],
            supplierIds: [write.row.supplierId],
            orderNumbers: write.expectedRowVersion === null ? [write.row.orderNumber] : [],
          };
      }
    case "purchaseOrderItem":
      switch (write.action) {
        case "delete":
          return { ...NO_REACH, lineIds: [write.id], writtenLineIds: [write.id] };
        case "upsert":
          return {
            ...NO_REACH,
            lineIds: [write.id],
            writtenLineIds: [write.id],
            orderIds: [write.row.purchaseOrderId],
            productIds: [write.row.productId],
          };
      }
  }
};

const footprintOf = (payload: CatalogPayload) => {
  const reaches = payload.writes.map(reachOf);
  const union = <Value>(pick: (reach: WriteReach) => ReadonlyArray<Value>) =>
    new Set(reaches.flatMap(pick));
  return {
    categoryIds: union((reach) => reach.categoryIds),
    categoryNames: union((reach) => reach.categoryNames),
    productIds: union((reach) => reach.productIds),
    batchIds: union((reach) => reach.batchIds),
    movementIds: union((reach) => reach.movementIds),
    supplierIds: union((reach) => reach.supplierIds),
    supplierNames: union((reach) => reach.supplierNames),
    orderIds: union((reach) => reach.orderIds),
    orderNumbers: union((reach) => reach.orderNumbers),
    lineIds: union((reach) => reach.lineIds),
    deletedCategoryIds: union((reach) => reach.deletedCategoryIds),
    stockCheckedProductIds: union((reach) => reach.stockCheckedProductIds),
    deletedSupplierIds: union((reach) => reach.deletedSupplierIds),
    deletedOrderIds: union((reach) => reach.deletedOrderIds),
    writtenOrderIds: union((reach) => reach.writtenOrderIds),
    writtenLineIds: union((reach) => reach.writtenLineIds),
  };
};

const loadPurchasingRows = Effect.fn("LocalAuthority.loadPurchasingRows")(function* (
  tx: ReplicaDb,
  organizationId: string,
  journal: PendingJournal,
  footprint: ReturnType<typeof footprintOf>,
) {
  const supplierView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "supplier",
    ReplicaSupplierRow,
  );
  const orderView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "purchaseOrder",
    ReplicaPurchaseOrderRow,
  );
  const lineView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "purchaseOrderItem",
    ReplicaPurchaseOrderItemRow,
  );
  const untouchedOrders = footprint.writtenOrderIds.size + 1;
  const untouchedLines = footprint.writtenLineIds.size + 1;

  const lines = byId([
    ...(yield* lineView.rowsOf(footprint.lineIds)).values(),
    ...(yield* Effect.forEach([...footprint.deletedOrderIds], (orderId) =>
      lineView.firstStored(
        eq(purchaseOrderItems.purchaseOrderId, orderId),
        purchaseOrderItems.id,
        untouchedLines,
      ),
    )).flat(),
    ...lineView.restored.values(),
  ]);
  const orders = byId([
    ...(yield* orderView.rowsOf([
      ...footprint.orderIds,
      ...[...lines.values()].map((line) => line.purchaseOrderId),
    ])).values(),
    ...(yield* Effect.forEach([...footprint.deletedSupplierIds], (supplierId) =>
      orderView.firstStored(
        eq(purchaseOrders.supplierId, supplierId),
        purchaseOrders.id,
        untouchedOrders,
      ),
    )).flat(),
    ...(yield* Effect.forEach(chunked(journal, [...footprint.orderNumbers]), (chunk) =>
      orderView.stored(inArray(purchaseOrders.orderNumber, chunk)),
    )).flat(),
    ...(footprint.orderNumbers.size === 0
      ? []
      : yield* orderView.firstStored(undefined, desc(purchaseOrders.orderNumber), untouchedOrders)),
    ...orderView.restored.values(),
  ]);
  const namedSuppliers = yield* Effect.forEach(
    chunked(journal, [...footprint.supplierNames]),
    (chunk) => supplierView.stored(inArray(suppliers.name, chunk)),
  );
  return {
    supplier: byId([
      ...(yield* supplierView.rowsOf(footprint.supplierIds)).values(),
      ...namedSuppliers.flat(),
      ...supplierView.restored.values(),
    ]),
    purchaseOrder: orders,
    purchaseOrderItem: lines,
  } satisfies Pick<CatalogRowsById, PurchasingEntity>;
});

export const loadCatalogFacts = Effect.fn("LocalAuthority.loadCatalogFacts")(function* (
  tx: ReplicaDb,
  organizationId: string,
  payload: CatalogPayload,
  journal: PendingJournal,
) {
  const footprint = footprintOf(payload);
  const categoryView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "category",
    ReplicaCategoryRow,
  );
  const productView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "product",
    ReplicaProductRow,
  );
  const batchView = yield* authoritativeView(tx, organizationId, journal, "batch", ReplicaBatchRow);
  const movementView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "stockMovement",
    ReplicaStockMovementRow,
  );

  const namedStored = yield* Effect.forEach(
    chunked(journal, [...footprint.categoryNames]),
    (chunk) =>
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.organizationId, organizationId),
            inArray(categories.name, chunk),
            journal.unjournaled("category", categories.id),
          ),
        )
        .all(),
  );
  const namedRestored = [...categoryView.restored.values()].filter((category) =>
    footprint.categoryNames.has(category.name),
  );
  const categoryRows = yield* categoryView.rowsOf([
    ...footprint.categoryIds,
    ...namedStored.flat().map((category) => category.id),
    ...namedRestored.map((category) => category.id),
  ]);
  const productRows = yield* productView.rowsOf(footprint.productIds);
  const batchRows = yield* batchView.rowsOf(footprint.batchIds);
  const movementRows = yield* movementView.rowsOf(footprint.movementIds);

  const storedProductsByCategory = yield* Effect.forEach(
    chunked(journal, [...footprint.deletedCategoryIds]),
    (chunk) =>
      tx
        .select({ key: products.categoryId, total: count() })
        .from(products)
        .where(
          and(
            eq(products.organizationId, organizationId),
            inArray(products.categoryId, chunk),
            journal.unjournaled("product", products.id),
          ),
        )
        .groupBy(products.categoryId)
        .all()
        .pipe(Effect.flatMap(decodeCountedKeys)),
  );
  const loadedProductsByCategory = tally(
    [...productRows.values()].filter((product) => !productView.journaled(product.id)),
    (product) => product.categoryId,
  );
  const restoredProductCategories = new Set<string>(
    [...productView.restored.values()]
      .filter((product) => !footprint.productIds.has(product.id))
      .map((product) => product.categoryId),
  );
  const categoriesHoldingOtherProducts = new Set([
    ...[...footprint.deletedCategoryIds].filter((id) => restoredProductCategories.has(id)),
    ...storedProductsByCategory
      .flat()
      .filter((row) => row.total > (loadedProductsByCategory.get(row.key) ?? 0))
      .map((row) => row.key),
  ]);

  const storedStockByProduct = yield* Effect.forEach(
    chunked(journal, [...footprint.stockCheckedProductIds]),
    (chunk) =>
      tx
        .select({ key: batches.productId, total: count() })
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, organizationId),
            inArray(batches.productId, chunk),
            or(gt(batches.packQuantity, 0), gt(batches.unitQuantity, 0)),
            journal.unjournaled("batch", batches.id),
          ),
        )
        .groupBy(batches.productId)
        .all()
        .pipe(Effect.flatMap(decodeCountedKeys)),
  );
  const loadedStockByProduct = tally(
    [...batchRows.values()].filter((batch) => !batchView.journaled(batch.id) && hasStock(batch)),
    (batch) => batch.productId,
  );
  const restoredStockProducts = new Set<string>(
    [...batchView.restored.values()]
      .filter((batch) => !footprint.batchIds.has(batch.id) && hasStock(batch))
      .map((batch) => batch.productId),
  );
  const productsHoldingOtherStock = new Set([
    ...[...footprint.stockCheckedProductIds].filter((id) => restoredStockProducts.has(id)),
    ...storedStockByProduct
      .flat()
      .filter((row) => row.total > (loadedStockByProduct.get(row.key) ?? 0))
      .map((row) => row.key),
  ]);

  return {
    rows: {
      category: categoryRows,
      product: productRows,
      batch: batchRows,
      ...(yield* loadPurchasingRows(tx, organizationId, journal, footprint)),
    },
    recordedMovementIds: new Set(movementRows.keys()),
    categoriesHoldingOtherProducts,
    productsHoldingOtherStock,
  } satisfies LocalCatalogFacts;
});

export const loadInvoiceFacts = Effect.fn("LocalAuthority.loadInvoiceFacts")(function* (
  tx: ReplicaDb,
  organizationId: string,
  payload: InvoicePayload,
  journal: PendingJournal,
) {
  const productView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "product",
    ReplicaProductRow,
  );
  const batchView = yield* authoritativeView(tx, organizationId, journal, "batch", ReplicaBatchRow);
  const invoiceView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "invoice",
    ReplicaInvoiceRow,
  );
  const itemView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "invoiceItem",
    ReplicaInvoiceItemRow,
  );
  const movementView = yield* authoritativeView(
    tx,
    organizationId,
    journal,
    "stockMovement",
    ReplicaStockMovementRow,
  );

  const settled = and(
    eq(invoices.organizationId, organizationId),
    journal.unjournaled("invoice", invoices.id),
  );
  const restoredNumbers = [...invoiceView.restored.values()].map(
    (invoice) => invoice.invoiceNumber,
  );
  const storedHolder = yield* tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(settled, eq(invoices.invoiceNumber, payload.invoiceNumber)))
    .limit(1)
    .get();
  const invoiceNumberTaken =
    storedHolder !== undefined || restoredNumbers.includes(payload.invoiceNumber);
  const storedHighest = invoiceNumberTaken
    ? yield* tx
        .select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(settled)
        .orderBy(desc(invoices.invoiceNumber))
        .limit(1)
        .get()
    : undefined;

  return {
    products: yield* productView.rowsOf(payload.allocations.map((take) => take.productId)),
    batches: yield* batchView.rowsOf(payload.allocations.map((take) => take.batchId)),
    invoice: (yield* invoiceView.rowsOf([payload.invoiceId])).get(payload.invoiceId),
    invoiceNumberTaken,
    highestInvoiceNumber: Math.max(0, storedHighest?.invoiceNumber ?? 0, ...restoredNumbers),
    recordedItemIds: new Set(
      (yield* itemView.rowsOf(payload.allocations.map((take) => take.invoiceItemId))).keys(),
    ),
    recordedMovementIds: new Set(
      (yield* movementView.rowsOf(
        payload.allocations.flatMap((take) => [take.saleMovementId, openPackMovementId(take)]),
      )).keys(),
    ),
  } satisfies LocalInvoiceFacts;
});
