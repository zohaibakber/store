import type { CrudEntry } from "@powersync/common";
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
import * as Schema from "effect/Schema";

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
) =>
  nextInvoiceNumber(
    [...invoices]
      .filter((invoice) => invoice.deletedAt === null)
      .map((invoice) => invoice.invoiceNumber),
  );

export type InventoryCrudEntry = Pick<
  CrudEntry,
  "id" | "table" | "op" | "opData" | "previousValues"
>;

export type ClassifiedInventoryCrud =
  | { readonly _tag: "catalog"; readonly entries: ReadonlyArray<InventoryCrudEntry> }
  | { readonly _tag: "sale"; readonly command: IssueInvoiceCommand };

const CATALOG_TABLES = new Set(["categories", "products", "batches"]);
const SALE_TABLES = new Set(["invoices", "invoice_items", "stock_movements", "batches"]);

const decodeInvoicePut = (entry: InventoryCrudEntry) =>
  Schema.decodeUnknownSync(InvoiceRow)({
    customerName: null,
    deletedAt: null,
    ...entry.opData,
    id: entry.id,
  });

const decodeInvoiceItemPut = (entry: InventoryCrudEntry) =>
  Schema.decodeUnknownSync(InvoiceItemRow)({
    batchNumber: null,
    deletedAt: null,
    ...entry.opData,
    id: entry.id,
  });

const decodeStockMovementPut = (entry: InventoryCrudEntry) =>
  Schema.decodeUnknownSync(StockMovementRow)({
    invoiceId: null,
    note: null,
    ...entry.opData,
    id: entry.id,
  });

export const reconstructIssueInvoiceCommand = (
  crud: ReadonlyArray<InventoryCrudEntry>,
): IssueInvoiceCommand => {
  const invoiceEntry = crud.find((entry) => entry.table === "invoices" && entry.op === "PUT");
  if (!invoiceEntry) throw new Error("Queued sale is missing the invoice row.");
  const invoice = decodeInvoicePut(invoiceEntry);
  const items = crud
    .filter((entry) => entry.table === "invoice_items" && entry.op === "PUT")
    .map(decodeInvoiceItemPut);
  const movements = crud
    .filter((entry) => entry.table === "stock_movements" && entry.op === "PUT")
    .map(decodeStockMovementPut);
  if (items.length === 0) throw new Error("Queued sale is missing invoice items.");

  const unusedMovements = [...movements];
  const takeMovement = (predicate: (movement: StockMovementRow) => boolean) => {
    const index = unusedMovements.findIndex(predicate);
    if (index < 0) return undefined;
    return unusedMovements.splice(index, 1)[0];
  };

  const allocations: InvoiceAllocation[] = items.map((item) => {
    const sale = takeMovement(
      (movement) =>
        movement.type === "sale" &&
        movement.batchId === item.batchId &&
        movement.invoiceId === invoice.id &&
        movement.productId === item.productId,
    );
    const openPack = takeMovement(
      (movement) =>
        movement.type === "open_pack" &&
        movement.batchId === item.batchId &&
        movement.invoiceId === invoice.id &&
        movement.productId === item.productId,
    );
    if (!sale) throw new Error("Queued sale is missing a stock movement.");
    return {
      invoiceItemId: item.id,
      saleMovementId: sale.id,
      openPackMovementId: openPack ? openPack.id : null,
      productId: item.productId,
      batchId: item.batchId,
      quantity: item.quantity,
      quantityType: item.quantityType,
      salePrice: item.salePrice,
      packsOpened: openPack ? Math.abs(openPack.packDelta) : 0,
    };
  });

  const command: IssueInvoiceCommand = {
    commandId: invoice.operationId,
    deviceId: invoice.deviceId,
    occurredAt: invoice.createdAt,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    input: {
      customerName: invoice.customerName,
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
    throw new Error("Queued sale allocations do not match the invoice items.");
  }
  return command;
};

export const classifyInventoryCrudTransaction = (
  crud: ReadonlyArray<InventoryCrudEntry>,
): ClassifiedInventoryCrud => {
  if (crud.length === 0) {
    throw new Error("PowerSync queued an empty inventory transaction.");
  }
  const tables = new Set(crud.map((entry) => entry.table));
  const isCatalog = [...tables].every((table) => CATALOG_TABLES.has(table));
  const isSale =
    tables.has("invoices") &&
    tables.has("invoice_items") &&
    tables.has("stock_movements") &&
    tables.has("batches") &&
    [...tables].every((table) => SALE_TABLES.has(table));

  if (isSale) {
    const invoicePuts = crud.filter((entry) => entry.table === "invoices");
    const batchPatches = crud.filter((entry) => entry.table === "batches");
    if (
      invoicePuts.length !== 1 ||
      invoicePuts[0]?.op !== "PUT" ||
      batchPatches.some((entry) => entry.op !== "PATCH")
    ) {
      throw new Error("Queued sale is not a single invoice transaction.");
    }
    return { _tag: "sale", command: reconstructIssueInvoiceCommand(crud) };
  }
  if (isCatalog) return { _tag: "catalog", entries: crud };
  throw new Error("PowerSync queued mixed catalog and invoice writes.");
};
