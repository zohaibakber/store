import {
  allocationsCoverInput,
  allocateInvoiceLine,
  withAllocationIds,
  type AllocatableBatch,
} from "@store/contracts";
import { CatalogRefusal } from "@store/contracts/catalog-refusal";
import { decodeInvoiceId } from "@store/contracts/ids";
import type {
  CreateInvoiceInput,
  InvoiceAllocation,
  IssueInvoiceCommand,
} from "@store/contracts/store.schema";
import * as Result from "effect/Result";

import type { CatalogActor, CatalogWriteIds } from "./projection-context";
import { type BatchRow, type ProductRow } from "./rows";

type SaleProjection = {
  readonly command: IssueInvoiceCommand;
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
    .filter((batch) => batch.productId === productId)
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
}): Result.Result<SaleProjection, CatalogRefusal> =>
  Result.gen(function* () {
    if (input.sale.items.length === 0) {
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "emptyCommand",
          message: "Add at least one item to the sale.",
        }),
      );
    }

    const working = new Map(
      [...input.batches.state.values()].map((batch) => [batch.id, { ...batch }]),
    );
    const allocations: InvoiceAllocation[] = [];
    const invoiceId = decodeInvoiceId(input.commandId);

    for (const line of input.sale.items) {
      const product = input.products.state.get(line.productId);
      if (!product) {
        return yield* Result.fail(
          new CatalogRefusal({
            reason: "missingReference",
            message: "One of the products no longer exists.",
          }),
        );
      }
      const takes = yield* allocateInvoiceLine(
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
        if (!current)
          return yield* Result.fail(
            new CatalogRefusal({
              reason: "missingReference",
              message: `The selected batch for ${product.name} is gone.`,
            }),
          );
        working.set(take.batchId, {
          ...current,
          packQuantity: take.nextPackQuantity,
          unitQuantity: take.nextUnitQuantity,
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
      return yield* Result.fail(
        new CatalogRefusal({
          reason: "allocationFailed",
          message: "The sale could not be allocated.",
        }),
      );
    }

    return { command };
  });
