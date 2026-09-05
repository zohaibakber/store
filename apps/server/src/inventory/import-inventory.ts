import {
  type ImportInventoryCommand,
  type ImportInventoryCommandResult,
  inventorySkuKey,
  normalizedProductName,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  batches,
  categories,
  inventoryMutationReceipts,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { appendCatalogChanges } from "./catalog-log";
import { withCatalogTransaction } from "./catalog-transaction";
import { inventoryProtocolError as protocolError } from "./errors";
import type { InventoryActor } from "./model";
import { changesForOperation } from "./operation-changes";
import { databaseError, type PostgresDrizzle, type PostgresTransaction } from "./postgres";
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
      transactionId: inventoryMutationReceipts.transactionId,
    })
    .from(inventoryMutationReceipts)
    .where(
      and(
        eq(inventoryMutationReceipts.organizationId, actor.organizationId),
        eq(inventoryMutationReceipts.operationId, command.commandId),
      ),
    )
    .limit(1);

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
    return {
      createdProducts: saved.createdProducts,
      createdBatches: saved.createdBatches,
      txid: receipt.transactionId,
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
  const changes = yield* changesForOperation(tx, actor.organizationId, command.commandId);
  const txid = yield* appendCatalogChanges(tx, actor.organizationId, changes, receivedAt);
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

export const makeInventoryImportCommandDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryCommandDatabase.importInventory")(function* (
    actor: InventoryActor,
    command: ImportInventoryCommand,
  ) {
    const receivedAt = yield* Clock.currentTimeMillis;
    return yield* withCatalogTransaction(db, actor.organizationId, (tx) =>
      importInventory(tx, actor, command, receivedAt),
    );
  }, Effect.mapError(databaseError));
