import {
  allocationsCoverInput,
  allocateInvoiceLine,
  nextInvoiceNumber,
  withAllocationIds,
  type AllocatableBatch,
} from "@store/contracts";
import { decodeInvoiceId } from "@store/contracts/ids";
import type {
  CreateInvoiceInput,
  InvoiceAllocation,
  IssueInvoiceCommand,
} from "@store/contracts/store.schema";

import type { CatalogActor, CatalogWriteIds } from "./catalog-writes";
import {
  persistableRow,
  InvoiceItemRow,
  InvoiceRow,
  StockMovementRow,
  type BatchRow,
  type ProductRow,
} from "./rows";

export type SaleProjection = {
  readonly command: IssueInvoiceCommand;
  readonly invoice: InvoiceRow;
  readonly items: ReadonlyArray<InvoiceItemRow>;
  readonly batchUpdates: ReadonlyArray<BatchRow>;
  readonly movements: ReadonlyArray<StockMovementRow>;
};

type ProductSource = {
  readonly state: { get: (id: string) => ProductRow | undefined };
};

type BatchSource = {
  readonly state: { get: (id: string) => BatchRow | undefined; values: () => Iterable<BatchRow> };
};

const activeBatchesForProduct = (
  batches: Iterable<BatchRow>,
  productId: string,
): AllocatableBatch[] =>
  [...batches]
    .filter((batch) => batch.deletedAt === null && batch.productId === productId)
    .map((batch) => ({
      id: batch.id,
      packQuantity: batch.packQuantity,
      unitQuantity: batch.unitQuantity,
      expiresAt: batch.expiresAt,
      createdAt: batch.createdAt,
      batchNumber: batch.batchNumber,
    }));

export const projectIssuedInvoice = (input: {
  readonly actor: CatalogActor;
  readonly commandId: string;
  readonly occurredAt: number;
  readonly invoiceNumber: number;
  readonly sale: CreateInvoiceInput;
  readonly products: ProductSource;
  readonly batches: BatchSource;
  readonly ids: CatalogWriteIds;
}): SaleProjection => {
  if (input.sale.items.length === 0) {
    throw new Error("Add at least one item to the sale.");
  }

  const working = new Map(
    [...input.batches.state.values()].map((batch) => [batch.id, { ...batch }]),
  );
  const allocations: InvoiceAllocation[] = [];
  const items: InvoiceItemRow[] = [];
  const movements: StockMovementRow[] = [];
  const invoiceId = decodeInvoiceId(input.commandId);
  const total = input.sale.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
  const meta = {
    organizationId: input.actor.organizationId,
    createdByUserId: input.actor.userId,
    updatedByUserId: input.actor.userId,
    deviceId: input.actor.deviceId,
    operationId: input.commandId,
    rowVersion: 1,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    deletedAt: null,
  } as const;

  for (const line of input.sale.items) {
    const product = input.products.state.get(line.productId);
    if (!product || product.deletedAt !== null) {
      throw new Error("One of the products no longer exists.");
    }
    const takes = allocateInvoiceLine(
      line,
      product,
      activeBatchesForProduct(working.values(), product.id),
    );
    const stamped = withAllocationIds(
      takes.map((take) => ({ ...take, productId: product.id })),
      line,
      input.ids.rowId,
    );
    allocations.push(...stamped);
    for (let index = 0; index < takes.length; index += 1) {
      const take = takes[index];
      const allocation = stamped[index];
      if (!take || !allocation) continue;
      const current = working.get(take.batchId);
      if (!current) throw new Error(`The selected batch for ${product.name} is gone.`);
      const next: BatchRow = persistableRow({
        ...current,
        packQuantity: take.nextPackQuantity,
        unitQuantity: take.nextUnitQuantity,
        updatedByUserId: input.actor.userId,
        deviceId: input.actor.deviceId,
        operationId: input.commandId,
        rowVersion: current.rowVersion + 1,
        updatedAt: input.occurredAt,
      });
      working.set(take.batchId, next);
      items.push(
        persistableRow({
          id: allocation.invoiceItemId,
          invoiceId,
          productId: product.id,
          batchId: take.batchId,
          productName: product.name,
          batchNumber: take.batchNumber,
          quantity: take.quantity,
          quantityType: line.quantityType,
          baseUnitQuantity:
            take.quantity * (line.quantityType === "pack" ? product.unitsPerPack : 1),
          salePrice: line.salePrice,
          ...meta,
        }),
      );
      if (take.packsOpened > 0 && allocation.openPackMovementId) {
        movements.push({
          id: allocation.openPackMovementId,
          productId: product.id,
          batchId: take.batchId,
          invoiceId,
          type: "open_pack",
          packDelta: -take.packsOpened,
          unitDelta: take.packsOpened * product.unitsPerPack,
          note: `Opened for invoice #${input.invoiceNumber}`,
          organizationId: input.actor.organizationId,
          actorUserId: input.actor.userId,
          deviceId: input.actor.deviceId,
          operationId: input.commandId,
          createdAt: input.occurredAt,
        });
      }
      movements.push({
        id: allocation.saleMovementId,
        productId: product.id,
        batchId: take.batchId,
        invoiceId,
        type: "sale",
        packDelta: line.quantityType === "pack" ? -take.quantity : 0,
        unitDelta: line.quantityType === "unit" ? -take.quantity : 0,
        note: `Invoice #${input.invoiceNumber}`,
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.userId,
        deviceId: input.actor.deviceId,
        operationId: input.commandId,
        createdAt: input.occurredAt,
      });
    }
  }

  const command: IssueInvoiceCommand = {
    commandId: input.commandId,
    deviceId: input.actor.deviceId,
    occurredAt: input.occurredAt,
    invoiceId,
    invoiceNumber: input.invoiceNumber,
    input: {
      customerName: input.sale.customerName?.trim() || null,
      items: allocations.map((take) => ({
        productId: take.productId,
        batchId: take.batchId,
        quantity: take.quantity,
        quantityType: take.quantityType,
        salePrice: take.salePrice,
      })),
    },
    allocations,
  };
  if (!allocationsCoverInput(command.input, command.allocations)) {
    throw new Error("The sale could not be allocated.");
  }

  const touched = new Set(allocations.map((take) => take.batchId));
  return {
    command,
    invoice: persistableRow({
      id: invoiceId,
      invoiceNumber: input.invoiceNumber,
      customerName: input.sale.customerName?.trim() || null,
      total,
      ...meta,
    }),
    items,
    batchUpdates: [...working.values()].filter((batch) => touched.has(batch.id)),
    movements,
  };
};

export const replicaInvoiceNumber = (
  invoices: Iterable<{ readonly deletedAt: number | null; readonly invoiceNumber: number }>,
) => nextInvoiceNumber([...invoices].map((invoice) => invoice.invoiceNumber));
