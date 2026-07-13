import { SyncEntityChange, type SyncOperation } from "@store/contracts";
import {
  batches,
  categories,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type { SyncTransaction } from "./database.client";
import { protocolError } from "./errors";
import type { SyncActor } from "./model";
import {
  booleanValue,
  commonMutable,
  integerValue,
  movementTypeValue,
  nullableInteger,
  nullableString,
  quantityTypeValue,
  rowOf,
  signedInteger,
  stringValue,
} from "./row-validation";

const writeFailed = (entity: string) =>
  Effect.fail(protocolError("ENTITY_WRITE_FAILED", `${entity} could not be saved.`));

const canonicalChange = (change: SyncEntityChange, rowVersion: number, row: unknown) =>
  SyncEntityChange.make({
    entity: change.entity,
    action: change.action,
    entityId: change.entityId,
    rowVersion,
    row,
  });

export const applyChange = Effect.fn("SyncDatabase.applyChange")(function* (
  tx: SyncTransaction,
  actor: SyncActor,
  operation: SyncOperation,
  change: SyncEntityChange,
) {
  const row = yield* rowOf(change);
  switch (change.entity) {
    case "category": {
      const [current] = yield* tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.organizationId, actor.organizationId),
            eq(categories.id, change.entityId),
          ),
        )
        .limit(1);
      const values = {
        name: (yield* stringValue(row, "name")).trim(),
        ...(yield* commonMutable(actor, operation, change, row, current)),
      };
      const [saved] = yield* tx
        .insert(categories)
        .values(values)
        .onConflictDoUpdate({ target: [categories.organizationId, categories.id], set: values })
        .returning();
      if (!saved) return yield* writeFailed("Category");
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "product": {
      const [current] = yield* tx
        .select()
        .from(products)
        .where(
          and(eq(products.organizationId, actor.organizationId), eq(products.id, change.entityId)),
        )
        .limit(1);
      const values = {
        name: (yield* stringValue(row, "name")).trim(),
        categoryId: yield* stringValue(row, "categoryId"),
        aisle: yield* nullableString(row, "aisle"),
        composition: yield* nullableString(row, "composition"),
        strength: yield* nullableString(row, "strength"),
        unitsPerPack: yield* integerValue(row, "unitsPerPack", 1),
        packPrice: yield* nullableInteger(row, "packPrice"),
        unitPrice: yield* nullableInteger(row, "unitPrice"),
        visible: yield* booleanValue(row, "visible"),
        ...(yield* commonMutable(actor, operation, change, row, current)),
      };
      const [saved] = yield* tx
        .insert(products)
        .values(values)
        .onConflictDoUpdate({ target: [products.organizationId, products.id], set: values })
        .returning();
      if (!saved) return yield* writeFailed("Product");
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "batch": {
      const [current] = yield* tx
        .select()
        .from(batches)
        .where(
          and(eq(batches.organizationId, actor.organizationId), eq(batches.id, change.entityId)),
        )
        .limit(1);
      const values = {
        productId: yield* stringValue(row, "productId"),
        batchNumber: yield* nullableString(row, "batchNumber"),
        expiresAt: yield* nullableInteger(row, "expiresAt"),
        packQuantity: yield* integerValue(row, "packQuantity"),
        unitQuantity: yield* integerValue(row, "unitQuantity"),
        ...(yield* commonMutable(actor, operation, change, row, current)),
      };
      const [saved] = yield* tx
        .insert(batches)
        .values(values)
        .onConflictDoUpdate({ target: [batches.organizationId, batches.id], set: values })
        .returning();
      if (!saved) return yield* writeFailed("Batch");
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "invoice": {
      const [current] = yield* tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.organizationId, actor.organizationId), eq(invoices.id, change.entityId)),
        )
        .limit(1);
      const values = {
        invoiceNumber: yield* stringValue(row, "invoiceNumber"),
        customerName: yield* nullableString(row, "customerName"),
        total: yield* integerValue(row, "total"),
        ...(yield* commonMutable(actor, operation, change, row, current)),
      };
      const [saved] = yield* tx
        .insert(invoices)
        .values(values)
        .onConflictDoUpdate({ target: [invoices.organizationId, invoices.id], set: values })
        .returning();
      if (!saved) return yield* writeFailed("Invoice");
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "invoiceItem": {
      const [current] = yield* tx
        .select()
        .from(invoiceItems)
        .where(
          and(
            eq(invoiceItems.organizationId, actor.organizationId),
            eq(invoiceItems.id, change.entityId),
          ),
        )
        .limit(1);
      const values = {
        invoiceId: yield* stringValue(row, "invoiceId"),
        productId: yield* stringValue(row, "productId"),
        batchId: yield* stringValue(row, "batchId"),
        productName: yield* stringValue(row, "productName"),
        batchNumber: yield* nullableString(row, "batchNumber"),
        quantity: yield* integerValue(row, "quantity", 1),
        quantityType: yield* quantityTypeValue(row),
        baseUnitQuantity: yield* integerValue(row, "baseUnitQuantity", 1),
        salePrice: yield* integerValue(row, "salePrice"),
        ...(yield* commonMutable(actor, operation, change, row, current)),
      };
      const [saved] = yield* tx
        .insert(invoiceItems)
        .values(values)
        .onConflictDoUpdate({ target: [invoiceItems.organizationId, invoiceItems.id], set: values })
        .returning();
      if (!saved) return yield* writeFailed("Invoice item");
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "stockMovement": {
      if (change.action === "delete")
        return yield* Effect.fail(
          protocolError("IMMUTABLE_ENTITY", "Stock movements cannot be deleted."),
        );
      const values = {
        id: change.entityId,
        productId: yield* stringValue(row, "productId"),
        batchId: yield* stringValue(row, "batchId"),
        invoiceId: yield* nullableString(row, "invoiceId"),
        type: yield* movementTypeValue(row),
        packDelta: yield* signedInteger(row, "packDelta"),
        unitDelta: yield* signedInteger(row, "unitDelta"),
        note: yield* nullableString(row, "note"),
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: operation.deviceId,
        operationId: operation.operationId,
        createdAt: (yield* nullableInteger(row, "createdAt")) ?? operation.occurredAt,
      };
      const inserted = yield* tx
        .insert(stockMovements)
        .values(values)
        .onConflictDoNothing({ target: [stockMovements.organizationId, stockMovements.id] })
        .returning();
      const [saved] =
        inserted.length > 0
          ? inserted
          : yield* tx
              .select()
              .from(stockMovements)
              .where(
                and(
                  eq(stockMovements.organizationId, actor.organizationId),
                  eq(stockMovements.id, change.entityId),
                ),
              )
              .limit(1);
      if (!saved) return yield* writeFailed("Stock movement");
      if (
        inserted.length === 0 &&
        (saved.id !== values.id ||
          saved.productId !== values.productId ||
          saved.batchId !== values.batchId ||
          saved.invoiceId !== values.invoiceId ||
          saved.type !== values.type ||
          saved.packDelta !== values.packDelta ||
          saved.unitDelta !== values.unitDelta ||
          saved.note !== values.note ||
          saved.organizationId !== values.organizationId ||
          saved.actorUserId !== values.actorUserId ||
          saved.deviceId !== values.deviceId ||
          saved.operationId !== values.operationId ||
          saved.createdAt !== values.createdAt)
      )
        return yield* Effect.fail(
          protocolError(
            "IMMUTABLE_ENTITY_REUSED",
            "A stock movement id was reused with different content.",
          ),
        );
      return canonicalChange(change, 1, saved);
    }
  }
});
