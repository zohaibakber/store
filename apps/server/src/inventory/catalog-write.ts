import {
  catalogWriteError,
  compareSyncEntityChanges,
  type CatalogWriteCommand,
  MAX_CATALOG_WRITE_ROWS,
  type SyncEntityChange,
} from "@store/contracts";
import { syncEntityChangeKey } from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  batches,
  categories,
  inventoryMutationReceipts,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { appendCatalogChanges } from "./catalog-log";
import { withCatalogTransaction } from "./catalog-transaction";
import { inventoryProtocolError as protocolError } from "./errors";
import type { InventoryActor } from "./model";
import { databaseError, type PostgresDrizzle, type PostgresTransaction } from "./postgres";
import { decodeEntityRow, serverOwnedColumns, type CatalogWriteStamp } from "./row-validation";
export interface InventoryMutationResult {
  readonly txid: number;
}

const validIdentifier = (value: string) => value.length > 0 && value.length <= 200;

const CatalogRowMeta = Schema.Struct({
  id: Schema.String,
  rowVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  deletedAt: Schema.NullOr(Schema.Number),
});

type CatalogWrite = {
  readonly command: CatalogWriteCommand;
  readonly changes: ReadonlyArray<SyncEntityChange>;
  readonly payloadHash: string;
};

const writeStamp = (command: CatalogWriteCommand): CatalogWriteStamp => ({
  occurredAt: command.occurredAt,
  deviceId: command.deviceId,
  operationId: command.operationId,
});

const decodeCatalogWrite = Effect.fn("InventoryMutation.decodeCatalogWrite")(function* (
  actor: InventoryActor,
  command: CatalogWriteCommand,
) {
  if (command.organizationId !== actor.organizationId)
    return yield* Effect.fail(
      protocolError(
        "ORGANIZATION_MISMATCH",
        "The mutation does not belong to the active organization.",
      ),
    );
  if (command.actorUserId !== actor.userId)
    return yield* Effect.fail(
      protocolError("ACTOR_MISMATCH", "The mutation was created by a different user."),
    );
  if (!validIdentifier(command.operationId))
    return yield* Effect.fail(protocolError("INVALID_OPERATION", "The mutation id is invalid."));
  if (!validIdentifier(command.deviceId))
    return yield* Effect.fail(protocolError("INVALID_DEVICE", "The device id is invalid."));
  if (!Number.isSafeInteger(command.occurredAt) || command.occurredAt < 1)
    return yield* Effect.fail(
      protocolError("INVALID_OCCURRED_AT", "The mutation timestamp is invalid."),
    );
  if (command.rows.length === 0)
    return yield* Effect.fail(
      protocolError("EMPTY_OPERATION", "A mutation must contain a change."),
    );
  if (command.rows.length > MAX_CATALOG_WRITE_ROWS)
    return yield* Effect.fail(
      protocolError(
        "TOO_MANY_CHANGES",
        `A mutation may contain at most ${MAX_CATALOG_WRITE_ROWS} changes.`,
      ),
    );

  const changes: SyncEntityChange[] = [];
  const keys = new Set<string>();
  for (const raw of command.rows) {
    const meta = yield* Schema.decodeUnknownEffect(CatalogRowMeta)(raw).pipe(
      Effect.mapError(() =>
        protocolError("INVALID_ENTITY_ROW", "A catalog row is missing id, version, or deletion."),
      ),
    );
    if (!validIdentifier(meta.id))
      return yield* Effect.fail(
        protocolError("INVALID_ENTITY_ID", "A mutation entity id is invalid."),
      );
    const change: SyncEntityChange = {
      entity: command.entity,
      action: meta.deletedAt === null ? "upsert" : "delete",
      entityId: meta.id,
      rowVersion: meta.rowVersion,
      row: raw,
    };
    const key = syncEntityChangeKey(change);
    if (keys.has(key))
      return yield* Effect.fail(
        protocolError("DUPLICATE_OPERATION", "A mutation may change an entity only once."),
      );
    keys.add(key);
    changes.push(change);
  }

  return {
    command,
    changes,
    payloadHash: canonicalPayloadHash(command),
  } satisfies CatalogWrite;
});

const touchMutationTarget = Effect.fn("InventoryMutation.touchTarget")(function* (
  tx: PostgresTransaction,
  organizationId: string,
  change: SyncEntityChange,
) {
  switch (change.entity) {
    case "category":
      return yield* tx
        .update(categories)
        .set({ updatedAt: sql`${categories.updatedAt}` })
        .where(
          and(eq(categories.organizationId, organizationId), eq(categories.id, change.entityId)),
        )
        .returning({ id: categories.id });
    case "product":
      return yield* tx
        .update(products)
        .set({ updatedAt: sql`${products.updatedAt}` })
        .where(and(eq(products.organizationId, organizationId), eq(products.id, change.entityId)))
        .returning({ id: products.id });
    case "batch":
      return yield* tx
        .update(batches)
        .set({ updatedAt: sql`${batches.updatedAt}` })
        .where(and(eq(batches.organizationId, organizationId), eq(batches.id, change.entityId)))
        .returning({ id: batches.id });
    default:
      return [];
  }
});

const batchMovementId = (
  write: CatalogWriteStamp,
  change: SyncEntityChange,
  type: "stock_in" | "adjustment",
) => `batch:${write.operationId}:${change.entityId}:${type}`;

const validateWriteVersion = Effect.fn("InventoryMutation.validateWriteVersion")(function* (
  change: SyncEntityChange,
  current: { readonly rowVersion: number; readonly deletedAt: number | null } | undefined,
) {
  if (!current) {
    if (change.action === "delete")
      return yield* Effect.fail(
        protocolError("ENTITY_CONFLICT", "The entity was already deleted."),
      );
    if (change.rowVersion !== 1)
      return yield* Effect.fail(
        protocolError("ENTITY_CONFLICT", "The entity changed before this mutation was saved."),
      );
    return;
  }
  if (current.deletedAt !== null && change.action === "upsert")
    return yield* Effect.fail(
      protocolError("ENTITY_CONFLICT", "A deleted entity cannot be restored by a stale edit."),
    );
  if (change.rowVersion !== current.rowVersion + 1)
    return yield* Effect.fail(
      protocolError("ENTITY_CONFLICT", "The entity changed before this mutation was saved."),
    );
});

const applyChange = Effect.fn("InventoryMutation.applyChange")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  write: CatalogWriteStamp,
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
        .limit(1)
        .for("update");
      yield* validateWriteVersion(change, current);
      if (change.action === "delete") {
        const [product] = yield* tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.organizationId, actor.organizationId),
              eq(products.categoryId, change.entityId),
              isNull(products.deletedAt),
            ),
          )
          .limit(1);
        if (product)
          return yield* Effect.fail(
            protocolError("ENTITY_CONFLICT", catalogWriteError.categoryHasProducts),
          );
      }
      const values = {
        name: row.name.trim(),
        tracksPacks: row.tracksPacks,
        ...serverOwnedColumns(actor, write, change, row, current),
      };
      const [saved] = yield* tx
        .insert(categories)
        .values(values)
        .onConflictDoUpdate({ target: [categories.organizationId, categories.id], set: values })
        .returning({ id: categories.id });
      if (!saved)
        return yield* Effect.fail(
          protocolError("ENTITY_WRITE_FAILED", "Could not save the category."),
        );
      return;
    }
    case "product": {
      const row = yield* decodeEntityRow("product", change);
      const [current] = yield* tx
        .select()
        .from(products)
        .where(
          and(eq(products.organizationId, actor.organizationId), eq(products.id, change.entityId)),
        )
        .limit(1)
        .for("update");
      yield* validateWriteVersion(change, current);
      if (change.action === "delete") {
        const [stocked] = yield* tx
          .select({ id: batches.id })
          .from(batches)
          .where(
            and(
              eq(batches.organizationId, actor.organizationId),
              eq(batches.productId, change.entityId),
              isNull(batches.deletedAt),
              or(gt(batches.packQuantity, 0), gt(batches.unitQuantity, 0)),
            ),
          )
          .limit(1);
        if (stocked)
          return yield* Effect.fail(
            protocolError("ENTITY_CONFLICT", catalogWriteError.productHasStock),
          );
      }
      if (change.action === "upsert") {
        const [category] = yield* tx
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.organizationId, actor.organizationId),
              eq(categories.id, row.categoryId),
              isNull(categories.deletedAt),
            ),
          )
          .limit(1);
        if (!category)
          return yield* Effect.fail(
            protocolError("ENTITY_RELATION_INVALID", "Pick an active category for this product."),
          );
        if (current && row.unitsPerPack !== current.unitsPerPack) {
          const [stocked] = yield* tx
            .select({ id: batches.id })
            .from(batches)
            .where(
              and(
                eq(batches.organizationId, actor.organizationId),
                eq(batches.productId, change.entityId),
                isNull(batches.deletedAt),
                or(gt(batches.packQuantity, 0), gt(batches.unitQuantity, 0)),
              ),
            )
            .limit(1);
          if (stocked)
            return yield* Effect.fail(
              protocolError("ENTITY_CONFLICT", catalogWriteError.unitsPerPackWithStock),
            );
        }
      }
      const values = {
        name: row.name.trim(),
        categoryId: row.categoryId,
        aisle: row.aisle,
        composition: row.composition,
        strength: row.strength,
        unitsPerPack: row.unitsPerPack,
        purchasePrice: row.purchasePrice,
        retailPrice: row.retailPrice,
        unitPrice: row.unitPrice,
        visible: row.visible,
        ...serverOwnedColumns(actor, write, change, row, current),
      };
      const [saved] = yield* tx
        .insert(products)
        .values(values)
        .onConflictDoUpdate({ target: [products.organizationId, products.id], set: values })
        .returning({ id: products.id });
      if (!saved)
        return yield* Effect.fail(
          protocolError("ENTITY_WRITE_FAILED", "Could not save the product."),
        );
      return;
    }
    case "batch": {
      const row = yield* decodeEntityRow("batch", change);
      const [current] = yield* tx
        .select()
        .from(batches)
        .where(
          and(eq(batches.organizationId, actor.organizationId), eq(batches.id, change.entityId)),
        )
        .limit(1)
        .for("update");
      yield* validateWriteVersion(change, current);
      if (change.action === "delete") {
        if ((current?.packQuantity ?? 0) > 0 || (current?.unitQuantity ?? 0) > 0)
          return yield* Effect.fail(
            protocolError("ENTITY_CONFLICT", catalogWriteError.batchHasStock),
          );
      }
      if (change.action === "upsert") {
        const [product] = yield* tx
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.organizationId, actor.organizationId),
              eq(products.id, row.productId),
              isNull(products.deletedAt),
            ),
          )
          .limit(1);
        if (!product)
          return yield* Effect.fail(
            protocolError("ENTITY_RELATION_INVALID", "The batch product is not active."),
          );
        if (current && row.productId !== current.productId)
          return yield* Effect.fail(
            protocolError("ENTITY_RELATION_INVALID", "A batch cannot be moved to another product."),
          );
      }
      const values = {
        productId: row.productId,
        batchNumber: row.batchNumber,
        expiresAt: row.expiresAt,
        packQuantity: row.packQuantity,
        unitQuantity: row.unitQuantity,
        ...serverOwnedColumns(actor, write, change, row, current),
      };
      const [saved] = yield* tx
        .insert(batches)
        .values(values)
        .onConflictDoUpdate({ target: [batches.organizationId, batches.id], set: values })
        .returning({ id: batches.id });
      if (!saved)
        return yield* Effect.fail(
          protocolError("ENTITY_WRITE_FAILED", "Could not save the batch."),
        );

      const packDelta = row.packQuantity - (current?.packQuantity ?? 0);
      const unitDelta = row.unitQuantity - (current?.unitQuantity ?? 0);
      if (change.action === "upsert" && (packDelta !== 0 || unitDelta !== 0)) {
        const [movement] = yield* tx
          .insert(stockMovements)
          .values({
            id: batchMovementId(write, change, current ? "adjustment" : "stock_in"),
            productId: row.productId,
            batchId: change.entityId,
            invoiceId: null,
            type: current ? "adjustment" : "stock_in",
            packDelta,
            unitDelta,
            note: current ? "Stock corrected" : "Initial batch stock",
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            deviceId: write.deviceId,
            operationId: write.operationId,
            createdAt: write.occurredAt,
          })
          .returning({ id: stockMovements.id });
        if (!movement)
          return yield* Effect.fail(
            protocolError("ENTITY_WRITE_FAILED", "Could not record the batch stock movement."),
          );
      }
      return;
    }
    default:
      return yield* Effect.fail(
        protocolError("INVALID_OPERATION", "This entity cannot be written by this endpoint."),
      );
  }
});

const applyOperation = Effect.fn("InventoryMutation.applyOperation")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  write: CatalogWrite,
  receivedAt: number,
) {
  const { command, changes, payloadHash } = write;
  yield* tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      actor.organizationId,
      command.operationId,
    ])}, 0))`,
  );
  const [receipt] = yield* tx
    .select({
      payloadHash: inventoryMutationReceipts.payloadHash,
      transactionId: inventoryMutationReceipts.transactionId,
    })
    .from(inventoryMutationReceipts)
    .where(
      and(
        eq(inventoryMutationReceipts.organizationId, actor.organizationId),
        eq(inventoryMutationReceipts.operationId, command.operationId),
      ),
    )
    .limit(1);

  if (receipt) {
    if (receipt.payloadHash !== payloadHash)
      return yield* Effect.fail(
        protocolError("OPERATION_ID_REUSED", "The mutation id was reused with different content."),
      );
    const firstChange = changes[0];
    if (!firstChange)
      return yield* Effect.fail(
        protocolError("EMPTY_OPERATION", "A mutation must contain a change."),
      );
    const touched = yield* touchMutationTarget(tx, actor.organizationId, firstChange);
    if (touched.length === 0)
      return yield* Effect.fail(
        protocolError("ENTITY_WRITE_FAILED", "Could not acknowledge the replayed mutation."),
      );
    return { txid: receipt.transactionId } satisfies InventoryMutationResult;
  }

  const stamp = writeStamp(command);
  const canonicalChanges = [...changes].sort(compareSyncEntityChanges);
  for (const change of canonicalChanges)
    yield* tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        actor.organizationId,
        change.entity,
        change.entityId,
      ])}, 0))`,
    );
  for (const change of canonicalChanges) yield* applyChange(tx, actor, stamp, change);

  const txid = yield* appendCatalogChanges(tx, actor.organizationId, canonicalChanges, receivedAt);
  yield* tx.insert(inventoryMutationReceipts).values({
    organizationId: actor.organizationId,
    operationId: command.operationId,
    deviceId: command.deviceId,
    actorUserId: actor.userId,
    clientSequence: command.occurredAt,
    payloadHash,
    transactionId: txid,
    receivedAt,
  });
  return { txid } satisfies InventoryMutationResult;
});

export const makeInventoryMutationDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryMutationDatabase.write")(function* (
    actor: InventoryActor,
    command: CatalogWriteCommand,
  ) {
    const write = yield* decodeCatalogWrite(actor, command);
    const receivedAt = yield* Clock.currentTimeMillis;
    return yield* withCatalogTransaction(db, actor.organizationId, (tx) =>
      applyOperation(tx, actor, write, receivedAt),
    );
  }, Effect.mapError(databaseError));

export type InventoryMutationWriter = ReturnType<typeof makeInventoryMutationDatabase>;
