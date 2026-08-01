import type {
  Batch,
  Category,
  CreateBatchInput,
  CreateCategoryInput,
  CreateProductInput,
  ImportInventoryInput,
  ImportInventoryResult,
  Product,
  SearchProductsInput,
  StockMovement,
  UpdateBatchInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import { batches, categories, products, stockMovements } from "@store/db/local/schema";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { Workspace } from "../config";
import type { StoreDatabase } from "../database/client";
import {
  BatchNotFoundError,
  CategoryNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  mapPersistenceError,
  persistenceError,
} from "../errors";
import { toBatch, toCategory, toProduct, toStockMovement } from "./models";
import type { InventoryMutation } from "./mutation";
import { prepare as prepareProduct, rank as rankProducts } from "./product-ranking";

export interface ProductStore {
  readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
  readonly createCategory: (
    input: CreateCategoryInput,
  ) => Effect.Effect<Category, PersistenceError>;
  readonly updateCategory: (
    input: UpdateCategoryInput,
  ) => Effect.Effect<Category, PersistenceError | CategoryNotFoundError>;
  readonly deleteCategory: (
    id: string,
  ) => Effect.Effect<void, PersistenceError | CategoryNotFoundError>;
  readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
  readonly listCompositions: Effect.Effect<ReadonlyArray<string>, PersistenceError>;
  readonly searchProducts: (
    input: SearchProductsInput,
  ) => Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
  readonly getProduct: (
    id: string,
  ) => Effect.Effect<Product, PersistenceError | ProductNotFoundError>;
  readonly createProduct: (input: CreateProductInput) => Effect.Effect<Product, PersistenceError>;
  readonly updateProduct: (
    input: UpdateProductInput,
  ) => Effect.Effect<Product, PersistenceError | ProductNotFoundError>;
  readonly deleteProduct: (
    id: string,
  ) => Effect.Effect<void, PersistenceError | ProductNotFoundError>;
  readonly createBatch: (
    input: CreateBatchInput,
  ) => Effect.Effect<Batch, PersistenceError | ProductNotFoundError>;
  readonly updateBatch: (
    input: UpdateBatchInput,
  ) => Effect.Effect<Batch, PersistenceError | BatchNotFoundError>;
  readonly importInventory: (
    input: ImportInventoryInput,
  ) => Effect.Effect<ImportInventoryResult, PersistenceError | ProductNotFoundError>;
  readonly listStockMovements: (
    productId: string,
  ) => Effect.Effect<ReadonlyArray<StockMovement>, PersistenceError>;
}

const queryConfig = <const Config>(config: Config) => config;

const IMPORT_SYNC_CHANGES_PER_OPERATION = 200;

const productRelations = queryConfig({
  category: true,
  batches: {
    where: { deletedAt: { isNull: true } },
    orderBy: { expiresAt: "asc", createdAt: "asc" },
  },
});

export const makeProductStore = (
  database: StoreDatabase,
  workspace: Workspace,
  mutation: InventoryMutation,
): ProductStore => {
  const findProduct = (organizationId: string, id: string) =>
    database.query.products.findFirst({
      where: { organizationId, id, deletedAt: { isNull: true } },
      with: productRelations,
    });

  const listCategories = database.query.categories
    .findMany({
      orderBy: { name: "asc" },
      where: { organizationId: workspace.organizationId, deletedAt: { isNull: true } },
    })
    .pipe(
      Effect.map((rows) => rows.map(toCategory)),
      mapPersistenceError("list categories"),
    );

  const categoryId = (name: string) =>
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const createCategory = Effect.fn("OfflineStore.createCategory")(function* (
    input: CreateCategoryInput,
  ) {
    const name = input.name.trim();
    if (name.length === 0)
      return yield* PersistenceError.make({
        operation: "create category",
        message: "Enter a category name",
      });

    const row = yield* mutation
      .run("create category", (transaction, scope) =>
        Effect.gen(function* () {
          const id = categoryId(name) || (yield* scope.nextId);
          const existing = yield* transaction.query.categories.findFirst({
            where: { organizationId: scope.organizationId, id, deletedAt: { isNull: true } },
          });
          if (existing) return existing;

          const [created] = yield* transaction
            .insert(categories)
            .values({ name, tracksPacks: input.tracksPacks ?? true, ...scope.createVersioned(id) })
            .returning();
          if (!created)
            return yield* PersistenceError.make({
              operation: "create category",
              message: "Created category could not be loaded",
            });
          yield* scope.capture({
            entity: "category",
            action: "upsert",
            entityId: created.id,
            rowVersion: created.rowVersion,
            row: created,
          });
          return created;
        }),
      )
      .pipe(mapPersistenceError("create category"));
    return toCategory(row);
  });

  const updateCategory = Effect.fn("OfflineStore.updateCategory")(function* (
    input: UpdateCategoryInput,
  ) {
    const name = input.name.trim();
    if (name.length === 0)
      return yield* PersistenceError.make({
        operation: "update category",
        message: "Enter a category name",
      });

    const updated = yield* mutation
      .run("update category", (transaction, scope) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.categories.findFirst({
            where: {
              organizationId: scope.organizationId,
              id: input.id,
              deletedAt: { isNull: true },
            },
          });
          if (!current) return undefined;
          const [row] = yield* transaction
            .update(categories)
            .set({
              name,
              tracksPacks: input.tracksPacks,
              ...scope.updateVersioned(current.rowVersion + 1),
            })
            .where(
              and(eq(categories.organizationId, scope.organizationId), eq(categories.id, input.id)),
            )
            .returning();
          if (!row) return undefined;
          yield* scope.capture({
            entity: "category",
            action: "upsert",
            entityId: row.id,
            rowVersion: row.rowVersion,
            row,
          });
          return row;
        }),
      )
      .pipe(mapPersistenceError("update category"));
    if (!updated) return yield* CategoryNotFoundError.make({ id: input.id });
    return toCategory(updated);
  });

  const deleteCategory = Effect.fn("OfflineStore.deleteCategory")(function* (id: string) {
    const deleted = yield* mutation
      .run("delete category", (transaction, scope) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.categories.findFirst({
            where: { organizationId: scope.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          // Products keep a foreign key to their category, so an in-use
          // category cannot go without orphaning them.
          const inUse = yield* transaction.query.products.findFirst({
            where: {
              organizationId: scope.organizationId,
              categoryId: id,
              deletedAt: { isNull: true },
            },
          });
          if (inUse)
            return yield* PersistenceError.make({
              operation: "delete category",
              message: `Move the products in “${current.name}” to another category first`,
            });

          const [row] = yield* transaction
            .update(categories)
            .set({
              deletedAt: scope.occurredAt,
              ...scope.updateVersioned(current.rowVersion + 1),
            })
            .where(and(eq(categories.organizationId, scope.organizationId), eq(categories.id, id)))
            .returning();
          if (!row) return undefined;
          yield* scope.capture({
            entity: "category",
            action: "delete",
            entityId: row.id,
            rowVersion: row.rowVersion,
            row,
          });
          return row;
        }),
      )
      .pipe(mapPersistenceError("delete category"));
    if (!deleted) return yield* CategoryNotFoundError.make({ id });
  });

  const listProducts = database.query.products
    .findMany({
      orderBy: { name: "asc" },
      where: { organizationId: workspace.organizationId, deletedAt: { isNull: true } },
      with: productRelations,
    })
    .pipe(
      Effect.map((rows) => rows.map(toProduct)),
      mapPersistenceError("list products"),
    );

  // Every composition already typed in this workspace, for the product form to
  // suggest from. The catalog is local, so this is a query, not a network call.
  const listCompositions = database
    .selectDistinct({ composition: products.composition })
    .from(products)
    .where(
      and(
        eq(products.organizationId, workspace.organizationId),
        isNotNull(products.composition),
        isNull(products.deletedAt),
      ),
    )
    .pipe(
      Effect.map((rows) =>
        rows
          .map((row) => row.composition?.trim())
          .filter((composition): composition is string => Boolean(composition))
          .sort((a, b) => a.localeCompare(b)),
      ),
      mapPersistenceError("list compositions"),
    );

  const searchProducts = Effect.fn("OfflineStore.searchProducts")((input: SearchProductsInput) => {
    const raw = input.query.trim();
    if (raw.length === 0) return Effect.succeed<ReadonlyArray<Product>>([]);
    const limit = input.limit ?? 20;

    return database
      .select({
        id: products.id,
        name: products.name,
        composition: products.composition,
      })
      .from(products)
      .where(
        and(
          eq(products.organizationId, workspace.organizationId),
          eq(products.visible, true),
          isNull(products.deletedAt),
        ),
      )
      .pipe(
        Effect.flatMap((candidates) => {
          const ids = rankProducts(candidates.map(prepareProduct), raw, limit).map(
            (entry) => entry.product.id,
          );
          if (ids.length === 0) return Effect.succeed<ReadonlyArray<Product>>([]);
          return database.query.products
            .findMany({
              where: {
                organizationId: workspace.organizationId,
                id: { in: ids },
                visible: true,
                deletedAt: { isNull: true },
              },
              with: productRelations,
            })
            .pipe(
              Effect.map((rows) => {
                const rank = new Map(ids.map((id, index) => [id, index] as const));
                return rows
                  .map(toProduct)
                  .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
              }),
            );
        }),
        mapPersistenceError("search products"),
      );
  });

  const getProduct = Effect.fn("OfflineStore.getProduct")(function* (id: string) {
    const row = yield* findProduct(workspace.organizationId, id).pipe(
      mapPersistenceError("find product"),
    );
    if (!row) return yield* ProductNotFoundError.make({ id });
    return toProduct(row);
  });

  const createProduct = Effect.fn("OfflineStore.createProduct")(function* (
    input: CreateProductInput,
  ) {
    const id = yield* mutation
      .run("create product", (transaction, scope) =>
        Effect.gen(function* () {
          // Nothing seeds categories any more, so a product without one would
          // fail on the foreign key with a SQL message nobody can act on.
          const categoryId = input.categoryId ?? "general";
          const category = yield* transaction.query.categories.findFirst({
            where: {
              organizationId: scope.organizationId,
              id: categoryId,
              deletedAt: { isNull: true },
            },
          });
          if (!category)
            return yield* PersistenceError.make({
              operation: "create product",
              message: "Pick a category for this product",
            });
          const id = yield* scope.nextId;
          const [row] = yield* transaction
            .insert(products)
            .values({
              ...input,
              name: input.name.trim(),
              ...scope.createVersioned(id),
            })
            .returning();
          if (!row)
            return yield* PersistenceError.make({
              operation: "create product",
              message: "Created product could not be loaded",
            });
          yield* scope.capture({
            entity: "product",
            action: "upsert",
            entityId: row.id,
            rowVersion: row.rowVersion,
            row,
          });
          return id;
        }),
      )
      .pipe(mapPersistenceError("create product"));
    const row = yield* findProduct(workspace.organizationId, id).pipe(
      mapPersistenceError("load created product"),
    );
    if (!row)
      return yield* PersistenceError.make({
        operation: "create product",
        message: "Created product could not be loaded",
      });
    return toProduct(row);
  });

  const updateProduct = Effect.fn("OfflineStore.updateProduct")(function* (
    input: UpdateProductInput,
  ) {
    const { id, ...changes } = input;
    const updated = yield* mutation
      .run("update product", (transaction, scope) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.products.findFirst({
            where: { organizationId: scope.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          const [row] = yield* transaction
            .update(products)
            .set({
              ...changes,
              name: changes.name.trim(),
              ...scope.updateVersioned(current.rowVersion + 1),
            })
            .where(and(eq(products.organizationId, scope.organizationId), eq(products.id, id)))
            .returning();
          if (!row) return undefined;
          yield* scope.capture({
            entity: "product",
            action: "upsert",
            entityId: row.id,
            rowVersion: row.rowVersion,
            row,
          });
          return row;
        }),
      )
      .pipe(mapPersistenceError("update product"));
    if (!updated) return yield* ProductNotFoundError.make({ id });
    const loaded = yield* findProduct(workspace.organizationId, id).pipe(
      mapPersistenceError("load updated product"),
    );
    if (!loaded) return yield* ProductNotFoundError.make({ id });
    return toProduct(loaded);
  });

  const deleteProduct = Effect.fn("OfflineStore.deleteProduct")(function* (id: string) {
    const deleted = yield* mutation
      .run("delete product", (transaction, scope) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.products.findFirst({
            where: { organizationId: scope.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          const [row] = yield* transaction
            .update(products)
            .set({
              deletedAt: scope.occurredAt,
              ...scope.updateVersioned(current.rowVersion + 1),
            })
            .where(and(eq(products.organizationId, scope.organizationId), eq(products.id, id)))
            .returning();
          if (!row) return undefined;
          yield* scope.capture({
            entity: "product",
            action: "delete",
            entityId: row.id,
            rowVersion: row.rowVersion,
            row,
          });
          return row;
        }),
      )
      .pipe(mapPersistenceError("delete product"));
    if (!deleted) return yield* ProductNotFoundError.make({ id });
  });

  const createBatch = Effect.fn("OfflineStore.createBatch")(function* (input: CreateBatchInput) {
    const packQuantity = input.packQuantity ?? 0;
    const unitQuantity = input.unitQuantity ?? 0;
    if (
      !Number.isInteger(packQuantity) ||
      !Number.isInteger(unitQuantity) ||
      packQuantity < 0 ||
      unitQuantity < 0 ||
      packQuantity + unitQuantity < 1
    )
      return yield* PersistenceError.make({
        operation: "create batch",
        message: "Pack and unit quantities must be non-negative whole numbers with some stock",
      });
    const product = yield* findProduct(workspace.organizationId, input.productId).pipe(
      mapPersistenceError("find product"),
    );
    if (!product) return yield* ProductNotFoundError.make({ id: input.productId });
    const row = yield* mutation
      .run("create batch", (transaction, scope) =>
        Effect.gen(function* () {
          const id = yield* scope.nextId;
          const [created] = yield* transaction
            .insert(batches)
            .values({
              ...input,
              packQuantity,
              unitQuantity,
              ...scope.createVersioned(id),
            })
            .returning();
          if (!created)
            return yield* PersistenceError.make({
              operation: "create batch",
              message: "Created batch could not be loaded",
            });
          const movementId = yield* scope.nextId;
          const [movement] = yield* transaction
            .insert(stockMovements)
            .values({
              ...scope.createMovement(movementId),
              productId: input.productId,
              batchId: id,
              invoiceId: null,
              type: "stock_in",
              packDelta: packQuantity,
              unitDelta: unitQuantity,
              note: "Initial batch stock",
            })
            .returning();
          if (!movement)
            return yield* PersistenceError.make({
              operation: "create batch",
              message: "Stock movement could not be recorded",
            });
          yield* scope.capture([
            {
              entity: "batch",
              action: "upsert",
              entityId: created.id,
              rowVersion: created.rowVersion,
              row: created,
            },
            {
              entity: "stockMovement",
              action: "upsert",
              entityId: movement.id,
              rowVersion: 1,
              row: movement,
            },
          ]);
          return created;
        }),
      )
      .pipe(mapPersistenceError("create batch"));
    return toBatch(row);
  });

  const updateBatch = Effect.fn("OfflineStore.updateBatch")(function* (input: UpdateBatchInput) {
    const { id, expiresAt } = input;
    if (expiresAt !== null && (!Number.isInteger(expiresAt) || expiresAt < 0))
      return yield* PersistenceError.make({
        operation: "update batch",
        message: "Expiry date must be a valid timestamp",
      });
    const batchNumber = input.batchNumber?.trim() || null;

    const updated = yield* mutation
      .run("update batch", (transaction, scope) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.batches.findFirst({
            where: { organizationId: scope.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          const [row] = yield* transaction
            .update(batches)
            .set({
              batchNumber,
              expiresAt,
              ...scope.updateVersioned(current.rowVersion + 1),
            })
            .where(and(eq(batches.organizationId, scope.organizationId), eq(batches.id, id)))
            .returning();
          if (!row) return undefined;
          yield* scope.capture({
            entity: "batch",
            action: "upsert",
            entityId: row.id,
            rowVersion: row.rowVersion,
            row,
          });
          return row;
        }),
      )
      .pipe(mapPersistenceError("update batch"));
    if (!updated) return yield* BatchNotFoundError.make({ id });
    return toBatch(updated);
  });

  const importInventory = Effect.fn("OfflineStore.importInventory")(function* (
    input: ImportInventoryInput,
  ) {
    return yield* mutation
      .run(
        "import inventory",
        (transaction, scope) =>
          Effect.gen(function* () {
            let createdProductCount = 0;
            let createdBatchCount = 0;

            const existingProducts = yield* transaction.query.products.findMany({
              where: { organizationId: scope.organizationId, deletedAt: { isNull: true } },
            });
            const productIdsByName = new Map(
              existingProducts.map(
                (product) => [product.name.trim().toLocaleLowerCase(), product.id] as const,
              ),
            );
            const knownProductIds = new Set(existingProducts.map((product) => product.id));

            for (const line of input.lines) {
              const packQuantity = line.packQuantity ?? 0;
              const unitQuantity = line.unitQuantity ?? 0;
              if (
                !Number.isInteger(packQuantity) ||
                !Number.isInteger(unitQuantity) ||
                packQuantity < 0 ||
                unitQuantity < 0
              )
                return yield* PersistenceError.make({
                  operation: "import inventory",
                  message: "Pack and unit quantities must be non-negative whole numbers",
                });

              const normalizedName = line.name.trim().toLocaleLowerCase();
              const existingProductId = line.productId
                ? undefined
                : productIdsByName.get(normalizedName);
              const createsProduct = line.productId === null && existingProductId === undefined;
              const createsBatch = packQuantity + unitQuantity > 0;
              const lineChangeCount = (createsProduct ? 1 : 0) + (createsBatch ? 2 : 0);
              yield* scope.reserve(lineChangeCount);

              let productId: string;
              if (line.productId) {
                if (!knownProductIds.has(line.productId))
                  return yield* ProductNotFoundError.make({ id: line.productId });
                productId = line.productId;
              } else {
                if (existingProductId) {
                  productId = existingProductId;
                } else {
                  const id = yield* scope.nextId;
                  const [created] = yield* transaction
                    .insert(products)
                    .values({
                      name: line.name.trim(),
                      categoryId: input.categoryId,
                      aisle: null,
                      composition: null,
                      strength: null,
                      unitsPerPack: line.unitsPerPack,
                      packPrice: line.packPrice,
                      unitPrice: null,
                      ...scope.createVersioned(id),
                    })
                    .returning();
                  if (!created)
                    return yield* PersistenceError.make({
                      operation: "import inventory",
                      message: "Created product could not be loaded",
                    });
                  yield* scope.capture({
                    entity: "product",
                    action: "upsert",
                    entityId: created.id,
                    rowVersion: created.rowVersion,
                    row: created,
                  });
                  productIdsByName.set(normalizedName, created.id);
                  knownProductIds.add(created.id);
                  createdProductCount += 1;
                  productId = created.id;
                }
              }

              if (packQuantity + unitQuantity > 0) {
                const batchId = yield* scope.nextId;
                const [createdBatch] = yield* transaction
                  .insert(batches)
                  .values({
                    productId,
                    batchNumber: line.batchNumber,
                    expiresAt: line.expiresAt,
                    packQuantity,
                    unitQuantity,
                    ...scope.createVersioned(batchId),
                  })
                  .returning();
                if (!createdBatch)
                  return yield* PersistenceError.make({
                    operation: "import inventory",
                    message: "Created batch could not be loaded",
                  });
                const movementId = yield* scope.nextId;
                const [movement] = yield* transaction
                  .insert(stockMovements)
                  .values({
                    ...scope.createMovement(movementId),
                    productId,
                    batchId,
                    invoiceId: null,
                    type: "stock_in",
                    packDelta: packQuantity,
                    unitDelta: unitQuantity,
                    note: "Initial batch stock",
                  })
                  .returning();
                if (!movement)
                  return yield* PersistenceError.make({
                    operation: "import inventory",
                    message: "Stock movement could not be recorded",
                  });
                yield* scope.capture([
                  {
                    entity: "batch",
                    action: "upsert",
                    entityId: createdBatch.id,
                    rowVersion: createdBatch.rowVersion,
                    row: createdBatch,
                  },
                  {
                    entity: "stockMovement",
                    action: "upsert",
                    entityId: movement.id,
                    rowVersion: 1,
                    row: movement,
                  },
                ]);
                createdBatchCount += 1;
              }
            }

            return { createdProducts: createdProductCount, createdBatches: createdBatchCount };
          }),
        { maxChangesPerOperation: IMPORT_SYNC_CHANGES_PER_OPERATION },
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof ProductNotFoundError
            ? cause
            : persistenceError("import inventory", cause),
        ),
      );
  });

  const listStockMovements = Effect.fn("OfflineStore.listStockMovements")((productId: string) =>
    database.query.stockMovements
      .findMany({
        orderBy: { createdAt: "desc" },
        where: { organizationId: workspace.organizationId, productId },
      })
      .pipe(
        Effect.map((rows) => rows.map(toStockMovement)),
        mapPersistenceError("list stock movements"),
      ),
  );

  return {
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    listProducts,
    listCompositions,
    searchProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    createBatch,
    updateBatch,
    importInventory,
    listStockMovements,
  };
};
