import type { CatalogRowWrite, SyncCommand } from "@store/contracts";
import type { SyncEntityRow } from "@store/contracts/entity-rows";
import * as Effect from "effect/Effect";

import { EMPTY_STOCK, type VisibleStock } from "./decisions";
import type { CatalogEntity, ReplicaCatalogLookup } from "./projection";

type CommandFootprint = {
  readonly [Entity in CatalogEntity]: ReadonlyArray<string>;
};

type CatalogRows = {
  readonly [Entity in CatalogEntity]: ReadonlyArray<SyncEntityRow<Entity>>;
};

type EntityReference = { readonly id: string };

type NumberedOrderReference = EntityReference & { readonly orderNumber: number };

type RuleDependencies = {
  readonly categoriesNeedingProductCheck: ReadonlyArray<string>;
  readonly productsNeedingStockCheck: ReadonlyArray<string>;
  readonly supplierNames: ReadonlyArray<string>;
  readonly suppliersNeedingOrderCheck: ReadonlyArray<string>;
  readonly purchaseOrdersNeedingItemCheck: ReadonlyArray<string>;
  readonly purchaseOrderReferenceLimit: number;
  readonly itemReferenceLimit: number;
};

const EMPTY_FOOTPRINT: CommandFootprint = {
  category: [],
  product: [],
  batch: [],
  supplier: [],
  purchaseOrder: [],
  purchaseOrderItem: [],
};

const NO_RULE_DEPENDENCIES: RuleDependencies = {
  categoriesNeedingProductCheck: [],
  productsNeedingStockCheck: [],
  supplierNames: [],
  suppliersNeedingOrderCheck: [],
  purchaseOrdersNeedingItemCheck: [],
  purchaseOrderReferenceLimit: 0,
  itemReferenceLimit: 0,
};

const unique = <Value>(values: Iterable<Value>): ReadonlyArray<Value> => [...new Set(values)];

const catalogWritesOf = (command: SyncCommand): ReadonlyArray<CatalogRowWrite> => {
  switch (command._tag) {
    case "issueInvoice":
      return [];
    case "catalogWrite":
      return command.payload.writes;
  }
};

const catalogFootprint = (writes: ReadonlyArray<CatalogRowWrite>): CommandFootprint => {
  const ids = {
    category: new Set<string>(),
    product: new Set<string>(),
    batch: new Set<string>(),
    supplier: new Set<string>(),
    purchaseOrder: new Set<string>(),
    purchaseOrderItem: new Set<string>(),
  } satisfies Record<CatalogEntity, Set<string>>;
  for (const write of writes) {
    ids[write.entity].add(write.id);
    if (write.action === "delete") continue;
    switch (write.entity) {
      case "category":
      case "product":
      case "supplier":
        break;
      case "batch":
        if (write.receipt !== undefined) {
          ids.product.add(write.row.productId);
          ids.purchaseOrderItem.add(write.receipt.purchaseOrderItemId);
        }
        break;
      case "purchaseOrder":
        ids.supplier.add(write.row.supplierId);
        break;
      case "purchaseOrderItem":
        ids.purchaseOrder.add(write.row.purchaseOrderId);
        ids.product.add(write.row.productId);
        break;
      default:
        write satisfies never;
    }
  }
  return {
    category: [...ids.category],
    product: [...ids.product],
    batch: [...ids.batch],
    supplier: [...ids.supplier],
    purchaseOrder: [...ids.purchaseOrder],
    purchaseOrderItem: [...ids.purchaseOrderItem],
  };
};

const commandFootprint = (command: SyncCommand): CommandFootprint => {
  switch (command._tag) {
    case "issueInvoice":
      return {
        ...EMPTY_FOOTPRINT,
        product: unique(command.payload.allocations.map((take) => take.productId)),
        batch: unique(command.payload.allocations.map((take) => take.batchId)),
      };
    case "catalogWrite":
      return catalogFootprint(command.payload.writes);
  }
};

const ruleDependencies = (
  writes: ReadonlyArray<CatalogRowWrite>,
  storedUnitsPerPack: (productId: string) => number | undefined,
): RuleDependencies => {
  const categories = new Set<string>();
  const products = new Set<string>();
  const supplierNames = new Set<string>();
  const suppliers = new Set<string>();
  const purchaseOrders = new Set<string>();
  let purchaseOrderWrites = 0;
  let itemWrites = 0;
  for (const write of writes) {
    switch (write.entity) {
      case "category":
        if (write.action === "delete") categories.add(write.id);
        break;
      case "product": {
        if (write.action === "delete") {
          products.add(write.id);
          break;
        }
        const stored = storedUnitsPerPack(write.id);
        if (stored !== undefined && stored !== write.row.unitsPerPack) products.add(write.id);
        break;
      }
      case "batch":
        if (write.action === "upsert" && write.receipt !== undefined) itemWrites += 1;
        break;
      case "supplier":
        if (write.action === "delete") suppliers.add(write.id);
        else supplierNames.add(write.row.name);
        break;
      case "purchaseOrder":
        purchaseOrderWrites += 1;
        if (write.action === "delete") purchaseOrders.add(write.id);
        break;
      case "purchaseOrderItem":
        itemWrites += 1;
        break;
      default:
        write satisfies never;
    }
  }
  return {
    categoriesNeedingProductCheck: [...categories],
    productsNeedingStockCheck: [...products],
    supplierNames: [...supplierNames],
    suppliersNeedingOrderCheck: [...suppliers],
    purchaseOrdersNeedingItemCheck: [...purchaseOrders],
    purchaseOrderReferenceLimit: purchaseOrderWrites + 1,
    itemReferenceLimit: itemWrites + 1,
  };
};

type OrderNumbering = {
  readonly proposed: ReadonlyArray<number>;
  readonly removals: number;
};

const orderNumbering = (writes: ReadonlyArray<CatalogRowWrite>): OrderNumbering => {
  const proposed = new Set<number>();
  let removals = 0;
  for (const write of writes) {
    if (write.entity !== "purchaseOrder") continue;
    switch (write.action) {
      case "delete":
        removals += 1;
        break;
      case "upsert":
        if (write.expectedRowVersion === null) proposed.add(write.row.orderNumber);
        break;
      default:
        write satisfies never;
    }
  }
  return { proposed: [...proposed], removals };
};

export type CatalogReads<E, R> = {
  readonly rowsOf: (footprint: CommandFootprint) => Effect.Effect<CatalogRows, E, R>;
  readonly productInCategory: (
    categoryId: string,
  ) => Effect.Effect<{ readonly categoryId: string } | undefined, E, R>;
  readonly stockedBatchOfProduct: (
    productId: string,
  ) => Effect.Effect<SyncEntityRow<"batch"> | undefined, E, R>;
  readonly supplierNamed: (name: string) => Effect.Effect<EntityReference | undefined, E, R>;
  readonly purchaseOrdersOfSupplier: (
    supplierId: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<EntityReference>, E, R>;
  readonly itemsOfPurchaseOrder: (
    purchaseOrderId: string,
    limit: number,
  ) => Effect.Effect<ReadonlyArray<EntityReference>, E, R>;
  readonly purchaseOrderNumbered: (
    orderNumber: number,
  ) => Effect.Effect<EntityReference | undefined, E, R>;
  readonly highestPurchaseOrders: (
    limit: number,
  ) => Effect.Effect<ReadonlyArray<NumberedOrderReference>, E, R>;
  readonly visibleStock: (
    batches: ReadonlyArray<SyncEntityRow<"batch">>,
  ) => Effect.Effect<ReadonlyMap<string, VisibleStock>, E, R>;
};

type LoadedCatalog = {
  readonly rows: CatalogRows;
  readonly lookup: ReplicaCatalogLookup;
};

const byId = <Row extends { readonly id: string }>(
  rows: ReadonlyArray<Row>,
): ReadonlyMap<string, Row> => new Map(rows.map((row) => [row.id, row]));

const loadRows = <E, R>(command: SyncCommand, reads: CatalogReads<E, R>) =>
  Effect.gen(function* () {
    const direct = yield* reads.rowsOf(commandFootprint(command));
    const loaded = new Set(direct.purchaseOrder.map((order) => order.id));
    const lineOrders = unique(
      direct.purchaseOrderItem
        .map((line) => line.purchaseOrderId)
        .filter((purchaseOrderId) => !loaded.has(purchaseOrderId)),
    );
    if (lineOrders.length === 0) return direct;
    const related = yield* reads.rowsOf({ ...EMPTY_FOOTPRINT, purchaseOrder: lineOrders });
    return {
      ...direct,
      purchaseOrder: [...direct.purchaseOrder, ...related.purchaseOrder],
    } satisfies CatalogRows;
  });

const loadCatalog = <E, R>(
  command: SyncCommand,
  reads: CatalogReads<E, R>,
  options: { readonly checkRules: boolean },
): Effect.Effect<LoadedCatalog, E, R> =>
  Effect.gen(function* () {
    const rows = yield* loadRows(command, reads);
    const writes = catalogWritesOf(command);
    const categories = byId(rows.category);
    const products = byId(rows.product);
    const batches = byId(rows.batch);
    const suppliers = byId(rows.supplier);
    const purchaseOrders = byId(rows.purchaseOrder);
    const purchaseOrderItems = byId(rows.purchaseOrderItem);
    const dependencies = options.checkRules
      ? ruleDependencies(writes, (productId) => products.get(productId)?.unitsPerPack)
      : NO_RULE_DEPENDENCIES;
    const productInCategory = new Map<string, { readonly categoryId: string }>();
    for (const categoryId of dependencies.categoriesNeedingProductCheck) {
      const blocking = yield* reads.productInCategory(categoryId);
      if (blocking) productInCategory.set(categoryId, blocking);
    }
    const stocked = new Map<string, SyncEntityRow<"batch">>();
    for (const productId of dependencies.productsNeedingStockCheck) {
      const batch = yield* reads.stockedBatchOfProduct(productId);
      if (batch) stocked.set(productId, batch);
    }
    const supplierNamed = new Map<string, EntityReference>();
    for (const name of dependencies.supplierNames) {
      const holder = yield* reads.supplierNamed(name);
      if (holder) supplierNamed.set(name, holder);
    }
    const purchaseOrdersOfSupplier = new Map<string, ReadonlyArray<EntityReference>>();
    for (const supplierId of dependencies.suppliersNeedingOrderCheck) {
      purchaseOrdersOfSupplier.set(
        supplierId,
        yield* reads.purchaseOrdersOfSupplier(supplierId, dependencies.purchaseOrderReferenceLimit),
      );
    }
    const itemsOfPurchaseOrder = new Map<string, ReadonlyArray<EntityReference>>();
    for (const purchaseOrderId of dependencies.purchaseOrdersNeedingItemCheck) {
      itemsOfPurchaseOrder.set(
        purchaseOrderId,
        yield* reads.itemsOfPurchaseOrder(purchaseOrderId, dependencies.itemReferenceLimit),
      );
    }
    const numbering = orderNumbering(writes);
    const purchaseOrderNumbered = new Map<number, EntityReference>();
    for (const orderNumber of numbering.proposed) {
      const holder = yield* reads.purchaseOrderNumbered(orderNumber);
      if (holder) purchaseOrderNumbered.set(orderNumber, holder);
    }
    const highestPurchaseOrders =
      numbering.proposed.length === 0
        ? []
        : yield* reads.highestPurchaseOrders(numbering.removals + 1);
    return {
      rows,
      lookup: {
        category: (id) => categories.get(id),
        product: (id) => products.get(id),
        batch: (id) => batches.get(id),
        supplier: (id) => suppliers.get(id),
        purchaseOrder: (id) => purchaseOrders.get(id),
        purchaseOrderItem: (id) => purchaseOrderItems.get(id),
        productInCategory: (categoryId) => productInCategory.get(categoryId),
        stockedBatchOfProduct: (productId) => stocked.get(productId),
        supplierNamed: (name) => supplierNamed.get(name),
        purchaseOrdersOfSupplier: (supplierId) => purchaseOrdersOfSupplier.get(supplierId) ?? [],
        itemsOfPurchaseOrder: (purchaseOrderId) => itemsOfPurchaseOrder.get(purchaseOrderId) ?? [],
        purchaseOrderNumbered: (orderNumber) => purchaseOrderNumbered.get(orderNumber),
        highestPurchaseOrders,
      } satisfies ReplicaCatalogLookup,
    };
  });

export type CommandContext = {
  readonly lookup: ReplicaCatalogLookup;
  readonly unitsPerPackFor: (productId: string) => number;
  readonly stockFor: (batchId: string) => VisibleStock;
};

const NO_STOCK: ReadonlyMap<string, VisibleStock> = new Map();

export const loadCommandContext = <E, R>(
  command: SyncCommand,
  reads: CatalogReads<E, R>,
  options: { readonly checkRules: boolean; readonly withStock: boolean },
): Effect.Effect<CommandContext, E, R> =>
  Effect.gen(function* () {
    const { rows, lookup } = yield* loadCatalog(command, reads, options);
    const stock = options.withStock ? yield* reads.visibleStock(rows.batch) : NO_STOCK;
    return {
      lookup,
      unitsPerPackFor: (productId) => lookup.product(productId)?.unitsPerPack ?? 1,
      stockFor: (batchId) => stock.get(batchId) ?? EMPTY_STOCK,
    };
  });
