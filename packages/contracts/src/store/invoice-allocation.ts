import * as Result from "effect/Result";

import { CatalogRefusal } from "../catalog/refusal";
import { decodeInvoiceItemId } from "../ids";
import type { BatchId, ProductId } from "../ids";
import { isPositiveInt } from "../schema-primitives";
import { isPaisa } from "./pricing";
import type { CreateInvoiceInput, CreateInvoiceLineInput, InvoiceAllocation } from "./schema";
import { availableFor, takeFromStock } from "./stock";

export type AllocatableBatch = {
  readonly id: BatchId;
  readonly packQuantity: number;
  readonly unitQuantity: number;
  readonly expiresAt: number | null;
  readonly createdAt: number;
  readonly batchNumber: string | null;
};

type InvoiceLineTake = {
  readonly batchId: BatchId;
  readonly batchNumber: string | null;
  readonly quantity: number;
  readonly packsOpened: number;
  readonly nextPackQuantity: number;
  readonly nextUnitQuantity: number;
};

export const nextSequenceNumber = (replicaNumbers: Iterable<number>): number => {
  let last = 0;
  for (const number of replicaNumbers) {
    if (number > last) last = number;
  }
  return last + 1;
};

const compareBatchesFefo = (left: AllocatableBatch, right: AllocatableBatch) => {
  if (left.expiresAt === null && right.expiresAt !== null) return 1;
  if (left.expiresAt !== null && right.expiresAt === null) return -1;
  if (left.expiresAt !== null && right.expiresAt !== null && left.expiresAt !== right.expiresAt) {
    return left.expiresAt - right.expiresAt;
  }
  return left.createdAt - right.createdAt;
};

export const allocateInvoiceLine = (
  line: CreateInvoiceLineInput,
  product: { readonly name: string; readonly unitsPerPack: number },
  batches: ReadonlyArray<AllocatableBatch>,
): Result.Result<ReadonlyArray<InvoiceLineTake>, CatalogRefusal> =>
  Result.gen(function* () {
    if (!isPositiveInt(line.quantity)) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "invalidInput",
          message: "Quantities must be whole numbers of 1 or more.",
        }),
      );
    }
    if (!isPaisa(line.salePrice)) {
      return yield* Result.fail(
        new CatalogRefusal({ reason: "invalidInput", message: "Sale prices cannot be negative." }),
      );
    }

    const sorted = [...batches].sort(compareBatchesFefo);
    const candidates = line.batchId
      ? sorted.filter((batch) => batch.id === line.batchId)
      : sorted.filter((batch) => availableFor(batch, product.unitsPerPack, line.quantityType) > 0);
    if (line.batchId && candidates.length === 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "missingReference",
          message: `The selected batch for ${product.name} is gone.`,
        }),
      );
    }

    const available = candidates.reduce(
      (sum, batch) => sum + availableFor(batch, product.unitsPerPack, line.quantityType),
      0,
    );
    if (available < line.quantity) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "insufficientStock",
          message: `Not enough stock for ${product.name}: ${available} available, ${line.quantity} requested.`,
        }),
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
      const taken = Math.min(
        availableFor(stock, product.unitsPerPack, line.quantityType),
        remaining,
      );
      remaining -= taken;
      const take = yield* takeFromStock(stock, product, {
        quantity: taken,
        quantityType: line.quantityType,
      });
      remainingById.set(batch.id, {
        packQuantity: take.nextPackQuantity,
        unitQuantity: take.nextUnitQuantity,
      });
      takes.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantity: taken,
        packsOpened: take.packsOpened,
        nextPackQuantity: take.nextPackQuantity,
        nextUnitQuantity: take.nextUnitQuantity,
      });
    }
    return takes;
  });

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
