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
} from "@store/contracts";
import { batches, categories, products, stockMovements } from "@store/db/postgres/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
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

const readCategory = Effect.fn("InventoryCatalog.readCategory")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  id: string,
) {
  const [row] = yield* tx
    .select()
    .from(categories)
    .where(and(eq(categories.organizationId, organizationId), eq(categories.id, id)))
    .limit(1);
  return row;
});

const requireUniqueCategoryName = Effect.fn("InventoryCatalog.requireUniqueCategoryName")(
  function* (tx: InventoryTransaction, organizationId: string, id: string, name: string) {
    const [row] = yield* tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.organizationId, organizationId),
          eq(categories.name, name),
          ne(categories.id, id),
        ),
      )
      .limit(1);
    if (row) {
      return yield* protocol("ENTITY_CONFLICT", `Category name ${name} is already in use.`);
    }
  },
);

const readProduct = Effect.fn("InventoryCatalog.readProduct")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  id: string,
) {
  const [row] = yield* tx
    .select()
    .from(products)
    .where(and(eq(products.organizationId, organizationId), eq(products.id, id)))
    .limit(1);
  return row;
});

const readBatch = Effect.fn("InventoryCatalog.readBatch")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  id: string,
) {
  const [row] = yield* tx
    .select()
    .from(batches)
    .where(and(eq(batches.organizationId, organizationId), eq(batches.id, id)))
    .limit(1);
  return row;
});

const requireActiveCategory = Effect.fn("InventoryCatalog.requireActiveCategory")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  categoryId: string,
) {
  const row = yield* readCategory(tx, organizationId, categoryId);
  if (!row) {
    return yield* protocol(
      "ENTITY_RELATION_INVALID",
      `Category ${categoryId} is not available in this organization.`,
    );
  }
  return row;
});

const requireActiveProduct = Effect.fn("InventoryCatalog.requireActiveProduct")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  productId: string,
) {
  const [row] = yield* tx
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.organizationId, organizationId),
        eq(products.id, productId),
        isNull(products.deletedAt),
      ),
    )
    .limit(1);
  if (!row) {
    return yield* protocol(
      "ENTITY_RELATION_INVALID",
      `Product ${productId} is not available in this organization.`,
    );
  }
  return row;
});

const readProductBatches = Effect.fn("InventoryCatalog.readProductBatches")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  productId: string,
) {
  return yield* tx
    .select({
      productId: batches.productId,
      deletedAt: batches.deletedAt,
      packQuantity: batches.packQuantity,
      unitQuantity: batches.unitQuantity,
    })
    .from(batches)
    .where(and(eq(batches.organizationId, organizationId), eq(batches.productId, productId)));
});

const readCategoryProducts = Effect.fn("InventoryCatalog.readCategoryProducts")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  categoryId: string,
) {
  return yield* tx
    .select({ categoryId: products.categoryId, deletedAt: products.deletedAt })
    .from(products)
    .where(and(eq(products.organizationId, organizationId), eq(products.categoryId, categoryId)));
});

const requireUnusedMovementId = Effect.fn("InventoryCatalog.requireUnusedMovementId")(function* (
  tx: InventoryTransaction,
  organizationId: string,
  movementId: string,
) {
  const [row] = yield* tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(
      and(eq(stockMovements.organizationId, organizationId), eq(stockMovements.id, movementId)),
    )
    .limit(1);
  if (row) {
    return yield* protocol("ENTITY_CONFLICT", `Movement ${movementId} is already recorded.`);
  }
});

const writeMovement = Effect.fn("InventoryCatalog.writeMovement")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: BatchUpsertWrite,
  type: "stock_in" | "adjustment",
  packDelta: number,
  unitDelta: number,
) {
  yield* requireUnusedMovementId(tx, actor.organizationId, write.movementId);
  const [movement] = yield* tx
    .insert(stockMovements)
    .values({
      id: write.movementId,
      productId: write.row.productId,
      batchId: write.id,
      invoiceId: null,
      type,
      packDelta,
      unitDelta,
      note: write.note,
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      deviceId: command.deviceId,
      operationId: command.commandId,
      createdAt: command.occurredAt,
    })
    .returning();
  if (!movement) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The stock movement could not be recorded.");
  }
  return {
    entity: "stockMovement",
    action: "upsert",
    entityId: movement.id,
    rowVersion: 1,
    row: movement,
  } satisfies SyncLogChange;
});

const writeCategoryUpsert = Effect.fn("InventoryCatalog.writeCategoryUpsert")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: CategoryUpsertWrite,
) {
  const existing = yield* readCategory(tx, actor.organizationId, write.id);
  if (write.expectedRowVersion === null) {
    if (existing) {
      return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} already exists.`);
    }
    yield* requireUniqueCategoryName(tx, actor.organizationId, write.id, write.row.name);
    const [created] = yield* tx
      .insert(categories)
      .values({ id: write.id, ...write.row, ...insertMetadata(actor, command) })
      .returning();
    if (!created) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The category could not be created.");
    }
    return [upsertChange("category", created)];
  }
  if (!existing) {
    return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
  }
  yield* requireUniqueCategoryName(tx, actor.organizationId, write.id, write.row.name);
  const [updated] = yield* tx
    .update(categories)
    .set({ ...write.row, ...updateMetadata(actor, command, existing.rowVersion) })
    .where(and(eq(categories.organizationId, actor.organizationId), eq(categories.id, write.id)))
    .returning();
  if (!updated) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The category could not be updated.");
  }
  return [upsertChange("category", updated)];
});

const writeProductUpsert = Effect.fn("InventoryCatalog.writeProductUpsert")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: ProductUpsertWrite,
) {
  const existing = yield* readProduct(tx, actor.organizationId, write.id);
  if (write.expectedRowVersion === null) {
    if (existing) {
      return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} already exists.`);
    }
    yield* requireActiveCategory(tx, actor.organizationId, write.row.categoryId);
    const [created] = yield* tx
      .insert(products)
      .values({ id: write.id, ...write.row, ...insertMetadata(actor, command) })
      .returning();
    if (!created) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The product could not be created.");
    }
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
    const stock = yield* readProductBatches(tx, actor.organizationId, write.id);
    if (productHasRemainingStock(stock, write.id)) {
      return yield* protocol("ENTITY_CONFLICT", catalogWriteError.unitsPerPackWithStock);
    }
  }
  if (write.row.categoryId !== existing.categoryId) {
    yield* requireActiveCategory(tx, actor.organizationId, write.row.categoryId);
  }
  const [updated] = yield* tx
    .update(products)
    .set({ ...write.row, ...updateMetadata(actor, command, existing.rowVersion) })
    .where(and(eq(products.organizationId, actor.organizationId), eq(products.id, write.id)))
    .returning();
  if (!updated) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The product could not be updated.");
  }
  return [upsertChange("product", updated)];
});

const writeBatchUpsert = Effect.fn("InventoryCatalog.writeBatchUpsert")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: BatchUpsertWrite,
) {
  const existing = yield* readBatch(tx, actor.organizationId, write.id);
  yield* requireActiveProduct(tx, actor.organizationId, write.row.productId);
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
    const changes = [upsertChange("batch", created)];
    if (batchHasRemainingStock(write.row)) {
      changes.push(
        yield* writeMovement(
          tx,
          actor,
          command,
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
  const changes = [upsertChange("batch", updated)];
  if (batchQuantitiesChanged(write, existing)) {
    changes.push(
      yield* writeMovement(
        tx,
        actor,
        command,
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
  tx: InventoryTransaction,
  actor: InventoryActor,
  write: CatalogRowWrite,
) {
  const existing = yield* readCategory(tx, actor.organizationId, write.id);
  if (!existing) {
    return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} is no longer available.`);
  }
  if (!rowVersionMatches(write, existing.rowVersion)) {
    return yield* protocol("ENTITY_CONFLICT", `Category ${write.id} changed since it was read.`);
  }
  const members = yield* readCategoryProducts(tx, actor.organizationId, write.id);
  if (categoryHasActiveProducts(members, write.id)) {
    return yield* protocol("ENTITY_CONFLICT", catalogWriteError.categoryHasProducts);
  }
  const [deleted] = yield* tx
    .delete(categories)
    .where(and(eq(categories.organizationId, actor.organizationId), eq(categories.id, write.id)))
    .returning();
  if (!deleted) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The category could not be deleted.");
  }
  return [deleteChange("category", deleted, deleted.rowVersion + 1)];
});

const writeProductDelete = Effect.fn("InventoryCatalog.writeProductDelete")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: CatalogRowWrite,
) {
  const existing = yield* readProduct(tx, actor.organizationId, write.id);
  if (!existing || existing.deletedAt !== null) {
    return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} is no longer available.`);
  }
  if (!rowVersionMatches(write, existing.rowVersion)) {
    return yield* protocol("ENTITY_CONFLICT", `Product ${write.id} changed since it was read.`);
  }
  const stock = yield* readProductBatches(tx, actor.organizationId, write.id);
  if (productHasRemainingStock(stock, write.id)) {
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
  return [deleteChange("product", deleted)];
});

const writeBatchDelete = Effect.fn("InventoryCatalog.writeBatchDelete")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: CatalogRowWrite,
) {
  const existing = yield* readBatch(tx, actor.organizationId, write.id);
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
  return [deleteChange("batch", deleted)];
});

const writeRow = Effect.fn("InventoryCatalog.writeRow")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
  write: CatalogRowWrite,
) {
  if (write.action === "delete") {
    if (write.entity === "category") return yield* writeCategoryDelete(tx, actor, write);
    if (write.entity === "product") return yield* writeProductDelete(tx, actor, command, write);
    return yield* writeBatchDelete(tx, actor, command, write);
  }
  if (write.entity === "category") return yield* writeCategoryUpsert(tx, actor, command, write);
  if (write.entity === "product") return yield* writeProductUpsert(tx, actor, command, write);
  return yield* writeBatchUpsert(tx, actor, command, write);
});

export const applyCatalogWrite = Effect.fn("InventoryCommands.applyCatalogWrite")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: CatalogWriteCommand,
) {
  const changes: SyncLogChange[] = [];
  for (const write of command.writes) {
    changes.push(...(yield* writeRow(tx, actor, command, write)));
  }
  return {
    result: { _tag: "catalogWrite", rowsWritten: command.writes.length },
    changes,
  } satisfies CatalogWritten;
});
