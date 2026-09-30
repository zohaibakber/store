import type { SyncCommand } from "@store/contracts";
import type {
  ReplicaBatchRow,
  ReplicaCategoryRow,
  ReplicaProductRow,
} from "@store/contracts/sync/replica-model";
import * as Effect from "effect/Effect";

import type { ReplicaCatalogLookup } from "./projection";

export type CommandFootprint = {
  readonly categoryIds: ReadonlyArray<string>;
  readonly productIds: ReadonlyArray<string>;
  readonly batchIds: ReadonlyArray<string>;
};

type RuleDependencies = {
  readonly categoriesNeedingProductCheck: ReadonlyArray<string>;
  readonly productsNeedingStockCheck: ReadonlyArray<string>;
};

const unique = (values: Iterable<string>): ReadonlyArray<string> => [...new Set(values)];

const commandFootprint = (command: SyncCommand): CommandFootprint => {
  if (command._tag === "issueInvoice") {
    return {
      categoryIds: [],
      productIds: unique(command.payload.allocations.map((take) => take.productId)),
      batchIds: unique(command.payload.allocations.map((take) => take.batchId)),
    };
  }
  const idsOf = (entity: "category" | "product" | "batch") =>
    unique(
      command.payload.writes.filter((write) => write.entity === entity).map((write) => write.id),
    );
  return {
    categoryIds: idsOf("category"),
    productIds: idsOf("product"),
    batchIds: idsOf("batch"),
  };
};

const ruleDependencies = (
  command: SyncCommand,
  existingUnitsPerPack: (productId: string) => number | undefined,
): RuleDependencies => {
  if (command._tag !== "catalogWrite") {
    return { categoriesNeedingProductCheck: [], productsNeedingStockCheck: [] };
  }
  const categories = new Set<string>();
  const products = new Set<string>();
  for (const write of command.payload.writes) {
    if (write.entity === "category" && write.action === "delete") categories.add(write.id);
    if (write.entity !== "product") continue;
    if (write.action === "delete") {
      products.add(write.id);
      continue;
    }
    const existing = existingUnitsPerPack(write.id);
    if (existing !== undefined && existing !== write.row.unitsPerPack) products.add(write.id);
  }
  return {
    categoriesNeedingProductCheck: [...categories],
    productsNeedingStockCheck: [...products],
  };
};

type CatalogRows = {
  readonly categories: ReadonlyArray<ReplicaCategoryRow>;
  readonly products: ReadonlyArray<ReplicaProductRow>;
  readonly batches: ReadonlyArray<ReplicaBatchRow>;
};

export type CatalogReads<E, R> = {
  readonly rowsOf: (footprint: CommandFootprint) => Effect.Effect<CatalogRows, E, R>;
  readonly productInCategory: (
    categoryId: string,
  ) => Effect.Effect<{ readonly categoryId: string } | undefined, E, R>;
  readonly stockedBatchOfProduct: (
    productId: string,
  ) => Effect.Effect<ReplicaBatchRow | undefined, E, R>;
};

type LoadedCatalog = {
  readonly rows: CatalogRows;
  readonly lookup: ReplicaCatalogLookup;
};

const byId = <Row extends { readonly id: string }>(
  rows: ReadonlyArray<Row>,
): ReadonlyMap<string, Row> => new Map(rows.map((row) => [row.id, row]));

export const loadCatalog = <E, R>(
  command: SyncCommand,
  reads: CatalogReads<E, R>,
  options: { readonly checkRules: boolean },
): Effect.Effect<LoadedCatalog, E, R> =>
  Effect.gen(function* () {
    const rows = yield* reads.rowsOf(commandFootprint(command));
    const categories = byId(rows.categories);
    const products = byId(rows.products);
    const batches = byId(rows.batches);
    const dependencies = options.checkRules
      ? ruleDependencies(command, (productId) => products.get(productId)?.unitsPerPack)
      : { categoriesNeedingProductCheck: [], productsNeedingStockCheck: [] };
    const productInCategory = new Map<string, { readonly categoryId: string }>();
    for (const categoryId of dependencies.categoriesNeedingProductCheck) {
      const blocking = yield* reads.productInCategory(categoryId);
      if (blocking) productInCategory.set(categoryId, blocking);
    }
    const stocked = new Map<string, ReplicaBatchRow>();
    for (const productId of dependencies.productsNeedingStockCheck) {
      const batch = yield* reads.stockedBatchOfProduct(productId);
      if (batch) stocked.set(productId, batch);
    }
    return {
      rows,
      lookup: {
        category: (categoryId) => categories.get(categoryId),
        product: (productId) => products.get(productId),
        batch: (batchId) => batches.get(batchId),
        productInCategory: (categoryId) => productInCategory.get(categoryId),
        stockedBatchOfProduct: (productId) => stocked.get(productId),
      } satisfies ReplicaCatalogLookup,
    };
  });
