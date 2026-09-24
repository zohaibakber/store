import {
  allocationsCoverInput,
  nextInvoiceNumber,
  type AcceptedInvoiceResult,
  type IssueInvoiceCommand,
  type SyncLogChange,
} from "@store/contracts";
import {
  batches,
  invoiceItems,
  invoices,
  products,
  stockMovements,
} from "@store/db/postgres/schema";
import { and, eq, max } from "drizzle-orm";
import * as Effect from "effect/Effect";

import type { InventoryActor } from "./model";
import { protocol, type InventoryTransaction } from "./postgres";

type IssuedInvoice = {
  readonly result: AcceptedInvoiceResult;
  readonly changes: ReadonlyArray<SyncLogChange>;
};

export const issueInvoice = Effect.fn("InventoryCommands.issueInvoice")(function* (
  tx: InventoryTransaction,
  actor: InventoryActor,
  command: IssueInvoiceCommand,
) {
  if (command.input.items.length === 0) {
    return yield* protocol("INVALID_OPERATION", "Add at least one item to the sale.");
  }
  if (!allocationsCoverInput(command.input, command.allocations)) {
    return yield* protocol("INVALID_OPERATION", "The sale allocations do not match the items.");
  }

  const [existingInvoice] = yield* tx
    .select({ operationId: invoices.operationId })
    .from(invoices)
    .where(
      and(eq(invoices.organizationId, actor.organizationId), eq(invoices.id, command.invoiceId)),
    )
    .limit(1);
  if (existingInvoice && existingInvoice.operationId !== command.commandId) {
    return yield* protocol("INVOICE_IDENTITY_CONFLICT", "This invoice id is already in use.");
  }

  type BatchRow = typeof batches.$inferSelect;
  type TakePlan = {
    readonly take: (typeof command.allocations)[number];
    readonly product: typeof products.$inferSelect;
    readonly batch: BatchRow;
    readonly nextPackQuantity: number;
    readonly nextUnitQuantity: number;
    readonly packsOpened: number;
  };
  const plans: TakePlan[] = [];
  const working = new Map<string, BatchRow>();
  for (const take of command.allocations) {
    const [product] = yield* tx
      .select()
      .from(products)
      .where(
        and(eq(products.organizationId, actor.organizationId), eq(products.id, take.productId)),
      )
      .limit(1);
    if (!product || product.deletedAt !== null) {
      return yield* protocol("INSUFFICIENT_STOCK", "One of the products no longer exists.");
    }
    const current =
      working.get(take.batchId) ??
      (yield* tx
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.organizationId, actor.organizationId),
            eq(batches.id, take.batchId),
            eq(batches.productId, product.id),
          ),
        )
        .limit(1))[0];
    if (!current || current.deletedAt !== null) {
      return yield* protocol(
        "INSUFFICIENT_STOCK",
        `The selected batch for ${product.name} is gone.`,
      );
    }
    const available =
      take.quantityType === "pack"
        ? current.packQuantity
        : current.packQuantity * product.unitsPerPack + current.unitQuantity;
    if (available < take.quantity) {
      return yield* protocol(
        "INSUFFICIENT_STOCK",
        `Not enough stock for ${product.name}: ${available} available, ${take.quantity} requested.`,
      );
    }
    const packsOpened =
      take.quantityType === "unit"
        ? Math.max(0, Math.ceil((take.quantity - current.unitQuantity) / product.unitsPerPack))
        : 0;
    const nextPackQuantity =
      take.quantityType === "pack"
        ? current.packQuantity - take.quantity
        : current.packQuantity - packsOpened;
    const nextUnitQuantity =
      take.quantityType === "pack"
        ? current.unitQuantity
        : current.unitQuantity + packsOpened * product.unitsPerPack - take.quantity;
    if (nextPackQuantity < 0 || nextUnitQuantity < 0) {
      return yield* protocol("INSUFFICIENT_STOCK", `Not enough stock for ${product.name}.`);
    }
    const nextBatch = {
      ...current,
      packQuantity: nextPackQuantity,
      unitQuantity: nextUnitQuantity,
    };
    working.set(take.batchId, nextBatch);
    plans.push({ take, product, batch: current, nextPackQuantity, nextUnitQuantity, packsOpened });
  }

  const total = command.input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
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
  });
  const inserted = yield* tx
    .insert(invoices)
    .values(invoiceValues(command.invoiceNumber))
    .onConflictDoNothing({
      target: [invoices.organizationId, invoices.invoiceNumber],
    })
    .returning();
  let invoice = inserted[0];
  if (!invoice) {
    const [latest] = yield* tx
      .select({
        lastInvoiceNumber: max(invoices.invoiceNumber),
      })
      .from(invoices)
      .where(eq(invoices.organizationId, actor.organizationId));
    const [retry] = yield* tx
      .insert(invoices)
      .values(invoiceValues(nextInvoiceNumber([latest?.lastInvoiceNumber ?? 0])))
      .onConflictDoNothing({
        target: [invoices.organizationId, invoices.invoiceNumber],
      })
      .returning();
    invoice = retry;
  }
  if (!invoice) {
    return yield* protocol("ENTITY_WRITE_FAILED", "The invoice could not be created.");
  }

  const changes: SyncLogChange[] = [
    {
      entity: "invoice",
      action: "upsert",
      entityId: invoice.id,
      rowVersion: invoice.rowVersion,
      row: invoice,
    },
  ];

  for (const plan of plans) {
    const [updatedBatch] = yield* tx
      .update(batches)
      .set({
        packQuantity: plan.nextPackQuantity,
        unitQuantity: plan.nextUnitQuantity,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: plan.batch.rowVersion + 1,
        updatedAt: command.occurredAt,
      })
      .where(and(eq(batches.organizationId, actor.organizationId), eq(batches.id, plan.batch.id)))
      .returning();
    if (!updatedBatch) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The batch could not be updated.");
    }
    const [itemRow] = yield* tx
      .insert(invoiceItems)
      .values({
        id: plan.take.invoiceItemId,
        invoiceId: invoice.id,
        productId: plan.product.id,
        batchId: plan.batch.id,
        productName: plan.product.name,
        batchNumber: plan.batch.batchNumber,
        quantity: plan.take.quantity,
        quantityType: plan.take.quantityType,
        baseUnitQuantity:
          plan.take.quantity * (plan.take.quantityType === "pack" ? plan.product.unitsPerPack : 1),
        salePrice: plan.take.salePrice,
        organizationId: actor.organizationId,
        createdByUserId: actor.userId,
        updatedByUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        rowVersion: 1,
        createdAt: command.occurredAt,
        updatedAt: command.occurredAt,
      })
      .returning();
    if (!itemRow) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The invoice item could not be created.");
    }
    changes.push(
      {
        entity: "batch",
        action: "upsert",
        entityId: updatedBatch.id,
        rowVersion: updatedBatch.rowVersion,
        row: updatedBatch,
      },
      {
        entity: "invoiceItem",
        action: "upsert",
        entityId: itemRow.id,
        rowVersion: itemRow.rowVersion,
        row: itemRow,
      },
    );
    if (plan.packsOpened > 0) {
      const [openPack] = yield* tx
        .insert(stockMovements)
        .values({
          id: plan.take.openPackMovementId ?? `${plan.take.saleMovementId}:open-pack`,
          productId: plan.product.id,
          batchId: plan.batch.id,
          invoiceId: invoice.id,
          type: "open_pack",
          packDelta: -plan.packsOpened,
          unitDelta: plan.packsOpened * plan.product.unitsPerPack,
          note: `Opened for invoice #${invoice.invoiceNumber}`,
          organizationId: actor.organizationId,
          actorUserId: actor.userId,
          deviceId: command.deviceId,
          operationId: command.commandId,
          createdAt: command.occurredAt,
        })
        .returning();
      if (!openPack) {
        return yield* protocol("ENTITY_WRITE_FAILED", "The pack opening could not be recorded.");
      }
      changes.push({
        entity: "stockMovement",
        action: "upsert",
        entityId: openPack.id,
        rowVersion: 1,
        row: openPack,
      });
    }
    const [saleMovement] = yield* tx
      .insert(stockMovements)
      .values({
        id: plan.take.saleMovementId,
        productId: plan.product.id,
        batchId: plan.batch.id,
        invoiceId: invoice.id,
        type: "sale",
        packDelta: plan.take.quantityType === "pack" ? -plan.take.quantity : 0,
        unitDelta: plan.take.quantityType === "unit" ? -plan.take.quantity : 0,
        note: `Invoice #${invoice.invoiceNumber}`,
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        deviceId: command.deviceId,
        operationId: command.commandId,
        createdAt: command.occurredAt,
      })
      .returning();
    if (!saleMovement) {
      return yield* protocol("ENTITY_WRITE_FAILED", "The sale could not be recorded.");
    }
    changes.push({
      entity: "stockMovement",
      action: "upsert",
      entityId: saleMovement.id,
      rowVersion: 1,
      row: saleMovement,
    });
  }

  return {
    result: {
      _tag: "issueInvoice",
      invoiceId: command.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
    },
    changes,
  } satisfies IssuedInvoice;
});
