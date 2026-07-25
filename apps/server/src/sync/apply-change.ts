import { SyncEntityChange, type SyncOperation } from "@store/contracts";
import { omitManaged } from "@store/contracts/managed-columns";
import {
  batches,
  categories,
  invoiceCounters,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/do/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { SyncTransaction } from "./database";
import { protocolError } from "./errors";
import type { SyncActor } from "./model";
import { decodeEntityRow, serverOwnedColumns } from "./row-validation";

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
  switch (change.entity) {
    case "category": {
      const row = yield* decodeEntityRow("category", change);
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
        ...omitManaged(row),
        name: row.name.trim(),
        ...serverOwnedColumns(actor, operation, change, row, current),
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
      const row = yield* decodeEntityRow("product", change);
      const [current] = yield* tx
        .select()
        .from(products)
        .where(
          and(eq(products.organizationId, actor.organizationId), eq(products.id, change.entityId)),
        )
        .limit(1);
      const values = {
        ...omitManaged(row),
        name: row.name.trim(),
        ...serverOwnedColumns(actor, operation, change, row, current),
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
      const row = yield* decodeEntityRow("batch", change);
      const [current] = yield* tx
        .select()
        .from(batches)
        .where(
          and(eq(batches.organizationId, actor.organizationId), eq(batches.id, change.entityId)),
        )
        .limit(1);
      const values = {
        ...omitManaged(row),
        ...serverOwnedColumns(actor, operation, change, row, current),
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
      const row = yield* decodeEntityRow("invoice", change);
      const [current] = yield* tx
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.organizationId, actor.organizationId), eq(invoices.id, change.entityId)),
        )
        .limit(1);
      const values = {
        ...omitManaged(row),
        ...serverOwnedColumns(actor, operation, change, row, current),
      };
      const [saved] = yield* tx
        .insert(invoices)
        .values(values)
        .onConflictDoUpdate({ target: [invoices.organizationId, invoices.id], set: values })
        .returning();
      if (!saved) return yield* writeFailed("Invoice");
      yield* tx
        .insert(invoiceCounters)
        .values({
          organizationId: actor.organizationId,
          lastInvoiceNumber: saved.invoiceNumber,
        })
        .onConflictDoUpdate({
          target: invoiceCounters.organizationId,
          set: {
            lastInvoiceNumber: sql`greatest(${invoiceCounters.lastInvoiceNumber}, ${saved.invoiceNumber})`,
          },
        });
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "invoiceItem": {
      const row = yield* decodeEntityRow("invoiceItem", change);
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
        ...omitManaged(row),
        ...serverOwnedColumns(actor, operation, change, row, current),
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
      const row = yield* decodeEntityRow("stockMovement", change);
      const values = {
        ...omitManaged(row),
        id: change.entityId,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: operation.deviceId,
        operationId: operation.operationId,
        createdAt: row.createdAt ?? operation.occurredAt,
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
