import type {
  Batch,
  Category,
  CreateBatchInput,
  CreateProductInput,
  ImportInventoryInput,
  ImportInventoryResult,
  Product,
  SearchProductsInput,
  StockMovement,
  SyncEntityChange,
  UpdateProductInput,
} from "@store/contracts";
import { batches, products, stockMovements } from "@store/db/local/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type { MutationContext } from "./config";
import type { StoreDatabase } from "./database";
import {
  PersistenceError,
  ProductNotFoundError,
  mapPersistenceError,
  persistenceError,
} from "./errors";
import { toBatch, toCategory, toProduct, toStockMovement } from "./models";
import { enqueueOperation } from "./outbox";

export interface ProductStore {
  readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
  readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
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
  readonly importInventory: (
    input: ImportInventoryInput,
  ) => Effect.Effect<ImportInventoryResult, PersistenceError | ProductNotFoundError>;
  readonly listStockMovements: (
    productId: string,
  ) => Effect.Effect<ReadonlyArray<StockMovement>, PersistenceError>;
}

const queryConfig = <const Config>(config: Config) => config;

const productRelations = queryConfig({
  category: true,
  batches: {
    where: { deletedAt: { isNull: true } },
    orderBy: { expiresAt: "asc", createdAt: "asc" },
  },
});

export const makeProductStore = (
  database: StoreDatabase,
  mutationContext: () => MutationContext,
  signalSync: Effect.Effect<void>,
): ProductStore => {
  const findProduct = (organizationId: string, id: string) =>
    database.query.products.findFirst({
      where: { organizationId, id, deletedAt: { isNull: true } },
      with: productRelations,
    });

  const listCategories = Effect.suspend(() => {
    const actor = mutationContext();
    return database.query.categories
      .findMany({
        orderBy: { name: "asc" },
        where: { organizationId: actor.organizationId, deletedAt: { isNull: true } },
      })
      .pipe(
        Effect.map((rows) => rows.map(toCategory)),
        mapPersistenceError("list categories"),
      );
  });

  const listProducts = Effect.suspend(() => {
    const actor = mutationContext();
    return database.query.products
      .findMany({
        orderBy: { name: "asc" },
        where: { organizationId: actor.organizationId, deletedAt: { isNull: true } },
        with: productRelations,
      })
      .pipe(
        Effect.map((rows) => rows.map(toProduct)),
        mapPersistenceError("list products"),
      );
  });

  // Typo- and phonetic-tolerant search over product name and composition. Pure
  // trigram similarity misses cases like "pendal" -> "panadol" (they share
  // almost no trigrams), so the ranking blends trigram similarity, prefix match,
  // Levenshtein distance, and phonetics (dmetaphone/soundex) — phonetics do the
  // heavy lifting for that class of misspelling. Runs entirely on the local
  // PGlite database against the pg_trgm/fuzzystrmatch/unaccent extensions.
  const searchProducts = (input: SearchProductsInput) =>
    Effect.suspend(() => {
      const actor = mutationContext();
      const raw = input.query.trim();
      if (raw.length === 0) return Effect.succeed<ReadonlyArray<Product>>([]);
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

      const normalized = sql`lower(unaccent(${raw}))`;
      const nameNorm = sql`lower(unaccent(${products.name}))`;
      const compNorm = sql`lower(unaccent(coalesce(${products.composition}, '')))`;
      const score = sql<number>`(
          0.45 * similarity(${nameNorm}, ${normalized})
        + 0.25 * word_similarity(${normalized}, ${compNorm})
        + (CASE WHEN ${nameNorm} LIKE ${normalized} || '%' THEN 0.30 ELSE 0 END)
        + (CASE WHEN dmetaphone(${products.name}) = dmetaphone(${raw}) THEN 0.40 ELSE 0 END)
        + (CASE WHEN soundex(${products.name}) = soundex(${raw}) THEN 0.25 ELSE 0 END)
        + (CASE WHEN levenshtein(${nameNorm}, ${normalized}) <= 2 THEN 0.20 ELSE 0 END)
      )`;
      const matches = sql`(
           similarity(${nameNorm}, ${normalized}) > 0.15
        OR word_similarity(${normalized}, ${compNorm}) > 0.4
        OR dmetaphone(${products.name}) = dmetaphone(${raw})
        OR soundex(${products.name}) = soundex(${raw})
        OR levenshtein(${nameNorm}, ${normalized}) <= 2
        OR ${nameNorm} LIKE '%' || ${normalized} || '%'
      )`;

      return database
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.organizationId, actor.organizationId),
            isNull(products.deletedAt),
            matches,
          ),
        )
        .orderBy(sql`${score} DESC`)
        .limit(limit)
        .pipe(
          Effect.flatMap((ranked) => {
            const ids = ranked.map((row) => row.id);
            if (ids.length === 0) return Effect.succeed<ReadonlyArray<Product>>([]);
            return database.query.products
              .findMany({
                where: {
                  organizationId: actor.organizationId,
                  id: { in: ids },
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
    const actor = mutationContext();
    const row = yield* findProduct(actor.organizationId, id).pipe(
      mapPersistenceError("find product"),
    );
    if (!row) return yield* ProductNotFoundError.make({ id });
    return toProduct(row);
  });

  const createProduct = Effect.fn("OfflineStore.createProduct")(function* (
    input: CreateProductInput,
  ) {
    const actor = mutationContext();
    const occurredAt = Date.now();
    const operationId = crypto.randomUUID();
    const id = crypto.randomUUID();
    yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const [row] = yield* transaction
            .insert(products)
            .values({
              ...input,
              id,
              name: input.name.trim(),
              organizationId: actor.organizationId,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              rowVersion: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            })
            .returning();
          if (!row)
            return yield* PersistenceError.make({
              operation: "create product",
              message: "Created product could not be loaded",
            });
          yield* enqueueOperation(transaction, actor, operationId, occurredAt, [
            {
              entity: "product",
              action: "upsert",
              entityId: row.id,
              rowVersion: row.rowVersion,
              row,
            },
          ]);
        }),
      )
      .pipe(mapPersistenceError("create product"));
    yield* signalSync;
    const row = yield* findProduct(actor.organizationId, id).pipe(
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
    const actor = mutationContext();
    const { id, ...changes } = input;
    const occurredAt = Date.now();
    const operationId = crypto.randomUUID();
    const updated = yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.products.findFirst({
            where: { organizationId: actor.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          const [row] = yield* transaction
            .update(products)
            .set({
              ...changes,
              name: changes.name.trim(),
              updatedAt: occurredAt,
              updatedByUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              rowVersion: current.rowVersion + 1,
            })
            .where(and(eq(products.organizationId, actor.organizationId), eq(products.id, id)))
            .returning();
          if (!row) return undefined;
          yield* enqueueOperation(transaction, actor, operationId, occurredAt, [
            {
              entity: "product",
              action: "upsert",
              entityId: row.id,
              rowVersion: row.rowVersion,
              row,
            },
          ]);
          return row;
        }),
      )
      .pipe(mapPersistenceError("update product"));
    if (!updated) return yield* ProductNotFoundError.make({ id });
    yield* signalSync;
    const loaded = yield* findProduct(actor.organizationId, id).pipe(
      mapPersistenceError("load updated product"),
    );
    if (!loaded) return yield* ProductNotFoundError.make({ id });
    return toProduct(loaded);
  });

  const deleteProduct = Effect.fn("OfflineStore.deleteProduct")(function* (id: string) {
    const actor = mutationContext();
    const occurredAt = Date.now();
    const operationId = crypto.randomUUID();
    const deleted = yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.products.findFirst({
            where: { organizationId: actor.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          const [row] = yield* transaction
            .update(products)
            .set({
              deletedAt: occurredAt,
              updatedAt: occurredAt,
              updatedByUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              rowVersion: current.rowVersion + 1,
            })
            .where(and(eq(products.organizationId, actor.organizationId), eq(products.id, id)))
            .returning();
          if (!row) return undefined;
          yield* enqueueOperation(transaction, actor, operationId, occurredAt, [
            {
              entity: "product",
              action: "delete",
              entityId: row.id,
              rowVersion: row.rowVersion,
              row,
            },
          ]);
          return row;
        }),
      )
      .pipe(mapPersistenceError("delete product"));
    if (!deleted) return yield* ProductNotFoundError.make({ id });
    yield* signalSync;
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
    const actor = mutationContext();
    const product = yield* findProduct(actor.organizationId, input.productId).pipe(
      mapPersistenceError("find product"),
    );
    if (!product) return yield* ProductNotFoundError.make({ id: input.productId });
    const occurredAt = Date.now();
    const operationId = crypto.randomUUID();
    const row = yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID();
          const [created] = yield* transaction
            .insert(batches)
            .values({
              ...input,
              id,
              packQuantity,
              unitQuantity,
              organizationId: actor.organizationId,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              rowVersion: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            })
            .returning();
          if (!created)
            return yield* PersistenceError.make({
              operation: "create batch",
              message: "Created batch could not be loaded",
            });
          const [movement] = yield* transaction
            .insert(stockMovements)
            .values({
              id: crypto.randomUUID(),
              productId: input.productId,
              batchId: id,
              invoiceId: null,
              type: "stock_in",
              packDelta: packQuantity,
              unitDelta: unitQuantity,
              note: "Initial batch stock",
              organizationId: actor.organizationId,
              actorUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              createdAt: occurredAt,
            })
            .returning();
          if (!movement)
            return yield* PersistenceError.make({
              operation: "create batch",
              message: "Stock movement could not be recorded",
            });
          yield* enqueueOperation(transaction, actor, operationId, occurredAt, [
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
    yield* signalSync;
    return toBatch(row);
  });

  // Applies an entire invoice-upload import as one local transaction and one
  // outbox operation: every product resolution, batch insert, and stock
  // movement either all commit together or none do, so a retry after a local
  // failure is safe. Products are matched to an existing line by normalized
  // name, or created once and reused for duplicate names within the same
  // import.
  const importInventory = Effect.fn("OfflineStore.importInventory")(function* (
    input: ImportInventoryInput,
  ) {
    const actor = mutationContext();
    const occurredAt = Date.now();
    const operationId = crypto.randomUUID();

    const result = yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const productChanges: SyncEntityChange[] = [];
          const batchChanges: SyncEntityChange[] = [];
          const movementChanges: SyncEntityChange[] = [];
          let createdProductCount = 0;
          let createdBatchCount = 0;

          const existingProducts = yield* transaction.query.products.findMany({
            where: { organizationId: actor.organizationId, deletedAt: { isNull: true } },
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

            let productId: string;
            if (line.productId) {
              if (!knownProductIds.has(line.productId))
                return yield* ProductNotFoundError.make({ id: line.productId });
              productId = line.productId;
            } else {
              const key = line.name.trim().toLocaleLowerCase();
              const existingId = productIdsByName.get(key);
              if (existingId) {
                productId = existingId;
              } else {
                const id = crypto.randomUUID();
                const [created] = yield* transaction
                  .insert(products)
                  .values({
                    id,
                    name: line.name.trim(),
                    categoryId: input.categoryId,
                    aisle: null,
                    composition: null,
                    strength: null,
                    unitsPerPack: line.unitsPerPack,
                    packPrice: line.packPrice,
                    unitPrice: null,
                    organizationId: actor.organizationId,
                    createdByUserId: actor.userId,
                    updatedByUserId: actor.userId,
                    deviceId: actor.deviceId,
                    operationId,
                    rowVersion: 1,
                    createdAt: occurredAt,
                    updatedAt: occurredAt,
                  })
                  .returning();
                if (!created)
                  return yield* PersistenceError.make({
                    operation: "import inventory",
                    message: "Created product could not be loaded",
                  });
                productChanges.push({
                  entity: "product",
                  action: "upsert",
                  entityId: created.id,
                  rowVersion: created.rowVersion,
                  row: created,
                });
                productIdsByName.set(key, created.id);
                knownProductIds.add(created.id);
                createdProductCount += 1;
                productId = created.id;
              }
            }

            if (packQuantity + unitQuantity > 0) {
              const batchId = crypto.randomUUID();
              const [createdBatch] = yield* transaction
                .insert(batches)
                .values({
                  id: batchId,
                  productId,
                  batchNumber: line.batchNumber,
                  expiresAt: line.expiresAt,
                  packQuantity,
                  unitQuantity,
                  organizationId: actor.organizationId,
                  createdByUserId: actor.userId,
                  updatedByUserId: actor.userId,
                  deviceId: actor.deviceId,
                  operationId,
                  rowVersion: 1,
                  createdAt: occurredAt,
                  updatedAt: occurredAt,
                })
                .returning();
              if (!createdBatch)
                return yield* PersistenceError.make({
                  operation: "import inventory",
                  message: "Created batch could not be loaded",
                });
              const [movement] = yield* transaction
                .insert(stockMovements)
                .values({
                  id: crypto.randomUUID(),
                  productId,
                  batchId,
                  invoiceId: null,
                  type: "stock_in",
                  packDelta: packQuantity,
                  unitDelta: unitQuantity,
                  note: "Initial batch stock",
                  organizationId: actor.organizationId,
                  actorUserId: actor.userId,
                  deviceId: actor.deviceId,
                  operationId,
                  createdAt: occurredAt,
                })
                .returning();
              if (!movement)
                return yield* PersistenceError.make({
                  operation: "import inventory",
                  message: "Stock movement could not be recorded",
                });
              batchChanges.push({
                entity: "batch",
                action: "upsert",
                entityId: createdBatch.id,
                rowVersion: createdBatch.rowVersion,
                row: createdBatch,
              });
              movementChanges.push({
                entity: "stockMovement",
                action: "upsert",
                entityId: movement.id,
                rowVersion: 1,
                row: movement,
              });
              createdBatchCount += 1;
            }
          }

          yield* enqueueOperation(transaction, actor, operationId, occurredAt, [
            ...productChanges,
            ...batchChanges,
            ...movementChanges,
          ]);
          return { createdProducts: createdProductCount, createdBatches: createdBatchCount };
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof ProductNotFoundError
            ? cause
            : persistenceError("import inventory", cause),
        ),
      );
    yield* signalSync;
    return result;
  });

  const listStockMovements = (productId: string) =>
    Effect.suspend(() => {
      const actor = mutationContext();
      return database.query.stockMovements
        .findMany({
          orderBy: { createdAt: "desc" },
          where: { organizationId: actor.organizationId, productId },
        })
        .pipe(
          Effect.map((rows) => rows.map(toStockMovement)),
          mapPersistenceError("list stock movements"),
        );
    });

  return {
    listCategories,
    listProducts,
    searchProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    createBatch,
    importInventory,
    listStockMovements,
  };
};
