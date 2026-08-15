import { SyncEntityChange, type SyncEntity, type SyncOperation } from "@store/contracts";
import { syncEntityPushRows, syncEntityRows } from "@store/contracts/entity-rows";
import { omitManaged } from "@store/contracts/managed-columns";
import { categories, invoiceCounters, stockMovements } from "@store/db/do/schema";
import { and, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { SyncTransaction } from "./database";
import { protocolError } from "./errors";
import type { SyncActor } from "./model";
import { decodeEntityRow, serverOwnedColumns } from "./row-validation";

const entityLabels = {
  category: "Category",
  product: "Product",
  batch: "Batch",
  invoice: "Invoice",
  invoiceItem: "Invoice item",
  stockMovement: "Stock movement",
} as const satisfies Record<SyncEntity, string>;

const writeFailed = (entity: SyncEntity) =>
  Effect.fail(protocolError("ENTITY_WRITE_FAILED", `${entityLabels[entity]} could not be saved.`));

type VersionedEntity = Exclude<SyncEntity, "stockMovement">;
type VersionedPushRow = (typeof syncEntityPushRows)[VersionedEntity]["Type"];

/**
 * Upsert for the version-tracked entities, which all share one shape: read the
 * current row, overlay the server-owned columns, then write keyed on
 * `(organizationId, id)`. The table comes from the entity registry so adding an
 * entity does not mean adding another copy of this block.
 */
const upsertVersionedEntity = Effect.fn("SyncDatabase.upsertVersionedEntity")(function* (
  tx: SyncTransaction,
  actor: SyncActor,
  operation: SyncOperation,
  change: SyncEntityChange,
  row: VersionedPushRow,
) {
  // `local/schema` and `do/schema` both re-export `shared/store.schema`, so the
  // registry's table is this table; drizzle just cannot narrow the union.
  // SAFETY: Every versioned registry table has the managed category column shape;
  // entity-specific insert fields flow through Drizzle's values object below.
  const table = syncEntityRows[change.entity].table as typeof categories;
  const [current] = yield* tx
    .select()
    .from(table)
    .where(and(eq(table.organizationId, actor.organizationId), eq(table.id, change.entityId)))
    .limit(1);
  // SAFETY: Decoding selected the schema paired with this registry table, and the
  // server-owned columns complete its insert contract.
  const values = {
    ...omitManaged(row),
    ...serverOwnedColumns(actor, operation, change, row, current),
  } as typeof categories.$inferInsert;
  const [saved] = yield* tx
    .insert(table)
    .values(values)
    .onConflictDoUpdate({ target: [table.organizationId, table.id], set: values })
    .returning();
  return saved;
});

const canonicalChange = <Row>(change: SyncEntityChange, rowVersion: number, row: Row) =>
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
    case "category":
    case "product": {
      // The only entities with a user-facing name to normalize.
      const row = yield* decodeEntityRow(change.entity, change);
      const saved = yield* upsertVersionedEntity(tx, actor, operation, change, {
        ...row,
        name: row.name.trim(),
      });
      if (!saved) return yield* writeFailed(change.entity);
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "batch":
    case "invoiceItem": {
      const row = yield* decodeEntityRow(change.entity, change);
      const saved = yield* upsertVersionedEntity(tx, actor, operation, change, row);
      if (!saved) return yield* writeFailed(change.entity);
      return canonicalChange(change, saved.rowVersion, saved);
    }
    case "invoice": {
      const row = yield* decodeEntityRow("invoice", change);
      const saved = yield* upsertVersionedEntity(tx, actor, operation, change, row);
      if (!saved) return yield* writeFailed(change.entity);
      yield* tx
        .insert(invoiceCounters)
        .values({
          organizationId: actor.organizationId,
          lastInvoiceNumber: row.invoiceNumber,
        })
        .onConflictDoUpdate({
          target: invoiceCounters.organizationId,
          set: {
            // SQLite has no `greatest`; two-argument `max` is its scalar equivalent.
            lastInvoiceNumber: sql`max(${invoiceCounters.lastInvoiceNumber}, ${row.invoiceNumber})`,
          },
        });
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
      if (!saved) return yield* writeFailed(change.entity);
      const rewritten =
        saved.id !== values.id ||
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
        saved.createdAt !== values.createdAt;
      if (inserted.length === 0 && rewritten)
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
