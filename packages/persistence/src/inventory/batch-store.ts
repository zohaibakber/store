import type {
  Batch,
  CreateBatchInput,
  ImportInventoryInput,
  ImportInventoryResult,
  StockMovement,
  UpdateBatchInput,
} from "@store/contracts";
import { decodeBatchId, decodeProductId } from "@store/contracts";
import { batches, products, stockMovements } from "@store/db/local/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { Workspace } from "../config";
import type { StoreDatabase } from "../database/client";
import {
  BatchNotFoundError,
  PersistenceError,
  ProductNotFoundError,
  mapPersistenceError,
  persistenceError,
} from "../errors";
import { toBatch, toStockMovement, type ProductWithRelations } from "./models";
import type { InventoryMutation } from "./mutation";

export interface BatchStore {
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

const IMPORT_SYNC_CHANGES_PER_OPERATION = 200;

export const isNonNegativeInteger = (quantity: number) =>
  Number.isInteger(quantity) && quantity >= 0;

/** Create requires some stock; both sides must be non-negative whole numbers. */
export const isValidCreateBatchQuantity = (packQuantity: number, unitQuantity: number) =>
  isNonNegativeInteger(packQuantity) &&
  isNonNegativeInteger(unitQuantity) &&
  packQuantity + unitQuantity >= 1;

/** Update/import allow zero; only reject when a provided quantity is invalid. */
export const isInvalidOptionalQuantity = (quantity: number | undefined) =>
  quantity !== undefined && !isNonNegativeInteger(quantity);

export type FindProduct = (
  organizationId: string,
  id: string,
) => Effect.Effect<ProductWithRelations | undefined, PersistenceError>;

export const makeBatchStore = (
  database: StoreDatabase,
  workspace: Workspace,
  mutation: InventoryMutation,
  findProduct: FindProduct,
): BatchStore => {
  const createBatch = Effect.fn("OfflineStore.createBatch")(function* (input: CreateBatchInput) {
    const packQuantity = input.packQuantity ?? 0;
    const unitQuantity = input.unitQuantity ?? 0;
    if (!isValidCreateBatchQuantity(packQuantity, unitQuantity))
      return yield* PersistenceError.make({
        operation: "create batch",
        message: "Pack and unit quantities must be non-negative whole numbers with some stock",
      });
    const product = yield* findProduct(workspace.organizationId, input.productId);
    if (!product) return yield* ProductNotFoundError.make({ id: decodeProductId(input.productId) });
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

    if (
      isInvalidOptionalQuantity(input.packQuantity) ||
      isInvalidOptionalQuantity(input.unitQuantity)
    )
      return yield* PersistenceError.make({
        operation: "update batch",
        message: "Pack and unit quantities must be non-negative whole numbers",
      });

    const updated = yield* mutation
      .run("update batch", (transaction, scope) =>
        Effect.gen(function* () {
          const current = yield* transaction.query.batches.findFirst({
            where: { organizationId: scope.organizationId, id, deletedAt: { isNull: true } },
          });
          if (!current) return undefined;
          const packQuantity = input.packQuantity ?? current.packQuantity;
          const unitQuantity = input.unitQuantity ?? current.unitQuantity;
          const packDelta = packQuantity - current.packQuantity;
          const unitDelta = unitQuantity - current.unitQuantity;

          const [row] = yield* transaction
            .update(batches)
            .set({
              batchNumber,
              expiresAt,
              packQuantity,
              unitQuantity,
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

          // A corrected count is stock moving, so it leaves the same trail a
          // sale or a delivery does rather than silently changing the number.
          if (packDelta !== 0 || unitDelta !== 0) {
            const movementId = yield* scope.nextId;
            const [movement] = yield* transaction
              .insert(stockMovements)
              .values({
                ...scope.createMovement(movementId),
                productId: current.productId,
                batchId: current.id,
                invoiceId: null,
                type: "adjustment",
                packDelta,
                unitDelta,
                note: "Stock corrected",
              })
              .returning();
            if (!movement)
              return yield* PersistenceError.make({
                operation: "update batch",
                message: "Stock movement could not be recorded",
              });
            yield* scope.capture({
              entity: "stockMovement",
              action: "upsert",
              entityId: movement.id,
              rowVersion: 1,
              row: movement,
            });
          }
          return row;
        }),
      )
      .pipe(mapPersistenceError("update batch"));
    if (!updated) return yield* BatchNotFoundError.make({ id: decodeBatchId(id) });
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
              if (!isNonNegativeInteger(packQuantity) || !isNonNegativeInteger(unitQuantity))
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
                  return yield* ProductNotFoundError.make({ id: decodeProductId(line.productId) });
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
    createBatch,
    updateBatch,
    importInventory,
    listStockMovements,
  };
};
