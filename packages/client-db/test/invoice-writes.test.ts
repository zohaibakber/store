import { decodeBatchId, decodeCategoryId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it, vi } from "vitest";

import { replicaInvoiceNumber } from "../src/invoice-projection";
import { makeInvoiceWrites, type InvoiceWriteTables } from "../src/invoice-writes";
import type {
  BatchRow,
  CategoryRow,
  InvoiceItemRow,
  InvoiceRow,
  ProductRow,
  StockMovementRow,
} from "../src/rows";

const memoryCollection = <Row extends { readonly id: string }>(
  initial: ReadonlyArray<Row> = [],
) => {
  const rows = new Map(initial.map((row) => [row.id, row]));
  return {
    state: {
      get: (id: string) => rows.get(id),
      values: () => rows.values(),
    },
    insert: (row: Row) => {
      rows.set(row.id, row);
      return { isPersisted: { promise: Promise.resolve() } };
    },
    update: (id: string, updater: (draft: Row) => void) => {
      const current = rows.get(id);
      if (!current) throw new Error(`missing ${id}`);
      const draft = { ...current };
      updater(draft);
      rows.set(id, draft);
      return { isPersisted: { promise: Promise.resolve() } };
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

const category = (): CategoryRow => ({
  id: decodeCategoryId("category-1"),
  name: "General",
  tracksPacks: true,
  organizationId: actor.organizationId,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  deviceId: actor.deviceId,
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

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
  deletedAt: null,
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
  deletedAt: null,
  ...overrides,
});

const tables = (): InvoiceWriteTables => ({
  categories: memoryCollection([category()]),
  products: memoryCollection([product()]),
  batches: memoryCollection([batch()]),
  invoices: memoryCollection<InvoiceRow>(),
  invoiceItems: memoryCollection<InvoiceItemRow>(),
  stockMovements: memoryCollection<StockMovementRow>(),
  submitInvoice: async () => undefined,
});

describe("replicaInvoiceNumber", () => {
  it("is one past the highest persisted number, including deleted invoices", () => {
    expect(replicaInvoiceNumber([])).toBe(1);
    expect(
      replicaInvoiceNumber([
        { invoiceNumber: 2, deletedAt: null },
        { invoiceNumber: 4, deletedAt: 1 },
        { invoiceNumber: 3, deletedAt: null },
      ]),
    ).toBe(5);
  });
});

describe("makeInvoiceWrites", () => {
  it("persists an invoice locally without waiting for the network", async () => {
    rowSeq = 0;
    const submitted = vi.fn<InvoiceWriteTables["submitInvoice"]>().mockResolvedValue(undefined);
    const inventory = { ...tables(), submitInvoice: submitted };
    const writes = makeInvoiceWrites(inventory, actor, ids);
    const result = await writes.issueInvoice({
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
    });

    expect(result).toEqual({ invoiceId: "command-1", invoiceNumber: 1 });
    expect(submitted).toHaveBeenCalledOnce();
    expect(submitted.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: "invoice", entityId: "command-1" }),
        expect.objectContaining({ entity: "invoiceItem" }),
        expect.objectContaining({
          entity: "batch",
          row: expect.objectContaining({ packQuantity: 1 }),
        }),
      ]),
    );
  });
});
