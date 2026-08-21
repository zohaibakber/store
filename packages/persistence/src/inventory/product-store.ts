import type {
  Category,
  CreateCategoryInput,
  CreateProductInput,
  Product,
  ProductSuggestions,
  SearchProductsInput,
  UpdateCategoryInput,
  UpdateProductInput,
} from "@store/contracts";
import { decodeCategoryId, decodeProductId } from "@store/contracts";
import { batches, categories, products } from "@store/db/local/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { Workspace } from "../config";
import type { StoreDatabase } from "../database/client";
import {
  CategoryNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  mapPersistenceError,
} from "../errors";
import { makeBatchStore, type BatchStore } from "./batch-store";
import {
  byEarliestExpiry,
  toCategory,
  toProduct,
  type ProductRow,
  type ProductWithRelations,
} from "./models";
import type { InventoryMutation } from "./mutation";
import { prepare as prepareProduct, rank as rankProducts } from "./product-ranking";

export interface ProductStore extends BatchStore {
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
  readonly listProductSuggestions: Effect.Effect<ProductSuggestions, PersistenceError>;
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
}

export const makeProductStore = (
  database: StoreDatabase,
  workspace: Workspace,
  mutation: InventoryMutation,
): ProductStore => {
  // Drizzle's relational query emits one large correlated JSON query. The
  // browser libSQL worker fails that query for the real Tabaaq catalog, while
  // the same data works with ordinary selects. Hydrate the two small relations
  // explicitly so desktop and web execute the same portable SQLite queries.
  const hydrateProducts = (
    productRows: ReadonlyArray<ProductRow>,
  ): Effect.Effect<ReadonlyArray<ProductWithRelations>, PersistenceError> => {
    if (productRows.length === 0) return Effect.succeed([]);

    return Effect.gen(function* () {
      const productIds = productRows.map((product) => product.id);
      const categoryIds = Array.from(new Set(productRows.map((product) => product.categoryId)));
      const categoryRows = yield* database
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.organizationId, workspace.organizationId),
            inArray(categories.id, categoryIds),
          ),
        );
      const batchRows = yield* database
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, workspace.organizationId),
            inArray(batches.productId, productIds),
            isNull(batches.deletedAt),
          ),
        );

      const categoryById = new Map(categoryRows.map((category) => [category.id, category]));
      const batchesByProductId = new Map<string, typeof batchRows>();
      for (const batch of batchRows) {
        const grouped = batchesByProductId.get(batch.productId) ?? [];
        grouped.push(batch);
        batchesByProductId.set(batch.productId, grouped);
      }

      return yield* Effect.forEach(productRows, (product) => {
        const category = categoryById.get(product.categoryId);
        if (!category)
          return PersistenceError.make({
            operation: "load product relations",
            message: `Product ${product.id} refers to missing category ${product.categoryId}`,
          });
        return Effect.succeed({
          ...product,
          category,
          batches: (batchesByProductId.get(product.id) ?? []).sort(byEarliestExpiry),
        });
      });
    }).pipe(mapPersistenceError("load product relations"));
  };

  const findProduct = (organizationId: string, id: string) =>
    Effect.gen(function* () {
      const [row] = yield* database
        .select()
        .from(products)
        .where(
          and(
            eq(products.organizationId, organizationId),
            eq(products.id, id),
            isNull(products.deletedAt),
          ),
        )
        .limit(1);
      if (!row) return undefined;
      const [hydrated] = yield* hydrateProducts([row]);
      return hydrated;
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
    if (!deleted) return yield* CategoryNotFoundError.make({ id: decodeCategoryId(id) });
  });

  const listProducts = database
    .select()
    .from(products)
    .where(and(eq(products.organizationId, workspace.organizationId), isNull(products.deletedAt)))
    .orderBy(asc(products.name))
    .pipe(
      Effect.flatMap(hydrateProducts),
      Effect.map((rows) => rows.map(toProduct)),
      mapPersistenceError("list products"),
    );

  const distinctSorted = (values: ReadonlyArray<string | null>) =>
    // SAFETY: filter(Boolean) removes the only non-string member produced by the map.
    Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as Array<string>)).sort(
      (a, b) => a.localeCompare(b),
    );

  const listProductSuggestions = database
    .selectDistinct({
      name: products.name,
      aisle: products.aisle,
      composition: products.composition,
    })
    .from(products)
    .where(and(eq(products.organizationId, workspace.organizationId), isNull(products.deletedAt)))
    .pipe(
      Effect.map((rows) => ({
        names: distinctSorted(rows.map((row) => row.name)),
        aisles: distinctSorted(rows.map((row) => row.aisle)),
        compositions: distinctSorted(rows.map((row) => row.composition)),
      })),
      mapPersistenceError("list product suggestions"),
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
          return database
            .select()
            .from(products)
            .where(
              and(
                eq(products.organizationId, workspace.organizationId),
                inArray(products.id, ids),
                eq(products.visible, true),
                isNull(products.deletedAt),
              ),
            )
            .pipe(
              Effect.flatMap(hydrateProducts),
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
    if (!row) return yield* ProductNotFoundError.make({ id: decodeProductId(id) });
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
    if (!updated) return yield* ProductNotFoundError.make({ id: decodeProductId(id) });
    const loaded = yield* findProduct(workspace.organizationId, id).pipe(
      mapPersistenceError("load updated product"),
    );
    if (!loaded) return yield* ProductNotFoundError.make({ id: decodeProductId(id) });
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
    if (!deleted) return yield* ProductNotFoundError.make({ id: decodeProductId(id) });
  });

  const batchStore = makeBatchStore(database, workspace, mutation, (organizationId, id) =>
    findProduct(organizationId, id).pipe(mapPersistenceError("find product")),
  );

  return {
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    listProducts,
    listProductSuggestions,
    searchProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    ...batchStore,
  };
};
