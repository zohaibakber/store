import { decodeInvoiceItemId } from "../ids";
import type { BatchId, ProductId } from "../ids";
import type { CreateInvoiceInput, CreateInvoiceLineInput, InvoiceAllocation } from "./schema";

export type AllocatableBatch = {
  readonly id: BatchId;
  readonly packQuantity: number;
  readonly unitQuantity: number;
  readonly expiresAt: number | null;
  readonly createdAt: number;
  readonly batchNumber: string | null;
};

export type InvoiceLineTake = {
  readonly batchId: BatchId;
  readonly batchNumber: string | null;
  readonly quantity: number;
  readonly packsOpened: number;
  readonly nextPackQuantity: number;
  readonly nextUnitQuantity: number;
};

export const nextInvoiceNumber = (replicaNumbers: Iterable<number>): number => {
  let last = 0;
  for (const number of replicaNumbers) {
    if (number > last) last = number;
  }
  return last + 1;
};

export const compareBatchesFefo = (left: AllocatableBatch, right: AllocatableBatch) => {
  if (left.expiresAt === null && right.expiresAt !== null) return 1;
  if (left.expiresAt !== null && right.expiresAt === null) return -1;
  if (left.expiresAt !== null && right.expiresAt !== null && left.expiresAt !== right.expiresAt) {
    return left.expiresAt - right.expiresAt;
  }
  return left.createdAt - right.createdAt;
};

const availableForLine = (
  batch: AllocatableBatch,
  product: { readonly unitsPerPack: number },
  quantityType: CreateInvoiceLineInput["quantityType"],
) =>
  quantityType === "pack"
    ? batch.packQuantity
    : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;

export const allocateInvoiceLine = (
  line: CreateInvoiceLineInput,
  product: { readonly name: string; readonly unitsPerPack: number },
  batches: ReadonlyArray<AllocatableBatch>,
): ReadonlyArray<InvoiceLineTake> => {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new Error("Quantities must be whole numbers of 1 or more.");
  }
  if (!Number.isSafeInteger(line.salePrice) || line.salePrice < 0) {
    throw new Error("Sale prices cannot be negative.");
  }

  const sorted = [...batches].sort(compareBatchesFefo);
  const candidates = line.batchId
    ? sorted.filter((batch) => batch.id === line.batchId)
    : sorted.filter((batch) => availableForLine(batch, product, line.quantityType) > 0);
  if (line.batchId && candidates.length === 0) {
    throw new Error(`The selected batch for ${product.name} is gone.`);
  }

  const available = candidates.reduce(
    (sum, batch) => sum + availableForLine(batch, product, line.quantityType),
    0,
  );
  if (available < line.quantity) {
    throw new Error(
      `Not enough stock for ${product.name}: ${available} available, ${line.quantity} requested.`,
    );
  }

  const takes: InvoiceLineTake[] = [];
  const remainingById = new Map(
    candidates.map((batch) => [
      batch.id,
      { packQuantity: batch.packQuantity, unitQuantity: batch.unitQuantity },
    ]),
  );
  let remaining = line.quantity;
  for (const batch of candidates) {
    if (remaining === 0) break;
    const stock = remainingById.get(batch.id);
    if (!stock) continue;
    const batchAvailable =
      line.quantityType === "pack"
        ? stock.packQuantity
        : stock.packQuantity * product.unitsPerPack + stock.unitQuantity;
    const taken = Math.min(batchAvailable, remaining);
    remaining -= taken;
    const packsOpened =
      line.quantityType === "unit"
        ? Math.max(0, Math.ceil((taken - stock.unitQuantity) / product.unitsPerPack))
        : 0;
    const nextPackQuantity =
      line.quantityType === "pack" ? stock.packQuantity - taken : stock.packQuantity - packsOpened;
    const nextUnitQuantity =
      line.quantityType === "pack"
        ? stock.unitQuantity
        : stock.unitQuantity + packsOpened * product.unitsPerPack - taken;
    remainingById.set(batch.id, {
      packQuantity: nextPackQuantity,
      unitQuantity: nextUnitQuantity,
    });
    takes.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: taken,
      packsOpened,
      nextPackQuantity,
      nextUnitQuantity,
    });
  }
  return takes;
};

export const allocationsCoverInput = (
  input: CreateInvoiceInput,
  allocations: ReadonlyArray<InvoiceAllocation>,
): boolean => {
  let index = 0;
  for (const line of input.items) {
    let remaining = line.quantity;
    while (remaining > 0) {
      const take = allocations[index];
      if (!take) return false;
      if (take.productId !== line.productId) return false;
      if (take.quantityType !== line.quantityType) return false;
      if (take.salePrice !== line.salePrice) return false;
      if (line.batchId !== null && take.batchId !== line.batchId) return false;
      if (take.quantity > remaining) return false;
      remaining -= take.quantity;
      index += 1;
    }
  }
  return index === allocations.length;
};

export const withAllocationIds = (
  takes: ReadonlyArray<InvoiceLineTake & { readonly productId: ProductId }>,
  line: Pick<CreateInvoiceLineInput, "quantityType" | "salePrice">,
  rowId: () => string,
): InvoiceAllocation[] =>
  takes.map((take) => ({
    invoiceItemId: decodeInvoiceItemId(rowId()),
    saleMovementId: rowId(),
    openPackMovementId: take.packsOpened > 0 ? rowId() : null,
    productId: take.productId,
    batchId: take.batchId,
    quantity: take.quantity,
    quantityType: line.quantityType,
    salePrice: line.salePrice,
    packsOpened: take.packsOpened,
  }));
