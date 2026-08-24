import * as PgClient from "@effect/sql-pg/PgClient";
import {
  compareSyncEntityChanges,
  decodeInvoiceId,
  type ImportInventoryCommand,
  type ImportInventoryCommandResult,
  type IssueInvoiceCommand,
  type IssueInvoiceResult,
  type LegacyCatalogMigrationCommand,
  type LegacyCatalogMigrationResult,
  type LegacyCatalogReconciliationCommand,
  type LegacyCatalogReconciliationResult,
  MAX_SYNC_CHANGES_PER_OPERATION,
  type SyncEntityChange,
  type SyncOperation,
  legacyCatalogRowOperationId,
} from "@store/contracts";
import { syncEntityChangeKey } from "@store/contracts";
import { canonicalPayloadHash, operationPayloadHash } from "@store/contracts/operation-hash";
import { InventoryHyperdrive } from "@store/db/postgres/infra";
import {
  batches,
  categories,
  electricMutationReceipts,
  invoiceCounters,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Postgres from "alchemy/SQL/Postgres";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
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
} from "../inventory/errors";
import type { InventoryActor } from "../inventory/model";
import { decodeEntityRow, serverOwnedColumns } from "../inventory/row-validation";

export interface ElectricMutationResult {
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

const validateOperation = Effect.fn("ElectricMutation.validateOperation")(function* (
  actor: InventoryActor,
  operation: SyncOperation,
) {
  if (operation.organizationId !== actor.organizationId)
    return yield* Effect.fail(
      protocolError(
        "ORGANIZATION_MISMATCH",
        "The mutation does not belong to the active organization.",
      ),
    );
  if (operation.actorUserId !== actor.userId)
    return yield* Effect.fail(
      protocolError("ACTOR_MISMATCH", "The mutation was created by a different user."),
    );
  if (!validIdentifier(operation.operationId))
    return yield* Effect.fail(protocolError("INVALID_OPERATION", "The mutation id is invalid."));
  if (!validIdentifier(operation.deviceId))
    return yield* Effect.fail(protocolError("INVALID_DEVICE", "The device id is invalid."));
  if (!Number.isSafeInteger(operation.clientSequence) || operation.clientSequence < 1)
    return yield* Effect.fail(
      protocolError("INVALID_CLIENT_SEQUENCE", "The client sequence must be a positive integer."),
    );
  if (!Number.isSafeInteger(operation.occurredAt) || operation.occurredAt < 1)
    return yield* Effect.fail(
      protocolError("INVALID_OCCURRED_AT", "The mutation timestamp is invalid."),
    );
  if (!/^[0-9a-f]{64}$/.test(operation.payloadHash))
    return yield* Effect.fail(
      protocolError("INVALID_PAYLOAD_HASH", "The mutation payload hash is invalid."),
    );
  if (operation.changes.length === 0)
    return yield* Effect.fail(
      protocolError("EMPTY_OPERATION", "A mutation must contain a change."),
    );
  if (operation.changes.length > MAX_SYNC_CHANGES_PER_OPERATION)
    return yield* Effect.fail(
      protocolError(
        "TOO_MANY_CHANGES",
        `A mutation may contain at most ${MAX_SYNC_CHANGES_PER_OPERATION} changes.`,
      ),
    );

  const keys = new Set<string>();
  for (const change of operation.changes) {
    if (change.entity !== "category" && change.entity !== "product" && change.entity !== "batch")
      return yield* Effect.fail(
        protocolError(
          "INVALID_OPERATION",
          "This Postgres mutation endpoint currently accepts categories, products, and batches only.",
        ),
      );
    if (!validIdentifier(change.entityId))
      return yield* Effect.fail(
        protocolError("INVALID_ENTITY_ID", "A mutation entity id is invalid."),
      );
    const key = syncEntityChangeKey(change);
    if (keys.has(key))
      return yield* Effect.fail(
        protocolError("DUPLICATE_OPERATION", "A mutation may change an entity only once."),
      );
    keys.add(key);
  }

  if (operationPayloadHash(operation) !== operation.payloadHash)
    return yield* Effect.fail(
      protocolError("PAYLOAD_HASH_MISMATCH", "The mutation failed its integrity check."),
    );
});

const currentTransactionId = Effect.fn("ElectricMutation.currentTransactionId")(function* (
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

const touchMutationTarget = Effect.fn("ElectricMutation.touchTarget")(function* (
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
  operation: SyncOperation,
  change: SyncEntityChange,
  type: "stock_in" | "adjustment",
) => `batch:${operation.operationId}:${change.entityId}:${type}`;

const validateWriteVersion = Effect.fn("ElectricMutation.validateWriteVersion")(function* (
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

const applyChange = Effect.fn("ElectricMutation.applyChange")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
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
            protocolError(
              "ENTITY_CONFLICT",
              "Move products to another category before deleting this category.",
            ),
          );
      }
      const values = {
        name: row.name.trim(),
        tracksPacks: row.tracksPacks,
        ...serverOwnedColumns(actor, operation, change, row, current),
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
        .limit(1);
      yield* validateWriteVersion(change, current);
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
      }
      const values = {
        name: row.name.trim(),
        categoryId: row.categoryId,
        aisle: row.aisle,
        composition: row.composition,
        strength: row.strength,
        unitsPerPack: row.unitsPerPack,
        packPrice: row.packPrice,
        unitPrice: row.unitPrice,
        visible: row.visible,
        ...serverOwnedColumns(actor, operation, change, row, current),
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
        .limit(1);
      yield* validateWriteVersion(change, current);
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
      }
      const values = {
        productId: row.productId,
        batchNumber: row.batchNumber,
        expiresAt: row.expiresAt,
        packQuantity: row.packQuantity,
        unitQuantity: row.unitQuantity,
        ...serverOwnedColumns(actor, operation, change, row, current),
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
            id: batchMovementId(operation, change, current ? "adjustment" : "stock_in"),
            productId: row.productId,
            batchId: change.entityId,
            invoiceId: null,
            type: current ? "adjustment" : "stock_in",
            packDelta,
            unitDelta,
            note: current ? "Stock corrected" : "Initial batch stock",
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            deviceId: operation.deviceId,
            operationId: operation.operationId,
            createdAt: operation.occurredAt,
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

const applyOperation = Effect.fn("ElectricMutation.applyOperation")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  operation: SyncOperation,
  receivedAt: number,
) {
  // Serialize replays of the same operation while its receipt is being written.
  yield* tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
      actor.organizationId,
      operation.operationId,
    ])}, 0))`,
  );
  const [receipt] = yield* tx
    .select({ payloadHash: electricMutationReceipts.payloadHash })
    .from(electricMutationReceipts)
    .where(
      and(
        eq(electricMutationReceipts.organizationId, actor.organizationId),
        eq(electricMutationReceipts.operationId, operation.operationId),
      ),
    )
    .limit(1);

  const txid = yield* currentTransactionId(tx);
  if (receipt) {
    if (receipt.payloadHash !== operation.payloadHash)
      return yield* Effect.fail(
        protocolError("OPERATION_ID_REUSED", "The mutation id was reused with different content."),
      );
    const firstChange = operation.changes[0];
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
      .update(electricMutationReceipts)
      .set({ transactionId: txid })
      .where(
        and(
          eq(electricMutationReceipts.organizationId, actor.organizationId),
          eq(electricMutationReceipts.operationId, operation.operationId),
        ),
      );
    return { txid } satisfies ElectricMutationResult;
  }

  const canonicalChanges = [...operation.changes].sort(compareSyncEntityChanges);
  for (const change of canonicalChanges)
    yield* tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
        actor.organizationId,
        change.entity,
        change.entityId,
      ])}, 0))`,
    );
  for (const change of canonicalChanges) yield* applyChange(tx, actor, operation, change);

  yield* tx.insert(electricMutationReceipts).values({
    organizationId: actor.organizationId,
    operationId: operation.operationId,
    deviceId: operation.deviceId,
    actorUserId: actor.userId,
    clientSequence: operation.clientSequence,
    payloadHash: operation.payloadHash,
    transactionId: txid,
    receivedAt,
  });
  return { txid } satisfies ElectricMutationResult;
});

const excluded = (column: string) => sql.raw(`excluded.${column}`);

const versionedUpsertSet = {
  updatedByUserId: excluded("updated_by_user_id"),
  deviceId: excluded("device_id"),
  operationId: excluded("operation_id"),
  deletedAt: null,
};

const recordLegacyMigrationReceipts = (
  tx: PostgresTransaction,
  actor: InventoryActor,
  command: LegacyCatalogMigrationCommand,
  txid: number,
  receivedAt: number,
  rows: ReadonlyArray<{ readonly id: string }>,
) =>
  tx
    .insert(electricMutationReceipts)
    .values(
      rows.map((row) => ({
        organizationId: actor.organizationId,
        operationId: legacyCatalogRowOperationId(command.kind, row.id),
        deviceId: command.deviceId,
        actorUserId: actor.userId,
        clientSequence: command.occurredAt,
        payloadHash: canonicalPayloadHash({ kind: command.kind, row }),
        transactionId: txid,
        receivedAt,
      })),
    )
    .onConflictDoNothing();

const existingRowIds = (
  tx: PostgresTransaction,
  table: typeof categories | typeof products | typeof batches | typeof invoices,
  organizationId: string,
  ids: ReadonlyArray<string>,
) => {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return Effect.succeed(new Set<string>());
  return tx
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, organizationId), inArray(table.id, uniqueIds)))
    .pipe(Effect.map((rows) => new Set(rows.map((row) => row.id))));
};

const applyLegacyCatalogMigration = Effect.fn("InventoryCommand.migrateLegacyCatalog")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  command: LegacyCatalogMigrationCommand,
  receivedAt: number,
) {
  const txid = yield* currentTransactionId(tx);
  if (command.rows.length === 0)
    return { imported: 0, skipped: 0, txid } satisfies LegacyCatalogMigrationResult;

  // Receipts must not skip upserts. A previous CPU timeout can persist a
  // receipt after the catalog row was rolled back, and later invoice lines
  // then fail foreign keys against missing products or batches. Rows whose
  // parent is absent are reported as skipped instead of failing the chunk.
  const metadata = {
    organizationId: actor.organizationId,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
    deviceId: command.deviceId,
    rowVersion: 1,
    deletedAt: null,
  } as const;

  switch (command.kind) {
    case "categories": {
      yield* tx
        .insert(categories)
        .values(
          command.rows.map((category) => ({
            ...category,
            ...metadata,
            operationId: legacyCatalogRowOperationId("categories", category.id),
          })),
        )
        .onConflictDoUpdate({
          target: [categories.organizationId, categories.id],
          set: {
            name: excluded("name"),
            tracksPacks: excluded("tracks_packs"),
            updatedAt: excluded("updated_at"),
            ...versionedUpsertSet,
            rowVersion: sql`${categories.rowVersion} + 1`,
          },
        });
      yield* recordLegacyMigrationReceipts(tx, actor, command, txid, receivedAt, command.rows);
      return {
        imported: command.rows.length,
        skipped: 0,
        txid,
      } satisfies LegacyCatalogMigrationResult;
    }
    case "products": {
      const existingCategoryIds = yield* existingRowIds(
        tx,
        categories,
        actor.organizationId,
        command.rows.map((row) => row.categoryId),
      );
      const pending = command.rows.filter((row) => existingCategoryIds.has(row.categoryId));
      const skippedMissingParents = command.rows.length - pending.length;
      if (pending.length === 0)
        return {
          imported: 0,
          skipped: skippedMissingParents,
          txid,
        } satisfies LegacyCatalogMigrationResult;
      yield* tx
        .insert(products)
        .values(
          pending.map((product) => ({
            ...product,
            ...metadata,
            operationId: legacyCatalogRowOperationId("products", product.id),
          })),
        )
        .onConflictDoUpdate({
          target: [products.organizationId, products.id],
          set: {
            name: excluded("name"),
            categoryId: excluded("category_id"),
            aisle: excluded("aisle"),
            composition: excluded("composition"),
            strength: excluded("strength"),
            unitsPerPack: excluded("units_per_pack"),
            packPrice: excluded("pack_price"),
            unitPrice: excluded("unit_price"),
            visible: excluded("visible"),
            updatedAt: excluded("updated_at"),
            ...versionedUpsertSet,
            rowVersion: sql`${products.rowVersion} + 1`,
          },
        });
      yield* recordLegacyMigrationReceipts(tx, actor, command, txid, receivedAt, pending);
      return {
        imported: pending.length,
        skipped: skippedMissingParents,
        txid,
      } satisfies LegacyCatalogMigrationResult;
    }
    case "batches": {
      const existingProductIds = yield* existingRowIds(
        tx,
        products,
        actor.organizationId,
        command.rows.map((row) => row.productId),
      );
      const pending = command.rows.filter((row) => existingProductIds.has(row.productId));
      const skippedMissingParents = command.rows.length - pending.length;
      if (pending.length === 0)
        return {
          imported: 0,
          skipped: skippedMissingParents,
          txid,
        } satisfies LegacyCatalogMigrationResult;
      yield* tx
        .insert(batches)
        .values(
          pending.map((batch) => ({
            ...batch,
            ...metadata,
            operationId: legacyCatalogRowOperationId("batches", batch.id),
          })),
        )
        .onConflictDoUpdate({
          target: [batches.organizationId, batches.id],
          set: {
            productId: excluded("product_id"),
            batchNumber: excluded("batch_number"),
            expiresAt: excluded("expires_at"),
            packQuantity: excluded("pack_quantity"),
            unitQuantity: excluded("unit_quantity"),
            updatedAt: excluded("updated_at"),
            ...versionedUpsertSet,
            rowVersion: sql`${batches.rowVersion} + 1`,
          },
        });
      yield* recordLegacyMigrationReceipts(tx, actor, command, txid, receivedAt, pending);
      return {
        imported: pending.length,
        skipped: skippedMissingParents,
        txid,
      } satisfies LegacyCatalogMigrationResult;
    }
    case "invoices": {
      yield* tx
        .insert(invoices)
        .values(
          command.rows.map((invoice) => ({
            ...invoice,
            ...metadata,
            operationId: legacyCatalogRowOperationId("invoices", invoice.id),
          })),
        )
        .onConflictDoUpdate({
          target: [invoices.organizationId, invoices.id],
          set: {
            invoiceNumber: excluded("invoice_number"),
            customerName: excluded("customer_name"),
            total: excluded("total"),
            updatedAt: excluded("updated_at"),
            ...versionedUpsertSet,
            rowVersion: sql`${invoices.rowVersion} + 1`,
          },
        });
      const lastInvoiceNumber = command.rows.reduce(
        (max, invoice) => Math.max(max, invoice.invoiceNumber),
        0,
      );
      yield* tx
        .insert(invoiceCounters)
        .values({
          organizationId: actor.organizationId,
          lastInvoiceNumber,
        })
        .onConflictDoUpdate({
          target: invoiceCounters.organizationId,
          set: {
            lastInvoiceNumber: sql`greatest(${invoiceCounters.lastInvoiceNumber}, ${lastInvoiceNumber})`,
          },
        });
      yield* recordLegacyMigrationReceipts(tx, actor, command, txid, receivedAt, command.rows);
      return {
        imported: command.rows.length,
        skipped: 0,
        txid,
      } satisfies LegacyCatalogMigrationResult;
    }
    case "invoice-items": {
      const existingInvoiceIds = yield* existingRowIds(
        tx,
        invoices,
        actor.organizationId,
        command.rows.map((row) => row.invoiceId),
      );
      const existingProductIds = yield* existingRowIds(
        tx,
        products,
        actor.organizationId,
        command.rows.map((row) => row.productId),
      );
      const existingBatchIds = yield* existingRowIds(
        tx,
        batches,
        actor.organizationId,
        command.rows.map((row) => row.batchId),
      );
      const pending = command.rows.filter(
        (row) =>
          existingInvoiceIds.has(row.invoiceId) &&
          existingProductIds.has(row.productId) &&
          existingBatchIds.has(row.batchId),
      );
      const skippedMissingParents = command.rows.length - pending.length;
      if (pending.length === 0)
        return {
          imported: 0,
          skipped: skippedMissingParents,
          txid,
        } satisfies LegacyCatalogMigrationResult;
      yield* tx
        .insert(invoiceItems)
        .values(
          pending.map((invoiceItem) => ({
            ...invoiceItem,
            ...metadata,
            operationId: legacyCatalogRowOperationId("invoice-items", invoiceItem.id),
          })),
        )
        .onConflictDoUpdate({
          target: [invoiceItems.organizationId, invoiceItems.id],
          set: {
            invoiceId: excluded("invoice_id"),
            productId: excluded("product_id"),
            batchId: excluded("batch_id"),
            productName: excluded("product_name"),
            batchNumber: excluded("batch_number"),
            quantity: excluded("quantity"),
            quantityType: excluded("quantity_type"),
            baseUnitQuantity: excluded("base_unit_quantity"),
            salePrice: excluded("sale_price"),
            updatedAt: excluded("updated_at"),
            ...versionedUpsertSet,
            rowVersion: sql`${invoiceItems.rowVersion} + 1`,
          },
        });
      yield* recordLegacyMigrationReceipts(tx, actor, command, txid, receivedAt, pending);
      return {
        imported: pending.length,
        skipped: skippedMissingParents,
        txid,
      } satisfies LegacyCatalogMigrationResult;
    }
    case "stock-movements": {
      const existingProductIds = yield* existingRowIds(
        tx,
        products,
        actor.organizationId,
        command.rows.map((row) => row.productId),
      );
      const existingBatchIds = yield* existingRowIds(
        tx,
        batches,
        actor.organizationId,
        command.rows.map((row) => row.batchId),
      );
      const existingInvoiceIds = yield* existingRowIds(
        tx,
        invoices,
        actor.organizationId,
        command.rows.flatMap((row) => (row.invoiceId ? [row.invoiceId] : [])),
      );
      const pending = command.rows.filter(
        (row) =>
          existingProductIds.has(row.productId) &&
          existingBatchIds.has(row.batchId) &&
          (row.invoiceId === null || existingInvoiceIds.has(row.invoiceId)),
      );
      const skippedMissingParents = command.rows.length - pending.length;
      if (pending.length === 0)
        return {
          imported: 0,
          skipped: skippedMissingParents,
          txid,
        } satisfies LegacyCatalogMigrationResult;
      yield* tx
        .insert(stockMovements)
        .values(
          pending.map((stockMovement) => ({
            ...stockMovement,
            organizationId: actor.organizationId,
            actorUserId: actor.userId,
            deviceId: command.deviceId,
            operationId: legacyCatalogRowOperationId("stock-movements", stockMovement.id),
          })),
        )
        .onConflictDoUpdate({
          target: [stockMovements.organizationId, stockMovements.id],
          set: {
            productId: excluded("product_id"),
            batchId: excluded("batch_id"),
            invoiceId: excluded("invoice_id"),
            type: excluded("type"),
            packDelta: excluded("pack_delta"),
            unitDelta: excluded("unit_delta"),
            note: excluded("note"),
            createdAt: excluded("created_at"),
            actorUserId: excluded("actor_user_id"),
            deviceId: excluded("device_id"),
            operationId: excluded("operation_id"),
          },
        });
      yield* recordLegacyMigrationReceipts(tx, actor, command, txid, receivedAt, pending);
      return {
        imported: pending.length,
        skipped: skippedMissingParents,
        txid,
      } satisfies LegacyCatalogMigrationResult;
    }
  }
});

const reconcileLegacyCatalog = Effect.fn("InventoryCommand.reconcileLegacyCatalog")(function* (
  tx: PostgresTransaction,
  actor: InventoryActor,
  command: LegacyCatalogReconciliationCommand,
) {
  const txid = yield* currentTransactionId(tx);
  const catalogSize =
    command.categoryIds.length +
    command.productIds.length +
    command.batchIds.length +
    command.invoiceIds.length +
    command.invoiceItemIds.length +
    command.stockMovementIds.length;
  if (catalogSize === 0)
    return {
      deletedCategories: 0,
      deletedProducts: 0,
      deletedBatches: 0,
      deletedInvoices: 0,
      deletedInvoiceItems: 0,
      deletedStockMovements: 0,
      txid,
    } satisfies LegacyCatalogReconciliationResult;
  const operationId = `legacy-reconcile:${command.deviceId}:v3`;
  const [receipt] = yield* tx
    .select({ operationId: electricMutationReceipts.operationId })
    .from(electricMutationReceipts)
    .where(
      and(
        eq(electricMutationReceipts.organizationId, actor.organizationId),
        eq(electricMutationReceipts.operationId, operationId),
      ),
    )
    .limit(1);
  if (receipt)
    return {
      deletedCategories: 0,
      deletedProducts: 0,
      deletedBatches: 0,
      deletedInvoices: 0,
      deletedInvoiceItems: 0,
      deletedStockMovements: 0,
      txid,
    } satisfies LegacyCatalogReconciliationResult;
  const deletedAt = command.occurredAt;
  const deletedStockMovements =
    command.stockMovementIds.length === 0
      ? []
      : yield* tx
          .delete(stockMovements)
          .where(
            and(
              eq(stockMovements.organizationId, actor.organizationId),
              notInArray(stockMovements.id, [...command.stockMovementIds]),
            ),
          )
          .returning({ id: stockMovements.id });
  const deletedInvoiceItems =
    command.invoiceItemIds.length === 0
      ? []
      : yield* tx
          .update(invoiceItems)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            updatedByUserId: actor.userId,
            deviceId: command.deviceId,
            operationId,
            rowVersion: sql`${invoiceItems.rowVersion} + 1`,
          })
          .where(
            and(
              eq(invoiceItems.organizationId, actor.organizationId),
              isNull(invoiceItems.deletedAt),
              notInArray(invoiceItems.id, [...command.invoiceItemIds]),
            ),
          )
          .returning({ id: invoiceItems.id });
  const deletedInvoices =
    command.invoiceIds.length === 0
      ? []
      : yield* tx
          .update(invoices)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            updatedByUserId: actor.userId,
            deviceId: command.deviceId,
            operationId,
            rowVersion: sql`${invoices.rowVersion} + 1`,
          })
          .where(
            and(
              eq(invoices.organizationId, actor.organizationId),
              isNull(invoices.deletedAt),
              notInArray(invoices.id, [...command.invoiceIds]),
            ),
          )
          .returning({ id: invoices.id });
  const deletedBatches =
    command.batchIds.length === 0
      ? []
      : yield* tx
          .update(batches)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            updatedByUserId: actor.userId,
            deviceId: command.deviceId,
            operationId,
            rowVersion: sql`${batches.rowVersion} + 1`,
          })
          .where(
            and(
              eq(batches.organizationId, actor.organizationId),
              isNull(batches.deletedAt),
              notInArray(batches.id, [...command.batchIds]),
            ),
          )
          .returning({ id: batches.id });
  const deletedProducts =
    command.productIds.length === 0
      ? []
      : yield* tx
          .update(products)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            updatedByUserId: actor.userId,
            deviceId: command.deviceId,
            operationId,
            rowVersion: sql`${products.rowVersion} + 1`,
          })
          .where(
            and(
              eq(products.organizationId, actor.organizationId),
              isNull(products.deletedAt),
              notInArray(products.id, [...command.productIds]),
            ),
          )
          .returning({ id: products.id });
  const deletedCategories =
    command.categoryIds.length === 0
      ? []
      : yield* tx
          .update(categories)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            updatedByUserId: actor.userId,
            deviceId: command.deviceId,
            operationId,
            rowVersion: sql`${categories.rowVersion} + 1`,
          })
          .where(
            and(
              eq(categories.organizationId, actor.organizationId),
              isNull(categories.deletedAt),
              notInArray(categories.id, [...command.categoryIds]),
            ),
          )
          .returning({ id: categories.id });
  yield* tx.insert(electricMutationReceipts).values({
    organizationId: actor.organizationId,
    operationId,
    deviceId: command.deviceId,
    actorUserId: actor.userId,
    clientSequence: command.occurredAt,
    payloadHash: canonicalPayloadHash(command),
    transactionId: txid,
    receivedAt: command.occurredAt,
  });
  return {
    deletedCategories: deletedCategories.length,
    deletedProducts: deletedProducts.length,
    deletedBatches: deletedBatches.length,
    deletedInvoices: deletedInvoices.length,
    deletedInvoiceItems: deletedInvoiceItems.length,
    deletedStockMovements: deletedStockMovements.length,
    txid,
  } satisfies LegacyCatalogReconciliationResult;
});

const invoiceError = (message: string) => protocolError("ENTITY_CONFLICT", message);

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

const normalizedProductName = (value: string) => value.trim().toLocaleLowerCase();
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
    const packPrice = line.packPrice ?? null;
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
      packPrice !== null &&
      (!Number.isSafeInteger(packPrice) || packPrice < 0 || packPrice > POSTGRES_INTEGER_MAX)
    )
      return yield* Effect.fail(importError("Pack prices cannot be negative."));
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
      payloadHash: electricMutationReceipts.payloadHash,
      commandResult: electricMutationReceipts.commandResult,
    })
    .from(electricMutationReceipts)
    .where(
      and(
        eq(electricMutationReceipts.organizationId, actor.organizationId),
        eq(electricMutationReceipts.operationId, command.commandId),
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
      .update(electricMutationReceipts)
      .set({ transactionId: txid })
      .where(
        and(
          eq(electricMutationReceipts.organizationId, actor.organizationId),
          eq(electricMutationReceipts.operationId, command.commandId),
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

  const suppliedProductIds = [
    ...new Set(
      command.input.lines.flatMap((line) => (line.productId === null ? [] : [line.productId])),
    ),
  ].sort();
  const requestedNames = [
    ...new Set(
      command.input.lines.flatMap((line) =>
        line.productId === null ? [normalizedProductName(line.name)] : [],
      ),
    ),
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
        .select({ id: products.id, name: products.name })
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
  const productIdsByName = new Map<string, string>();
  for (const product of existingProducts) {
    const name = normalizedProductName(product.name);
    if (!productIdsByName.has(name)) productIdsByName.set(name, product.id);
  }
  for (const id of suppliedProductIds)
    if (!productsById.has(id))
      return yield* Effect.fail(importError("One of the selected products no longer exists."));

  let createdProducts = 0;
  let createdBatches = 0;
  let observerProductId: string | null = null;
  let observerBatchId: string | null = null;

  for (const line of command.input.lines) {
    let productId: string | null = line.productId;
    if (productId === null) {
      const normalizedName = normalizedProductName(line.name);
      const existingProductId = productIdsByName.get(normalizedName);
      if (existingProductId) {
        productId = existingProductId;
      } else {
        const [created] = yield* tx
          .insert(products)
          .values({
            name: line.name.trim(),
            categoryId: command.input.categoryId,
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: line.unitsPerPack ?? 1,
            packPrice: line.packPrice ?? null,
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
          .returning({ id: products.id });
        if (!created)
          return yield* Effect.fail(importError("An imported product could not be created."));
        productId = created.id;
        productIdsByName.set(normalizedName, productId);
        observerProductId ??= productId;
        createdProducts += 1;
      }
    }

    const packQuantity = line.packQuantity ?? 0;
    const unitQuantity = line.unitQuantity ?? 0;
    if (packQuantity + unitQuantity === 0) continue;

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
  yield* tx.insert(electricMutationReceipts).values({
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
    .select({ payloadHash: electricMutationReceipts.payloadHash })
    .from(electricMutationReceipts)
    .where(
      and(
        eq(electricMutationReceipts.organizationId, actor.organizationId),
        eq(electricMutationReceipts.operationId, command.commandId),
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
      .update(electricMutationReceipts)
      .set({ transactionId: txid })
      .where(
        and(
          eq(electricMutationReceipts.organizationId, actor.organizationId),
          eq(electricMutationReceipts.operationId, command.commandId),
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

  const [counter] = yield* tx
    .insert(invoiceCounters)
    .values({ organizationId: actor.organizationId, lastInvoiceNumber: 1 })
    .onConflictDoUpdate({
      target: invoiceCounters.organizationId,
      set: { lastInvoiceNumber: sql`${invoiceCounters.lastInvoiceNumber} + 1` },
    })
    .returning({ invoiceNumber: invoiceCounters.lastInvoiceNumber });
  if (!counter) {
    return yield* Effect.fail(invoiceError("The invoice number could not be allocated."));
  }

  const total = command.input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
  const [invoice] = yield* tx
    .insert(invoices)
    .values({
      invoiceNumber: counter.invoiceNumber,
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
    })
    .returning({ id: invoices.id, invoiceNumber: invoices.invoiceNumber });
  if (!invoice) return yield* Effect.fail(invoiceError("The invoice could not be created."));

  for (const line of command.input.items) {
    const [product] = yield* tx
      .select()
      .from(products)
      .where(
        and(
          eq(products.organizationId, actor.organizationId),
          eq(products.id, line.productId),
          isNull(products.deletedAt),
        ),
      )
      .limit(1);
    if (!product) {
      return yield* Effect.fail(invoiceError("One of the products no longer exists."));
    }

    const availableBatches = yield* tx
      .select()
      .from(batches)
      .where(
        and(
          eq(batches.organizationId, actor.organizationId),
          eq(batches.productId, line.productId),
          isNull(batches.deletedAt),
        ),
      )
      .orderBy(sql`${batches.expiresAt} asc nulls last`, asc(batches.createdAt))
      .for("update");
    const candidates = line.batchId
      ? availableBatches.filter((batch) => batch.id === line.batchId)
      : availableBatches.filter((batch) =>
          line.quantityType === "pack"
            ? batch.packQuantity > 0
            : batch.packQuantity * product.unitsPerPack + batch.unitQuantity > 0,
        );
    if (line.batchId && candidates.length === 0) {
      return yield* Effect.fail(invoiceError(`The selected batch for ${product.name} is gone.`));
    }
    const available = candidates.reduce(
      (sum, batch) =>
        sum +
        (line.quantityType === "pack"
          ? batch.packQuantity
          : batch.packQuantity * product.unitsPerPack + batch.unitQuantity),
      0,
    );
    if (available < line.quantity) {
      return yield* Effect.fail(
        invoiceError(
          `Not enough stock for ${product.name}: ${available} available, ${line.quantity} requested.`,
        ),
      );
    }

    let remaining = line.quantity;
    for (const batch of candidates) {
      if (remaining === 0) break;
      const batchAvailable =
        line.quantityType === "pack"
          ? batch.packQuantity
          : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;
      const taken = Math.min(batchAvailable, remaining);
      remaining -= taken;
      const packsOpened =
        line.quantityType === "unit"
          ? Math.max(0, Math.ceil((taken - batch.unitQuantity) / product.unitsPerPack))
          : 0;
      const nextPackQuantity =
        line.quantityType === "pack"
          ? batch.packQuantity - taken
          : batch.packQuantity - packsOpened;
      const nextUnitQuantity =
        line.quantityType === "pack"
          ? batch.unitQuantity
          : batch.unitQuantity + packsOpened * product.unitsPerPack - taken;

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
          invoiceId: invoice.id,
          productId: product.id,
          batchId: batch.id,
          productName: product.name,
          batchNumber: batch.batchNumber,
          quantity: taken,
          quantityType: line.quantityType,
          baseUnitQuantity: taken * (line.quantityType === "pack" ? product.unitsPerPack : 1),
          salePrice: line.salePrice,
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

      if (packsOpened > 0) {
        yield* tx.insert(stockMovements).values({
          productId: product.id,
          batchId: batch.id,
          invoiceId: invoice.id,
          type: "open_pack",
          packDelta: -packsOpened,
          unitDelta: packsOpened * product.unitsPerPack,
          note: `Opened for invoice #${counter.invoiceNumber}`,
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          deviceId: command.deviceId,
          operationId: command.commandId,
          createdAt: command.occurredAt,
        });
      }
      yield* tx.insert(stockMovements).values({
        productId: product.id,
        batchId: batch.id,
        invoiceId: invoice.id,
        type: "sale",
        packDelta: line.quantityType === "pack" ? -taken : 0,
        unitDelta: line.quantityType === "unit" ? -taken : 0,
        note: `Invoice #${counter.invoiceNumber}`,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      });
    }
  }

  yield* tx.insert(electricMutationReceipts).values({
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

export const makeElectricMutationDatabase = (db: PostgresDrizzle) =>
  Effect.fn("ElectricMutationDatabase.write")(
    function* (actor: InventoryActor, operation: SyncOperation) {
      yield* validateOperation(actor, operation);
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* db.transaction((tx) => applyOperation(tx, actor, operation, receivedAt));
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

export const makeLegacyCatalogMigrationDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryCommandDatabase.migrateLegacyCatalog")(
    function* (actor: InventoryActor, command: LegacyCatalogMigrationCommand) {
      const receivedAt = yield* Clock.currentTimeMillis;
      return yield* db.transaction((tx) =>
        applyLegacyCatalogMigration(tx, actor, command, receivedAt),
      );
    },
    Effect.mapError((cause) =>
      cause instanceof InventoryProtocolError || cause instanceof InventoryDatabaseError
        ? cause
        : databaseError(cause),
    ),
  );

export const makeLegacyCatalogReconciliationDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryCommandDatabase.reconcileLegacyCatalog")(
    function* (actor: InventoryActor, command: LegacyCatalogReconciliationCommand) {
      return yield* db.transaction((tx) => reconcileLegacyCatalog(tx, actor, command));
    },
    Effect.mapError((cause) =>
      cause instanceof InventoryProtocolError || cause instanceof InventoryDatabaseError
        ? cause
        : databaseError(cause),
    ),
  );

export type ElectricMutationWriter = ReturnType<typeof makeElectricMutationDatabase>;

export class ElectricMutationDatabase extends Context.Service<
  ElectricMutationDatabase,
  {
    readonly write: ElectricMutationWriter;
    readonly importInventory: ReturnType<typeof makeInventoryImportCommandDatabase>;
    readonly migrateLegacyCatalog: ReturnType<typeof makeLegacyCatalogMigrationDatabase>;
    readonly reconcileLegacyCatalog: ReturnType<typeof makeLegacyCatalogReconciliationDatabase>;
    readonly issueInvoice: ReturnType<typeof makeInvoiceCommandDatabase>;
  }
>()("@store/server/ElectricMutationDatabase") {}

export const ElectricMutationDatabaseLive = Layer.effect(
  ElectricMutationDatabase,
  Effect.gen(function* () {
    const inventoryHyperdrive = yield* InventoryHyperdrive;
    const hyperdrive = yield* Cloudflare.Hyperdrive.Connect(inventoryHyperdrive);
    const postgres = yield* Postgres.Postgres({
      url: hyperdrive.connectionString,
      maxConnections: 1,
      applicationName: "tabaaq-electric-mutations",
    });
    const db = yield* makePostgresDrizzle(postgres);
    return ElectricMutationDatabase.of({
      write: makeElectricMutationDatabase(db),
      importInventory: makeInventoryImportCommandDatabase(db),
      migrateLegacyCatalog: makeLegacyCatalogMigrationDatabase(db),
      reconcileLegacyCatalog: makeLegacyCatalogReconciliationDatabase(db),
      issueInvoice: makeInvoiceCommandDatabase(db),
    });
  }),
);
