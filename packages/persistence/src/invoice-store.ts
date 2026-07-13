import type { CreateInvoiceInput, Invoice, SyncEntityChange } from "@store/contracts";
import { batches, invoiceItems, invoices, stockMovements } from "@store/db/schema";
import { and, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import type { MutationContext } from "./config";
import type { StoreDatabase, StoreTransaction } from "./database";
import { InvoiceNotFoundError, PersistenceError, mapPersistenceError } from "./errors";
import { byEarliestExpiry, toInvoice } from "./models";
import { enqueueOperation } from "./outbox";

export interface InvoiceStore {
  readonly listInvoices: Effect.Effect<ReadonlyArray<Invoice>, PersistenceError>;
  readonly getInvoice: (
    id: string,
  ) => Effect.Effect<Invoice, PersistenceError | InvoiceNotFoundError>;
  readonly createInvoice: (input: CreateInvoiceInput) => Effect.Effect<Invoice, PersistenceError>;
}

interface Allocation {
  readonly productId: string;
  readonly productName: string;
  readonly batchId: string;
  readonly batchNumber: string | null;
  readonly quantity: number;
  readonly quantityType: "unit" | "pack";
  readonly baseUnitQuantity: number;
  readonly salePrice: number;
}

const invalidInvoice = (message: string) =>
  PersistenceError.make({ operation: "create invoice", message });

const movementChange = (
  transaction: StoreTransaction,
  values: typeof stockMovements.$inferInsert,
) =>
  Effect.gen(function* () {
    const [movement] = yield* transaction.insert(stockMovements).values(values).returning();
    if (!movement) return yield* invalidInvoice("The stock movement could not be recorded");
    return {
      entity: "stockMovement",
      action: "upsert",
      entityId: movement.id,
      rowVersion: 1,
      row: movement,
    } satisfies SyncEntityChange;
  });

export const makeInvoiceStore = (
  database: StoreDatabase,
  mutationContext: () => MutationContext,
  signalSync: Effect.Effect<void>,
): InvoiceStore => {
  const listInvoices = Effect.suspend(() => {
    const actor = mutationContext();
    return database.query.invoices
      .findMany({
        orderBy: { createdAt: "desc" },
        where: { organizationId: actor.organizationId, deletedAt: { isNull: true } },
        with: { items: true },
      })
      .pipe(
        Effect.map((rows) => rows.map(toInvoice)),
        mapPersistenceError("list invoices"),
      );
  });

  const getInvoice = Effect.fn("OfflineStore.getInvoice")(function* (id: string) {
    const actor = mutationContext();
    const row = yield* database.query.invoices
      .findFirst({
        where: { organizationId: actor.organizationId, id, deletedAt: { isNull: true } },
        with: { items: true },
      })
      .pipe(mapPersistenceError("find invoice"));
    if (!row) return yield* InvoiceNotFoundError.make({ id });
    return toInvoice(row);
  });

  const createInvoice = Effect.fn("OfflineStore.createInvoice")(function* (
    input: CreateInvoiceInput,
  ) {
    if (input.items.length === 0) return yield* invalidInvoice("Add at least one item to the sale");
    for (const line of input.items) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1)
        return yield* invalidInvoice("Quantities must be whole numbers of 1 or more");
      if (!Number.isInteger(line.salePrice) || line.salePrice < 0)
        return yield* invalidInvoice("Sale prices cannot be negative");
    }

    const occurredAt = Date.now();
    const actor = mutationContext();
    const operationId = crypto.randomUUID();
    const created = yield* database
      .transaction((transaction) =>
        Effect.gen(function* () {
          const allocations: Allocation[] = [];
          const changes: SyncEntityChange[] = [];
          const id = crypto.randomUUID();
          const devicePrefix = actor.deviceId.replace(/-/g, "").slice(0, 8) || "local";
          const invoiceNumber = `${devicePrefix}-${operationId}`;
          const total = input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
          const [invoice] = yield* transaction
            .insert(invoices)
            .values({
              id,
              invoiceNumber,
              customerName: input.customerName?.trim() || null,
              total,
              organizationId: actor.organizationId,
              createdByUserId: actor.userId,
              updatedByUserId: actor.userId,
              deviceId: actor.deviceId,
              operationId,
              rowVersion: 1,
              createdAt: occurredAt,
              updatedAt: occurredAt,
            })
            .returning();
          if (!invoice) return yield* invalidInvoice("Created invoice could not be loaded");
          changes.push({
            entity: "invoice",
            action: "upsert",
            entityId: invoice.id,
            rowVersion: invoice.rowVersion,
            row: invoice,
          });

          for (const line of input.items) {
            const product = yield* transaction.query.products.findFirst({
              where: {
                organizationId: actor.organizationId,
                id: line.productId,
                deletedAt: { isNull: true },
              },
            });
            if (!product) return yield* invalidInvoice("One of the products no longer exists");
            const productBatches = yield* transaction.query.batches.findMany({
              where: {
                organizationId: actor.organizationId,
                productId: line.productId,
                deletedAt: { isNull: true },
              },
            });
            const open = line.batchId
              ? productBatches.filter((batch) => batch.id === line.batchId)
              : productBatches
                  .slice()
                  .sort(byEarliestExpiry)
                  .filter((batch) =>
                    line.quantityType === "pack"
                      ? batch.packQuantity > 0
                      : batch.packQuantity * product.unitsPerPack + batch.unitQuantity > 0,
                  );
            if (line.batchId && open.length === 0)
              return yield* invalidInvoice(
                `The selected batch for ${product.name} no longer exists`,
              );
            const available = open.reduce(
              (sum, batch) =>
                sum +
                (line.quantityType === "pack"
                  ? batch.packQuantity
                  : batch.packQuantity * product.unitsPerPack + batch.unitQuantity),
              0,
            );
            if (available < line.quantity)
              return yield* invalidInvoice(
                `Not enough stock for ${product.name}: ${available} in stock, ${line.quantity} requested`,
              );

            let remaining = line.quantity;
            for (const batch of open) {
              if (remaining === 0) break;
              const batchAvailable =
                line.quantityType === "pack"
                  ? batch.packQuantity
                  : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;
              const taken = Math.min(batchAvailable, remaining);
              remaining -= taken;
              allocations.push({
                productId: product.id,
                productName: product.name,
                batchId: batch.id,
                batchNumber: batch.batchNumber,
                quantity: taken,
                quantityType: line.quantityType,
                baseUnitQuantity: taken * (line.quantityType === "pack" ? product.unitsPerPack : 1),
                salePrice: line.salePrice,
              });

              const nextRowVersion = batch.rowVersion + 1;
              if (line.quantityType === "pack") {
                const [updatedBatch] = yield* transaction
                  .update(batches)
                  .set({
                    packQuantity: batch.packQuantity - taken,
                    updatedAt: occurredAt,
                    updatedByUserId: actor.userId,
                    deviceId: actor.deviceId,
                    operationId,
                    rowVersion: nextRowVersion,
                  })
                  .where(
                    and(eq(batches.organizationId, actor.organizationId), eq(batches.id, batch.id)),
                  )
                  .returning();
                if (!updatedBatch) return yield* invalidInvoice("The batch could not be updated");
                changes.push({
                  entity: "batch",
                  action: "upsert",
                  entityId: updatedBatch.id,
                  rowVersion: updatedBatch.rowVersion,
                  row: updatedBatch,
                });
                changes.push(
                  yield* movementChange(transaction, {
                    id: crypto.randomUUID(),
                    productId: product.id,
                    batchId: batch.id,
                    invoiceId: id,
                    type: "sale",
                    packDelta: -taken,
                    unitDelta: 0,
                    note: `Invoice #${invoiceNumber}`,
                    organizationId: actor.organizationId,
                    actorUserId: actor.userId,
                    deviceId: actor.deviceId,
                    operationId,
                    createdAt: occurredAt,
                  }),
                );
              } else {
                const packsOpened = Math.max(
                  0,
                  Math.ceil((taken - batch.unitQuantity) / product.unitsPerPack),
                );
                const looseUnits = batch.unitQuantity + packsOpened * product.unitsPerPack;
                const [updatedBatch] = yield* transaction
                  .update(batches)
                  .set({
                    packQuantity: batch.packQuantity - packsOpened,
                    unitQuantity: looseUnits - taken,
                    updatedAt: occurredAt,
                    updatedByUserId: actor.userId,
                    deviceId: actor.deviceId,
                    operationId,
                    rowVersion: nextRowVersion,
                  })
                  .where(
                    and(eq(batches.organizationId, actor.organizationId), eq(batches.id, batch.id)),
                  )
                  .returning();
                if (!updatedBatch) return yield* invalidInvoice("The batch could not be updated");
                changes.push({
                  entity: "batch",
                  action: "upsert",
                  entityId: updatedBatch.id,
                  rowVersion: updatedBatch.rowVersion,
                  row: updatedBatch,
                });
                if (packsOpened > 0)
                  changes.push(
                    yield* movementChange(transaction, {
                      id: crypto.randomUUID(),
                      productId: product.id,
                      batchId: batch.id,
                      invoiceId: id,
                      type: "open_pack",
                      packDelta: -packsOpened,
                      unitDelta: packsOpened * product.unitsPerPack,
                      note: `Opened for invoice #${invoiceNumber}`,
                      organizationId: actor.organizationId,
                      actorUserId: actor.userId,
                      deviceId: actor.deviceId,
                      operationId,
                      createdAt: occurredAt,
                    }),
                  );
                changes.push(
                  yield* movementChange(transaction, {
                    id: crypto.randomUUID(),
                    productId: product.id,
                    batchId: batch.id,
                    invoiceId: id,
                    type: "sale",
                    packDelta: 0,
                    unitDelta: -taken,
                    note: `Invoice #${invoiceNumber}`,
                    organizationId: actor.organizationId,
                    actorUserId: actor.userId,
                    deviceId: actor.deviceId,
                    operationId,
                    createdAt: occurredAt,
                  }),
                );
              }
            }
          }

          for (const allocation of allocations) {
            const [item] = yield* transaction
              .insert(invoiceItems)
              .values({
                ...allocation,
                id: crypto.randomUUID(),
                invoiceId: id,
                organizationId: actor.organizationId,
                createdByUserId: actor.userId,
                updatedByUserId: actor.userId,
                deviceId: actor.deviceId,
                operationId,
                rowVersion: 1,
                createdAt: occurredAt,
                updatedAt: occurredAt,
              })
              .returning();
            if (!item) return yield* invalidInvoice("The invoice item could not be recorded");
            changes.push({
              entity: "invoiceItem",
              action: "upsert",
              entityId: item.id,
              rowVersion: item.rowVersion,
              row: item,
            });
          }
          yield* enqueueOperation(transaction, actor, operationId, occurredAt, changes);
          const invoiceWithItems = yield* transaction.query.invoices.findFirst({
            where: { organizationId: actor.organizationId, id },
            with: { items: true },
          });
          if (!invoiceWithItems)
            return yield* invalidInvoice("Created invoice could not be loaded");
          return invoiceWithItems;
        }),
      )
      .pipe(mapPersistenceError("create invoice"));
    yield* signalSync;
    return toInvoice(created);
  });

  return { listInvoices, getInvoice, createInvoice };
};
