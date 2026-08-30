import * as PgClient from "@effect/sql-pg/PgClient";
import {
  allocationsCoverInput,
  catalogWriteError,
  compareSyncEntityChanges,
  decodeInvoiceId,
  type CatalogWriteCommand,
  type ImportInventoryCommand,
  type ImportInventoryCommandResult,
  inventorySkuKey,
  type IssueInvoiceCommand,
  type IssueInvoiceResult,
  MAX_CATALOG_WRITE_ROWS,
  normalizedProductName,
  type SyncEntityChange,
} from "@store/contracts";
import { syncEntityChangeKey } from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import { InventoryHyperdrive } from "@store/db/postgres/infra";
import {
  batches,
  categories,
  inventoryMutationReceipts,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Postgres from "alchemy/SQL/Postgres";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ConstraintError, SqlError, UniqueViolation } from "effect/unstable/sql/SqlError";

import {
  InventoryDatabaseError,
  InventoryProtocolError,
  inventoryProtocolError as protocolError,
} from "./errors";
import type { InventoryActor } from "./model";
import { decodeEntityRow, serverOwnedColumns, type CatalogWriteStamp } from "./row-validation";

export interface InventoryMutationResult {
  readonly txid: number;
}

export const makePostgresDrizzle = (client: PgClient.PgClient) =>
  PgDrizzle.makeWithDefaults().pipe(Effect.provideService(PgClient.PgClient, client));

export type PostgresDrizzle = Effect.Success<ReturnType<typeof makePostgresDrizzle>>;
type PostgresTransaction = Parameters<Parameters<PostgresDrizzle["transaction"]>[0]>[0];

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const databaseError = (cause: unknown) => {
  if (cause instanceof EffectDrizzleQueryError && cause.cause instanceof SqlError) {
    if (cause.cause.reason instanceof UniqueViolation)
      return protocolError("ENTITY_CONFLICT", "This entity conflicts with an existing value.");
    if (cause.cause.reason instanceof ConstraintError)
      return protocolError(
        "ENTITY_RELATION_INVALID",
        "This entity refers to a related entity that does not exist.",
      );
  }
  return InventoryDatabaseError.make({ message: messageOf(cause), cause });
};

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

const currentTransactionId = Effect.fn("InventoryMutation.currentTransactionId")(function* (
  tx: PostgresTransaction,
) {
  const [row] = yield* tx.execute<{ value: string }>(
    sql`select pg_current_xact_id()::xid::text as value`,
    "objects",
  );
  const txid = Number(row?.value);
  if (!Number.isSafeInteger(txid) || txid < 1)
    return yield* Effect.fail(
      InventoryDatabaseError.make({ message: "Postgres did not return a valid transaction id." }),
    );
  return txid;
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
    .select({ payloadHash: inventoryMutationReceipts.payloadHash })
    .from(inventoryMutationReceipts)
    .where(
      and(
        eq(inventoryMutationReceipts.organizationId, actor.organizationId),
        eq(inventoryMutationReceipts.operationId, command.operationId),
      ),
    )
    .limit(1);

  const txid = yield* currentTransactionId(tx);
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
    yield* tx
      .update(inventoryMutationReceipts)
      .set({ transactionId: txid })
      .where(
        and(
          eq(inventoryMutationReceipts.organizationId, actor.organizationId),
          eq(inventoryMutationReceipts.operationId, command.operationId),
        ),
      );
    return { txid } satisfies InventoryMutationResult;
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

const invoiceError = (message: string) => protocolError("INVALID_OPERATION", message);
const invoiceStockError = (message: string) => protocolError("INSUFFICIENT_STOCK", message);

const NonNegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

const InventoryImportReceipt = Schema.Struct({
  kind: Schema.Literal("inventory-import"),
  createdProducts: NonNegativeInteger,
  createdBatches: NonNegativeInteger,
  observerProductId: Schema.NullOr(Schema.String),
  observerBatchId: Schema.NullOr(Schema.String),
});
type InventoryImportReceipt = typeof InventoryImportReceipt.Type;

const parseInventoryImportReceipt = (value: string | null) =>
  Effect.try({
    try: () => (value === null ? null : JSON.parse(value)),
    catch: () => protocolError("ENTITY_WRITE_FAILED", "The saved import receipt is invalid."),
  }).pipe(
    Effect.flatMap((parsed) =>
      parsed === null
        ? Effect.fail(
            protocolError("OPERATION_ID_REUSED", "The import command id is already in use."),
          )
        : Schema.decodeUnknownEffect(InventoryImportReceipt)(parsed).pipe(
            Effect.mapError(() =>
              protocolError("ENTITY_WRITE_FAILED", "The saved import receipt is invalid."),
            ),
          ),
    ),
  );

const importError = (message: string) => protocolError("ENTITY_CONFLICT", message);

const POSTGRES_INTEGER_MAX = 2_147_483_647;

const validateInventoryImport = Effect.fn("InventoryCommand.validateImport")(function* (
  command: ImportInventoryCommand,
) {
  if (!Number.isSafeInteger(command.occurredAt) || command.occurredAt < 1)
    return yield* Effect.fail(
      protocolError("INVALID_OCCURRED_AT", "The import timestamp is invalid."),
    );
  for (const line of command.input.lines) {
    const unitsPerPack = line.unitsPerPack ?? 1;
    const purchasePrice = line.purchasePrice ?? null;
    const expiresAt = line.expiresAt ?? null;
    const packQuantity = line.packQuantity ?? 0;
    const unitQuantity = line.unitQuantity ?? 0;
    if (!line.name.trim()) return yield* Effect.fail(importError("Product names cannot be empty."));
    if (
      !Number.isSafeInteger(unitsPerPack) ||
      unitsPerPack < 1 ||
      unitsPerPack > POSTGRES_INTEGER_MAX
    )
      return yield* Effect.fail(importError("Units per pack must be a whole number of 1 or more."));
    if (
      purchasePrice !== null &&
      (!Number.isSafeInteger(purchasePrice) ||
        purchasePrice < 0 ||
        purchasePrice > POSTGRES_INTEGER_MAX)
    )
      return yield* Effect.fail(importError("Purchase prices cannot be negative."));
    if (
      !Number.isSafeInteger(packQuantity) ||
      packQuantity < 0 ||
      packQuantity > POSTGRES_INTEGER_MAX ||
      !Number.isSafeInteger(unitQuantity) ||
      unitQuantity < 0 ||
      unitQuantity > POSTGRES_INTEGER_MAX
    )
      return yield* Effect.fail(
        importError("Pack and unit quantities must be non-negative whole numbers."),
      );
    if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt < 0))
      return yield* Effect.fail(importError("Expiry dates must be valid timestamps."));
  }
});

const importInventory = Effect.fn("InventoryCommand.importInventory")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  command: ImportInventoryCommand,
  receivedAt: number,
) {
  const payloadHash = canonicalPayloadHash(command);
  yield* tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      actor.organizationId,
      command.commandId,
    ])}, 0))`,
  );

  const [receipt] = yield* tx
    .select({
      payloadHash: inventoryMutationReceipts.payloadHash,
      commandResult: inventoryMutationReceipts.commandResult,
    })
    .from(inventoryMutationReceipts)
    .where(
      and(
        eq(inventoryMutationReceipts.organizationId, actor.organizationId),
        eq(inventoryMutationReceipts.operationId, command.commandId),
      ),
    )
    .limit(1);
  const txid = yield* currentTransactionId(tx);

  if (receipt) {
    if (receipt.payloadHash !== payloadHash)
      return yield* Effect.fail(
        protocolError("OPERATION_ID_REUSED", "The import command id was reused."),
      );
    const saved = yield* parseInventoryImportReceipt(receipt.commandResult);
    if (saved.observerProductId !== null) {
      const touched = yield* tx
        .update(products)
        .set({ updatedAt: sql`${products.updatedAt}` })
        .where(
          and(
            eq(products.organizationId, actor.organizationId),
            eq(products.id, saved.observerProductId),
          ),
        )
        .returning({ id: products.id });
      if (touched.length === 0)
        return yield* Effect.fail(
          protocolError("ENTITY_WRITE_FAILED", "The saved import could not be acknowledged."),
        );
    }
    if (saved.observerBatchId !== null) {
      const touched = yield* tx
        .update(batches)
        .set({ updatedAt: sql`${batches.updatedAt}` })
        .where(
          and(
            eq(batches.organizationId, actor.organizationId),
            eq(batches.id, saved.observerBatchId),
          ),
        )
        .returning({ id: batches.id });
      if (touched.length === 0)
        return yield* Effect.fail(
          protocolError("ENTITY_WRITE_FAILED", "The saved import could not be acknowledged."),
        );
    }
    yield* tx
      .update(inventoryMutationReceipts)
      .set({ transactionId: txid })
      .where(
        and(
          eq(inventoryMutationReceipts.organizationId, actor.organizationId),
          eq(inventoryMutationReceipts.operationId, command.commandId),
        ),
      );
    return {
      createdProducts: saved.createdProducts,
      createdBatches: saved.createdBatches,
      txid,
    } satisfies ImportInventoryCommandResult;
  }

  yield* validateInventoryImport(command);

  const [category] = yield* tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.organizationId, actor.organizationId),
        eq(categories.id, command.input.categoryId),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!category) return yield* Effect.fail(importError("Pick an active category for this import."));

  const stockLines = command.input.lines.filter(
    (line) => (line.packQuantity ?? 0) + (line.unitQuantity ?? 0) > 0,
  );
  const suppliedProductIds = [
    ...new Set(stockLines.flatMap((line) => (line.productId === null ? [] : [line.productId]))),
  ].sort();
  const requestedNames = [
    ...new Set(stockLines.map((line) => normalizedProductName(line.name))),
  ].sort();

  for (const name of requestedNames)
    yield* tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        actor.organizationId,
        "inventory-product-name",
        name,
      ])}, 0))`,
    );

  const idCondition =
    suppliedProductIds.length > 0 ? inArray(products.id, suppliedProductIds) : undefined;
  const nameCondition =
    requestedNames.length > 0
      ? inArray(sql<string>`lower(btrim(${products.name}))`, requestedNames)
      : undefined;
  const relevantProduct =
    idCondition && nameCondition ? or(idCondition, nameCondition) : (idCondition ?? nameCondition);
  const existingProducts = relevantProduct
    ? yield* tx
        .select({ id: products.id, name: products.name, unitsPerPack: products.unitsPerPack })
        .from(products)
        .where(
          and(
            eq(products.organizationId, actor.organizationId),
            isNull(products.deletedAt),
            relevantProduct,
          ),
        )
        .orderBy(asc(products.id))
        .for("update")
    : [];

  const productsById = new Map(existingProducts.map((product) => [product.id, product]));
  const productIdsBySku = new Map<string, string[]>();
  for (const product of existingProducts) {
    const key = inventorySkuKey(product.name, product.unitsPerPack);
    const ids = productIdsBySku.get(key);
    if (ids) ids.push(product.id);
    else productIdsBySku.set(key, [product.id]);
  }
  for (const id of suppliedProductIds)
    if (!productsById.has(id))
      return yield* Effect.fail(importError("One of the selected products no longer exists."));

  let createdProducts = 0;
  let createdBatches = 0;
  let observerProductId: string | null = null;
  let observerBatchId: string | null = null;

  for (const line of command.input.lines) {
    const packQuantity = line.packQuantity ?? 0;
    const unitQuantity = line.unitQuantity ?? 0;
    if (packQuantity + unitQuantity === 0) continue;

    const unitsPerPack = line.unitsPerPack ?? 1;
    const sku = inventorySkuKey(line.name, unitsPerPack);
    let productId: string | null = line.productId;
    if (productId !== null) {
      const selected = productsById.get(productId);
      if (!selected)
        return yield* Effect.fail(importError("One of the selected products no longer exists."));
      if (selected.unitsPerPack !== unitsPerPack) productId = null;
    }
    if (productId === null) {
      const matches = productIdsBySku.get(sku) ?? [];
      if (matches.length > 1)
        return yield* Effect.fail(
          importError(
            `Multiple products are named “${line.name.trim()}” with ${unitsPerPack} units per pack. Choose which one to restock.`,
          ),
        );
      if (matches[0]) {
        productId = matches[0];
      } else {
        const [created] = yield* tx
          .insert(products)
          .values({
            name: line.name.trim(),
            categoryId: command.input.categoryId,
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack,
            purchasePrice: line.purchasePrice ?? null,
            retailPrice: null,
            unitPrice: null,
            visible: true,
            organizationId: actor.organizationId,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
            deviceId: command.deviceId,
            operationId: command.commandId,
            rowVersion: 1,
            createdAt: command.occurredAt,
            updatedAt: command.occurredAt,
            deletedAt: null,
          })
          .returning({ id: products.id, name: products.name, unitsPerPack: products.unitsPerPack });
        if (!created)
          return yield* Effect.fail(importError("An imported product could not be created."));
        productId = created.id;
        productsById.set(productId, created);
        productIdsBySku.set(sku, [productId]);
        observerProductId ??= productId;
        createdProducts += 1;
      }
    }

    const [batch] = yield* tx
      .insert(batches)
      .values({
        productId,
        batchNumber: line.batchNumber?.trim() || null,
        expiresAt: line.expiresAt ?? null,
        packQuantity,
        unitQuantity,
        organizationId: actor.organizationId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: 1,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
        deletedAt: null,
      })
      .returning({ id: batches.id });
    if (!batch) return yield* Effect.fail(importError("An imported batch could not be created."));

    const [movement] = yield* tx
      .insert(stockMovements)
      .values({
        productId,
        batchId: batch.id,
        invoiceId: null,
        type: "stock_in",
        packDelta: packQuantity,
        unitDelta: unitQuantity,
        note: "Initial batch stock",
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      })
      .returning({ id: stockMovements.id });
    if (!movement) return yield* Effect.fail(importError("Imported stock could not be recorded."));

    observerBatchId ??= batch.id;
    createdBatches += 1;
  }

  const commandResult: InventoryImportReceipt = {
    kind: "inventory-import",
    createdProducts,
    createdBatches,
    observerProductId,
    observerBatchId,
  };
  yield* tx.insert(inventoryMutationReceipts).values({
    organizationId: actor.organizationId,
    operationId: command.commandId,
    deviceId: command.deviceId,
    actorUserId: actor.userId,
    clientSequence: command.occurredAt,
    payloadHash,
    transactionId: txid,
    receivedAt,
    commandResult: JSON.stringify(commandResult),
  });

  return { createdProducts, createdBatches, txid } satisfies ImportInventoryCommandResult;
});

const issueInvoice = Effect.fn("InventoryCommand.issueInvoice")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  command: IssueInvoiceCommand,
  receivedAt: number,
) {
  const payloadHash = canonicalPayloadHash(command);
  yield* tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      actor.organizationId,
      command.commandId,
    ])}, 0))`,
  );

  const [receipt] = yield* tx
    .select({ payloadHash: inventoryMutationReceipts.payloadHash })
    .from(inventoryMutationReceipts)
    .where(
      and(
        eq(inventoryMutationReceipts.organizationId, actor.organizationId),
        eq(inventoryMutationReceipts.operationId, command.commandId),
      ),
    )
    .limit(1);
  const txid = yield* currentTransactionId(tx);
  if (receipt) {
    if (receipt.payloadHash !== payloadHash) {
      return yield* Effect.fail(
        protocolError("OPERATION_ID_REUSED", "The invoice command id was reused."),
      );
    }
    const [invoice] = yield* tx
      .update(invoices)
      .set({ updatedAt: sql`${invoices.updatedAt}` })
      .where(
        and(
          eq(invoices.organizationId, actor.organizationId),
          eq(invoices.operationId, command.commandId),
        ),
      )
      .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
    if (!invoice) {
      return yield* Effect.fail(
        protocolError("ENTITY_WRITE_FAILED", "The saved invoice could not be acknowledged."),
      );
    }
    yield* tx
      .update(invoiceItems)
      .set({ updatedAt: sql`${invoiceItems.updatedAt}` })
      .where(
        and(
          eq(invoiceItems.organizationId, actor.organizationId),
          eq(invoiceItems.invoiceId, invoice.id),
        ),
      );
    yield* tx
      .update(inventoryMutationReceipts)
      .set({ transactionId: txid })
      .where(
        and(
          eq(inventoryMutationReceipts.organizationId, actor.organizationId),
          eq(inventoryMutationReceipts.operationId, command.commandId),
        ),
      );
    return {
      invoiceId: decodeInvoiceId(invoice.id),
      invoiceNumber: invoice.invoiceNumber,
      txid,
    } satisfies IssueInvoiceResult;
  }

  if (command.input.items.length === 0) {
    return yield* Effect.fail(invoiceError("Add at least one item to the sale."));
  }
  for (const line of command.input.items) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      return yield* Effect.fail(invoiceError("Quantities must be whole numbers of 1 or more."));
    }
    if (!Number.isSafeInteger(line.salePrice) || line.salePrice < 0) {
      return yield* Effect.fail(invoiceError("Sale prices cannot be negative."));
    }
  }
  if (!allocationsCoverInput(command.input, command.allocations)) {
    return yield* Effect.fail(invoiceError("The sale allocations do not match the items."));
  }

  const total = command.input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
  const [existingInvoice] = yield* tx
    .select({ operationId: invoices.operationId })
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, actor.organizationId), eq(invoices.id, command.invoiceId)),
    )
    .limit(1);
  if (existingInvoice && existingInvoice.operationId !== command.commandId) {
    return yield* Effect.fail(
      protocolError("INVOICE_IDENTITY_CONFLICT", "This invoice id is already in use."),
    );
  }

  const invoiceValues = (invoiceNumber: number) => ({
    id: command.invoiceId,
    invoiceNumber,
    customerName: command.input.customerName?.trim() || null,
    total,
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: command.deviceId,
    operationId: command.commandId,
    rowVersion: 1,
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt,
    deletedAt: null,
  });
  const inserted = yield* tx
    .insert(invoices)
    .values(invoiceValues(command.invoiceNumber))
    .onConflictDoNothing({
      target: [invoices.organizationId, invoices.invoiceNumber],
    })
    .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
  let invoice = inserted[0];
  if (!invoice) {
    const [latest] = yield* tx
      .select({
        lastInvoiceNumber: sql<number>`coalesce(max(${invoices.invoiceNumber}), 0)`,
      })
      .from(invoices)
      .where(eq(invoices.organizationId, actor.organizationId));
    const [retry] = yield* tx
      .insert(invoices)
      .values(invoiceValues((latest?.lastInvoiceNumber ?? 0) + 1))
      .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
    invoice = retry;
  }
  if (!invoice) return yield* Effect.fail(invoiceError("The invoice could not be created."));

  for (const take of command.allocations) {
    const [product] = yield* tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.organizationId, actor.organizationId),
          eq(products.id, take.productId),
          isNull(products.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!product) {
      return yield* Effect.fail(invoiceError("One of the products no longer exists."));
    }

    const [batch] = yield* tx
      .select()
      .from(batches)
      .where(
        and(
          eq(batches.organizationId, actor.organizationId),
          eq(batches.id, take.batchId),
          eq(batches.productId, product.id),
          isNull(batches.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!batch) {
      return yield* Effect.fail(
        invoiceStockError(`The selected batch for ${product.name} is gone.`),
      );
    }

    const available =
      take.quantityType === "pack"
        ? batch.packQuantity
        : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;
    if (available < take.quantity) {
      return yield* Effect.fail(
        invoiceStockError(
          `Not enough stock for ${product.name}: ${available} available, ${take.quantity} requested.`,
        ),
      );
    }

    const packsOpened =
      take.quantityType === "unit"
        ? Math.max(0, Math.ceil((take.quantity - batch.unitQuantity) / product.unitsPerPack))
        : take.packsOpened;
    if (take.quantityType === "unit" && packsOpened !== take.packsOpened) {
      return yield* Effect.fail(
        invoiceStockError(`Not enough stock for ${product.name}: pack layout changed.`),
      );
    }
    const nextPackQuantity =
      take.quantityType === "pack"
        ? batch.packQuantity - take.quantity
        : batch.packQuantity - take.packsOpened;
    const nextUnitQuantity =
      take.quantityType === "pack"
        ? batch.unitQuantity
        : batch.unitQuantity + take.packsOpened * product.unitsPerPack - take.quantity;
    if (nextPackQuantity < 0 || nextUnitQuantity < 0) {
      return yield* Effect.fail(invoiceStockError(`Not enough stock for ${product.name}.`));
    }

    const [updatedBatch] = yield* tx
      .update(batches)
      .set({
        packQuantity: nextPackQuantity,
        unitQuantity: nextUnitQuantity,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: batch.rowVersion + 1,
        updatedAt: command.occurredAt,
      })
      .where(and(eq(batches.organizationId, actor.organizationId), eq(batches.id, batch.id)))
      .returning({ id: batches.id });
    if (!updatedBatch) return yield* Effect.fail(invoiceError("Stock could not be updated."));

    const [item] = yield* tx
      .insert(invoiceItems)
      .values({
        id: take.invoiceItemId,
        invoiceId: invoice.id,
        productId: product.id,
        batchId: batch.id,
        productName: product.name,
        batchNumber: batch.batchNumber,
        quantity: take.quantity,
        quantityType: take.quantityType,
        baseUnitQuantity: take.quantity * (take.quantityType === "pack" ? product.unitsPerPack : 1),
        salePrice: take.salePrice,
        organizationId: actor.organizationId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: 1,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
        deletedAt: null,
      })
      .returning({ id: invoiceItems.id });
    if (!item) return yield* Effect.fail(invoiceError("The invoice item could not be saved."));

    if (take.packsOpened > 0) {
      if (!take.openPackMovementId) {
        return yield* Effect.fail(invoiceError("The invoice item could not be saved."));
      }
      yield* tx.insert(stockMovements).values({
        id: take.openPackMovementId,
        productId: product.id,
        batchId: batch.id,
        invoiceId: invoice.id,
        type: "open_pack",
        packDelta: -take.packsOpened,
        unitDelta: take.packsOpened * product.unitsPerPack,
        note: `Opened for invoice #${invoice.invoiceNumber}`,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      });
    }
    yield* tx.insert(stockMovements).values({
      id: take.saleMovementId,
      productId: product.id,
      batchId: batch.id,
      invoiceId: invoice.id,
      type: "sale",
      packDelta: take.quantityType === "pack" ? -take.quantity : 0,
      unitDelta: take.quantityType === "unit" ? -take.quantity : 0,
      note: `Invoice #${invoice.invoiceNumber}`,
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      deviceId: command.deviceId,
      operationId: command.commandId,
      createdAt: command.occurredAt,
    });
  }

  yield* tx.insert(inventoryMutationReceipts).values({
    organizationId: actor.organizationId,
    operationId: command.commandId,
    deviceId: command.deviceId,
    actorUserId: actor.userId,
    clientSequence: command.occurredAt,
    payloadHash,
    transactionId: txid,
    receivedAt,
  });
  return {
    invoiceId: decodeInvoiceId(invoice.id),
    invoiceNumber: invoice.invoiceNumber,
    txid,
  } satisfies IssueInvoiceResult;
});

export const makeInventoryMutationDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryMutationDatabase.write")(
    function* (actor: InventoryActor, command: CatalogWriteCommand) {
      const write = yield* decodeCatalogWrite(actor, command);
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* db.transaction((tx) => applyOperation(tx, actor, write, receivedAt));
    },
    Effect.mapError((cause) =>
      cause instanceof InventoryProtocolError || cause instanceof InventoryDatabaseError
        ? cause
        : databaseError(cause),
    ),
  );

export const makeInvoiceCommandDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryCommandDatabase.issueInvoice")(
    function* (actor: InventoryActor, command: IssueInvoiceCommand) {
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* db.transaction((tx) => issueInvoice(tx, actor, command, receivedAt));
    },
    Effect.mapError((cause) =>
      cause instanceof InventoryProtocolError || cause instanceof InventoryDatabaseError
        ? cause
        : databaseError(cause),
    ),
  );

export const makeInventoryImportCommandDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryCommandDatabase.importInventory")(
    function* (actor: InventoryActor, command: ImportInventoryCommand) {
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* db.transaction((tx) => importInventory(tx, actor, command, receivedAt));
    },
    Effect.mapError((cause) =>
      cause instanceof InventoryProtocolError || cause instanceof InventoryDatabaseError
        ? cause
        : databaseError(cause),
    ),
  );

export type InventoryMutationWriter = ReturnType<typeof makeInventoryMutationDatabase>;

export class InventoryMutationDatabase extends Context.Service<
  InventoryMutationDatabase,
  {
    readonly write: InventoryMutationWriter;
    readonly importInventory: ReturnType<typeof makeInventoryImportCommandDatabase>;
    readonly issueInvoice: ReturnType<typeof makeInvoiceCommandDatabase>;
  }
>()("@store/server/InventoryMutationDatabase") {}

export const InventoryMutationDatabaseLive = Layer.effect(
  InventoryMutationDatabase,
  Effect.gen(function* () {
    const inventoryHyperdrive = yield* InventoryHyperdrive;
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(inventoryHyperdrive);
    const postgres = yield* Postgres.Postgres({
      url: hyperdrive.connectionString,
      maxConnections: 1,
      applicationName: "tabaaq-inventory-mutations",
    });
    const db = yield* makePostgresDrizzle(postgres);
    return InventoryMutationDatabase.of({
      write: makeInventoryMutationDatabase(db),
      importInventory: makeInventoryImportCommandDatabase(db),
      issueInvoice: makeInvoiceCommandDatabase(db),
    });
  }),
);
