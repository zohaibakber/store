import type {
  Batch,
  Category,
  CreateBatchInput,
  CreateProductInput,
  Product,
  StockMovement,
  UpdateProductInput,
} from "@store/contracts";
import { batches, products, stockMovements } from "@store/db/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type { MutationContext } from "./config";
import type { StoreDatabase } from "./database";
import { PersistenceError, ProductNotFoundError, mapPersistenceError } from "./errors";
import { toBatch, toCategory, toProduct, toStockMovement } from "./models";
import { enqueueOperation } from "./outbox";

export interface ProductStore {
  readonly listCategories: Effect.Effect<ReadonlyArray<Category>, PersistenceError>;
  readonly listProducts: Effect.Effect<ReadonlyArray<Product>, PersistenceError>;
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
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    createBatch,
    listStockMovements,
  };
};
