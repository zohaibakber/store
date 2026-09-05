import {
  allocationsCoverInput,
  decodeInvoiceId,
  nextInvoiceNumber,
  takeBatchStock,
  type IssueInvoiceCommand,
  type IssueInvoiceResult,
} from "@store/contracts";
import { canonicalPayloadHash } from "@store/contracts/operation-hash";
import {
  batches,
  inventoryMutationReceipts,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { appendCatalogChanges } from "./catalog-log";
import { withCatalogTransaction } from "./catalog-transaction";
import { inventoryProtocolError as protocolError } from "./errors";
import type { InventoryActor } from "./model";
import { changesForOperation } from "./operation-changes";
import { databaseError, type PostgresDrizzle, type PostgresTransaction } from "./postgres";
const DriverInvoiceNumber = Schema.Union([Schema.Number, Schema.NumberFromString]);
const decodeDriverInvoiceNumber = Schema.decodeUnknownSync(DriverInvoiceNumber);

const invoiceError = (message: string) => protocolError("INVALID_OPERATION", message);
const invoiceStockError = (message: string) => protocolError("INSUFFICIENT_STOCK", message);

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
    .select({
      payloadHash: inventoryMutationReceipts.payloadHash,
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
    return {
      invoiceId: decodeInvoiceId(invoice.id),
      invoiceNumber: decodeDriverInvoiceNumber(invoice.invoiceNumber),
      txid: receipt.transactionId,
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
        lastInvoiceNumber: sql`coalesce(max(${invoices.invoiceNumber}), 0)`.mapWith(Number),
      })
      .from(invoices)
      .where(eq(invoices.organizationId, actor.organizationId));
    const [retry] = yield* tx
      .insert(invoices)
      .values(
        invoiceValues(
          nextInvoiceNumber([decodeDriverInvoiceNumber(latest?.lastInvoiceNumber ?? 0)]),
        ),
      )
      .onConflictDoNothing({
        target: [invoices.organizationId, invoices.invoiceNumber],
      })
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

    const { packsOpened, nextPackQuantity, nextUnitQuantity } = yield* Effect.fromResult(
      takeBatchStock({
        stock: batch,
        unitsPerPack: product.unitsPerPack,
        quantity: take.quantity,
        quantityType: take.quantityType,
      }),
    ).pipe(
      Effect.mapError(({ available, requested }) =>
        invoiceStockError(
          `Not enough stock for ${product.name}: ${available} available, ${requested} requested.`,
        ),
      ),
    );
    if (packsOpened !== take.packsOpened) {
      return yield* Effect.fail(
        invoiceStockError(`Not enough stock for ${product.name}: pack layout changed.`),
      );
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

    if (packsOpened > 0) {
      if (!take.openPackMovementId) {
        return yield* Effect.fail(invoiceError("The invoice item could not be saved."));
      }
      yield* tx.insert(stockMovements).values({
        id: take.openPackMovementId,
        productId: product.id,
        batchId: batch.id,
        invoiceId: invoice.id,
        type: "open_pack",
        packDelta: -packsOpened,
        unitDelta: packsOpened * product.unitsPerPack,
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
  });
  return {
    invoiceId: decodeInvoiceId(invoice.id),
    invoiceNumber: decodeDriverInvoiceNumber(invoice.invoiceNumber),
    txid,
  } satisfies IssueInvoiceResult;
});

export const makeInvoiceCommandDatabase = (db: PostgresDrizzle) =>
  Effect.fn("InventoryCommandDatabase.issueInvoice")(function* (
    actor: InventoryActor,
    command: IssueInvoiceCommand,
  ) {
    const receivedAt = yield* Clock.currentTimeMillis;
    return yield* withCatalogTransaction(db, actor.organizationId, (tx) =>
      issueInvoice(tx, actor, command, receivedAt),
    );
  }, Effect.mapError(databaseError));
