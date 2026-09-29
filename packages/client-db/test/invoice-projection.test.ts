import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { projectIssuedInvoice } from "../src/invoice-projection";
import type { BatchRow, ProductRow } from "../src/rows";

const readable = <Row extends { readonly id: string }>(rows: ReadonlyArray<Row>) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => byId.get(id),
      values: () => byId.values(),
    },
  };
};

const actor = {
  organizationId: "org-1",
  userId: "user-1",
  deviceId: "device-1",
};

let rowSeq = 0;
const ids = {
  now: () => 1_700_000_000_000,
  operationId: () => "command-1",
  rowId: () => `row-${++rowSeq}`,
};

const product = (): ProductRow => ({
  id: decodeProductId("product-1"),
  name: "Paracetamol",
  categoryId: decodeCategoryId("category-1"),
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  purchasePrice: null,
  retailPrice: null,
  unitPrice: null,
  visible: true,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
});

const batch = (overrides: Partial<BatchRow> = {}): BatchRow => ({
  id: decodeBatchId("batch-1"),
  productId: decodeProductId("product-1"),
  batchNumber: "A",
  expiresAt: null,
  packQuantity: 2,
  unitQuantity: 0,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("projectIssuedInvoice", () => {
  it("projects the invoice, its items, and the stock change from local rows", () => {
    rowSeq = 0;
    const projection = projectIssuedInvoice({
      actor,
      commandId: "command-1",
      occurredAt: ids.now(),
      invoiceNumber: 1,
      sale: {
        customerName: "Walk-in",
        items: [
          {
            productId: decodeProductId("product-1"),
            batchId: null,
            quantity: 1,
            quantityType: "pack",
            salePrice: 50,
          },
        ],
      },
      products: readable([product()]),
      batches: readable([batch()]),
      ids,
    });

    expect(projection.invoice).toMatchObject({ id: "command-1", invoiceNumber: 1 });
    expect(projection.items).toHaveLength(1);
    expect(projection.batchUpdates.find((row) => row.id === "batch-1")?.packQuantity).toBe(1);
  });
});
