import {
  batchHasRemainingStock,
  catalogWriteError,
  createdMutationMetadata,
  categoryHasActiveProducts,
  productHasRemainingStock,
  updatedMutationMetadata,
  type AcceptedCatalogWriteResult,
  type BatchUpsertWrite,
  type CatalogRowWrite,
  type CatalogWriteCommand,
  type CategoryUpsertWrite,
  type ProductUpsertWrite,
  type SyncEntity,
  type SyncLogChange,
  type SyncProtocolError,
} from "@store/contracts";
import { batches, categories, products, stockMovements } from "@store/db/postgres/schema";
import { and, eq, inArray, or, type Column, type SQL } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { InventoryActor } from "./model";
import { protocol, type InventoryTransaction } from "./postgres";

type CatalogWritten = {
  readonly result: AcceptedCatalogWriteResult;
  readonly changes: ReadonlyArray<SyncLogChange>;
};

type WrittenRow = {
  readonly id: string;
  readonly rowVersion: number;
};

const rowVersionMatches = (write: CatalogRowWrite, currentRowVersion: number): boolean =>
  write.expectedRowVersion === currentRowVersion;

const batchQuantitiesChanged = (
  write: BatchUpsertWrite,
  current: { readonly packQuantity: number; readonly unitQuantity: number },
): boolean =>
  write.row.packQuantity !== current.packQuantity ||
  write.row.unitQuantity !== current.unitQuantity;

const upsertChange = (entity: SyncEntity, row: WrittenRow): SyncLogChange => ({
  entity,
  action: "upsert",
  entityId: row.id,
  rowVersion: row.rowVersion,
  row,
});

const deleteChange = (
  entity: SyncEntity,
  row: WrittenRow,
  rowVersion = row.rowVersion,
): SyncLogChange => ({
  entity,
  action: "delete",
  entityId: row.id,
  rowVersion,
  row,
});

const commandIds = (command: CatalogWriteCommand) => ({
  now: () => command.occurredAt,
  operationId: () => command.commandId,
});

const insertMetadata = (actor: InventoryActor, command: CatalogWriteCommand) =>
  createdMutationMetadata({ ...actor, deviceId: command.deviceId }, commandIds(command));

const updateMetadata = (
  actor: InventoryActor,
  command: CatalogWriteCommand,
  currentRowVersion: number,
) =>
  updatedMutationMetadata(
    { userId: actor.userId, deviceId: command.deviceId, rowVersion: currentRowVersion },
    commandIds(command),
  );

type CategoryRow = typeof categories.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type BatchRow = typeof batches.$inferSelect;
type MovementValues = typeof stockMovements.$inferInsert;

type CatalogWorkingSet = {
  readonly categories: Map<string, CategoryRow>;
  readonly products: Map<string, ProductRow>;
  readonly batches: Map<string, BatchRow>;
  readonly movementIds: Set<string>;
};

type PendingMovement = {
  readonly _tag: "PendingMovement";
  readonly id: string;
};

type CatalogChange = SyncLogChange | PendingMovement;

type CatalogWriteContext = {
  readonly tx: InventoryTransaction;
  readonly actor: InventoryActor;
  readonly command: CatalogWriteCommand;
  readonly rows: CatalogWorkingSet;
  readonly movements: Array<MovementValues>;
};

const preloadWorkingSet = Effect.fn("InventoryCatalog.preloadWorkingSet")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  writes: ReadonlyArray<CatalogRowWrite>,
) {
  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  const productIds = new Set<string>();
  const productCategoryIds = new Set<string>();
  const batchIds = new Set<string>();
  const batchProductIds = new Set<string>();
  const movementIds = new Set<string>();
  for (const write of writes) {
    if (write.entity === "category") {
      categoryIds.add(write.id);
      if (write.action === "upsert") categoryNames.add(write.row.name);
      else productCategoryIds.add(write.id);
    } else if (write.entity === "product") {
      productIds.add(write.id);
      batchProductIds.add(write.id);
      if (write.action === "upsert") categoryIds.add(write.row.categoryId);
    } else {
      batchIds.add(write.id);
      if (write.action === "upsert") {
        productIds.add(write.row.productId);
        movementIds.add(write.movementId);
      }
    }
  }
  const matching = (...conditions: ReadonlyArray<SQL | undefined>) =>
    or(...conditions.filter((condition) => condition !== undefined));
  const anyOf = (column: Column, values: ReadonlySet<string>) =>
    values.size === 0 ? undefined : inArray(column, [...values]);

  const categoryRows =
    categoryIds.size + categoryNames.size === 0
      ? []
      : yield* tx
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.organizationId, organizationId),
              matching(anyOf(categories.id, categoryIds), anyOf(categories.name, categoryNames)),
            ),
          );
  const productRows =
    productIds.size + productCategoryIds.size === 0
      ? []
      : yield* tx
          .select()
          .from(products)
          .where(
            and(
              eq(products.organizationId, organizationId),
              matching(
                anyOf(products.id, productIds),
                anyOf(products.categoryId, productCategoryIds),
              ),
            ),
          );
  const batchRows =
    batchIds.size + batchProductIds.size === 0
      ? []
      : yield* tx
          .select()
          .from(batches)
          .where(
            and(
              eq(batches.organizationId, organizationId),
              matching(anyOf(batches.id, batchIds), anyOf(batches.productId, batchProductIds)),
            ),
          );
  const movementRows =
    movementIds.size === 0
      ? []
      : yield* tx
          .select({ id: stockMovements.id })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.organizationId, organizationId),
              inArray(stockMovements.id, [...movementIds]),
            ),
          );
  return {
    categories: new Map(categoryRows.map((row) => [row.id, row])),
    products: new Map(productRows.map((row) => [row.id, row])),
    batches: new Map(batchRows.map((row) => [row.id, row])),
    movementIds: new Set(movementRows.map((row) => row.id)),
  } satisfies CatalogWorkingSet;
});

const requireUniqueCategoryName = (rows: CatalogWorkingSet, id: string, name: string) => {
  for (const category of rows.categories.values()) {
    if (category.name === name && category.id !== id) {
      return protocol("ENTITY_CONFLICT", `Category name ${name} is already in use.`);
    }
  }
  return Effect.void;
};

const requireActiveCategory = (rows: CatalogWorkingSet, categoryId: string) =>
  rows.categories.has(categoryId)
    ? Effect.void
    : protocol(
        "ENTITY_RELATION_INVALID",
        `Category ${categoryId} is not available in this organization.`,
      );

const requireActiveProduct = (rows: CatalogWorkingSet, productId: string) => {
  const product = rows.products.get(productId);
  return product !== undefined && product.deletedAt === null
    ? Effect.void
    : protocol(
        "ENTITY_RELATION_INVALID",
        `Product ${productId} is not available in this organization.`,
      );
};

const queueMovement = (
  context: CatalogWriteContext,
  write: BatchUpsertWrite,
  type: "stock_in" | "adjustment",
  packDelta: number,
  unitDelta: number,
): Effect.Effect<PendingMovement, SyncProtocolError> => {
  if (context.rows.movementIds.has(write.movementId)) {
    return protocol("ENTITY_CONFLICT", `Movement ${write.movementId} is already recorded.`);
  }
  context.rows.movementIds.add(write.movementId);
  context.movements.push({
    id: write.movementId,
    productId: write.row.productId,
    batchId: write.id,
    invoiceId: null,
    type,
    packDelta,
    unitDelta,
    note: write.note,
    organizationId: context.actor.organizationId,
    actorUserId: context.actor.userId,
    deviceId: context.command.deviceId,
    operationId: context.command.commandId,
    createdAt: context.command.occurredAt,
  });
  return Effect.succeed({ _tag: "PendingMovement", id: write.movementId });
};

const insertMovements = Effect.fn("InventoryCatalog.insertMovements")(function* (
  tx: InventoryTransaction,
  movements: ReadonlyArray<MovementValues>,
) {
  if (movements.length === 0) return new Map<string, SyncLogChange>();
  const inserted = yield* tx
    .insert(stockMovements)
    .values([...movements])
    .returning();
  return new Map(
    inserted.map((movement) => [
      movement.id,
      {
        entity: "stockMovement",
        action: "upsert",
        entityId: movement.id,
        rowVersion: 1,
        row: movement,
      } satisfies SyncLogChange,
    ]),
  );
});

const writeCategoryUpsert = Effect.fn("InventoryCatalog.writeCategoryUpsert")(function* (
  context: CatalogWriteContext,
  write: CategoryUpsertWrite,
) {
  const { tx, actor, command, rows } = context;
  const existing = rows.categories.get(write.id);
  if (write.expectedRowVersion === null) {
    if (existing) {
      return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} already exists.`);
    }
    yield* requireUniqueCategoryName(rows, write.id, write.row.name);
    const [created] = yield* tx
      .insert(categories)
      .values({ id: write.id, ...write.row, ...insertMetadata(actor, command) })
      .returning();
    if (!created) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The category could not be created.");
    }
    rows.categories.set(created.id, created);
    return [upsertChange("category", created)];
  }
  if (!existing) {
    return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
  }
  yield* requireUniqueCategoryName(rows, write.id, write.row.name);
  const [updated] = yield* tx
    .update(categories)
    .set({ ...write.row, ...updateMetadata(actor, command, existing.rowVersion) })
    .where(and(eq(categories.organizationId, actor.organizationId), eq(categories.id, write.id)))
    .returning();
  if (!updated) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The category could not be updated.");
  }
  rows.categories.set(updated.id, updated);
  return [upsertChange("category", updated)];
});

const writeProductUpsert = Effect.fn("InventoryCatalog.writeProductUpsert")(function* (
  context: CatalogWriteContext,
  write: ProductUpsertWrite,
) {
  const { tx, actor, command, rows } = context;
  const existing = rows.products.get(write.id);
  if (write.expectedRowVersion === null) {
    if (existing) {
      return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} already exists.`);
    }
    yield* requireActiveCategory(rows, write.row.categoryId);
    const [created] = yield* tx
      .insert(products)
      .values({ id: write.id, ...write.row, ...insertMetadata(actor, command) })
      .returning();
    if (!created) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The product could not be created.");
    }
    rows.products.set(created.id, created);
    return [upsertChange("product", created)];
  }
  if (!existing || existing.deletedAt !== null) {
    return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
  }
  if (write.row.unitsPerPack !== existing.unitsPerPack) {
    if (!rowVersionMatches(write, existing.rowVersion)) {
      return yield* protocol(
        "ENTITY_CONFLICT",
        `Product ${write.id} changed since units per pack was read.`,
      );
    }
    if (productHasRemainingStock(rows.batches.values(), write.id)) {
      return yield* protocol("ENTITY_CONFLICT", catalogWriteError.unitsPerPackWithStock);
    }
  }
  if (write.row.categoryId !== existing.categoryId) {
    yield* requireActiveCategory(rows, write.row.categoryId);
  }
  const [updated] = yield* tx
    .update(products)
    .set({ ...write.row, ...updateMetadata(actor, command, existing.rowVersion) })
    .where(and(eq(products.organizationId, actor.organizationId), eq(products.id, write.id)))
    .returning();
  if (!updated) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The product could not be updated.");
  }
  rows.products.set(updated.id, updated);
  return [upsertChange("product", updated)];
});

const writeBatchUpsert = Effect.fn("InventoryCatalog.writeBatchUpsert")(function* (
  context: CatalogWriteContext,
  write: BatchUpsertWrite,
) {
  const { tx, actor, command, rows } = context;
  const existing = rows.batches.get(write.id);
  yield* requireActiveProduct(rows, write.row.productId);
  if (write.expectedRowVersion === null) {
    if (existing) {
      return yield* protocol("ENTITY_CONFLICT", `Batch ${write.id} already exists.`);
    }
    const [created] = yield* tx
      .insert(batches)
      .values({ id: write.id, ...write.row, ...insertMetadata(actor, command) })
      .returning();
    if (!created) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The batch could not be created.");
    }
    rows.batches.set(created.id, created);
    const changes: Array<CatalogChange> = [upsertChange("batch", created)];
    if (batchHasRemainingStock(write.row)) {
      changes.push(
        yield* queueMovement(
          context,
          write,
          "stock_in",
          write.row.packQuantity,
          write.row.unitQuantity,
        ),
      );
    }
    return changes;
  }
  if (!existing || existing.deletedAt !== null) {
    return yield* protocol("ENTITY_CONFLICT", `Batch ${write.id} is no longer available.`);
  }
  if (!rowVersionMatches(write, existing.rowVersion)) {
    return yield* protocol("ENTITY_CONFLICT", `Batch ${write.id} changed since it was read.`);
  }
  const [updated] = yield* tx
    .update(batches)
    .set({ ...write.row, ...updateMetadata(actor, command, existing.rowVersion) })
    .where(and(eq(batches.organizationId, actor.organizationId), eq(batches.id, write.id)))
    .returning();
  if (!updated) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The batch could not be updated.");
  }
  rows.batches.set(updated.id, updated);
  const changes: Array<CatalogChange> = [upsertChange("batch", updated)];
  if (batchQuantitiesChanged(write, existing)) {
    changes.push(
      yield* queueMovement(
        context,
        write,
        "adjustment",
        write.row.packQuantity - existing.packQuantity,
        write.row.unitQuantity - existing.unitQuantity,
      ),
    );
  }
  return changes;
});

const writeCategoryDelete = Effect.fn("InventoryCatalog.writeCategoryDelete")(function* (
  context: CatalogWriteContext,
  write: CatalogRowWrite,
) {
  const { tx, actor, rows } = context;
  const existing = rows.categories.get(write.id);
  if (!existing) {
    return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
  }
  if (!rowVersionMatches(write, existing.rowVersion)) {
    return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} changed since it was read.`);
  }
  if (categoryHasActiveProducts(rows.products.values(), write.id)) {
    return yield* protocol("ENTITY_CONFLICT", catalogWriteError.categoryHasProducts);
  }
  const [deleted] = yield* tx
    .delete(categories)
    .where(and(eq(categories.organizationId, actor.organizationId), eq(categories.id, write.id)))
    .returning();
  if (!deleted) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The category could not be deleted.");
  }
  rows.categories.delete(deleted.id);
  return [deleteChange("category", deleted, deleted.rowVersion + 1)];
});

const writeProductDelete = Effect.fn("InventoryCatalog.writeProductDelete")(function* (
  context: CatalogWriteContext,
  write: CatalogRowWrite,
) {
  const { tx, actor, command, rows } = context;
  const existing = rows.products.get(write.id);
  if (!existing || existing.deletedAt !== null) {
    return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
  }
  if (!rowVersionMatches(write, existing.rowVersion)) {
    return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} changed since it was read.`);
  }
  if (productHasRemainingStock(rows.batches.values(), write.id)) {
    return yield* protocol("ENTITY_CONFLICT", catalogWriteError.productHasStock);
  }
  const [deleted] = yield* tx
    .update(products)
    .set({
      deletedAt: command.occurredAt,
      ...updateMetadata(actor, command, existing.rowVersion),
    })
    .where(and(eq(products.organizationId, actor.organizationId), eq(products.id, write.id)))
    .returning();
  if (!deleted) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The product could not be deleted.");
  }
  rows.products.set(deleted.id, deleted);
  return [deleteChange("product", deleted)];
});

const writeBatchDelete = Effect.fn("InventoryCatalog.writeBatchDelete")(function* (
  context: CatalogWriteContext,
  write: CatalogRowWrite,
) {
  const { tx, actor, command, rows } = context;
  const existing = rows.batches.get(write.id);
  if (!existing || existing.deletedAt !== null) {
    return yield* protocol("ENTITY_CONFLICT", `Batch ${write.id} is no longer available.`);
  }
  if (!rowVersionMatches(write, existing.rowVersion)) {
    return yield* protocol("ENTITY_CONFLICT", `Batch ${write.id} changed since it was read.`);
  }
  if (batchHasRemainingStock(existing)) {
    return yield* protocol("ENTITY_CONFLICT", catalogWriteError.batchHasStock);
  }
  const [deleted] = yield* tx
    .update(batches)
    .set({
      deletedAt: command.occurredAt,
      ...updateMetadata(actor, command, existing.rowVersion),
    })
    .where(and(eq(batches.organizationId, actor.organizationId), eq(batches.id, write.id)))
    .returning();
  if (!deleted) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The batch could not be deleted.");
  }
  rows.batches.set(deleted.id, deleted);
  return [deleteChange("batch", deleted)];
});

const writeRow = (context: CatalogWriteContext, write: CatalogRowWrite) => {
  if (write.action === "delete") {
    if (write.entity === "category") return writeCategoryDelete(context, write);
    if (write.entity === "product") return writeProductDelete(context, write);
    return writeBatchDelete(context, write);
  }
  if (write.entity === "category") return writeCategoryUpsert(context, write);
  if (write.entity === "product") return writeProductUpsert(context, write);
  return writeBatchUpsert(context, write);
};

const isPendingMovement = (change: CatalogChange): change is PendingMovement =>
  "_tag" in change && change._tag === "PendingMovement";

export const applyCatalogWrite = Effect.fn("InventoryCommands.applyCatalogWrite")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
) {
  const context: CatalogWriteContext = {
    tx,
    actor,
    command,
    rows: yield* preloadWorkingSet(tx, actor.organizationId, command.writes),
    movements: [],
  };
  const pending: Array<CatalogChange> = [];
  for (const write of command.writes) {
    pending.push(...(yield* writeRow(context, write)));
  }
  const movements = yield* insertMovements(tx, context.movements);
  const changes: Array<SyncLogChange> = [];
  for (const change of pending) {
    if (!isPendingMovement(change)) {
      changes.push(change);
      continue;
    }
    const movement = movements.get(change.id);
    if (!movement) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The stock movement could not be recorded.");
    }
    changes.push(movement);
  }
  return {
    result: { _tag: "catalogWrite", rowsWritten: command.writes.length },
    changes,
  } satisfies CatalogWritten;
});
