import {
  decodeBatchId,
  decodeInvoiceId,
  decodeInvoiceItemId,
  decodeProductId,
} from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import type { PersistableCollection } from "../src/catalog-writes";
import type { SaleOutboxSnapshot } from "../src/invoice-projection";
import type { BatchRow, InvoiceItemRow, InvoiceRow, StockMovementRow } from "../src/rows";
import { memorySaleOutbox, restoreSaleOutbox } from "../src/sale-outbox";

const memoryCollection = <Row extends { readonly id: string }>(
  initial: ReadonlyArray<Row> = [],
): PersistableCollection<Row> => {
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

const snapshot = (): SaleOutboxSnapshot => ({
  command: {
    commandId: "command-1",
    deviceId: "device-1",
    occurredAt: 100,
    invoiceId: decodeInvoiceId("command-1"),
    invoiceNumber: 1,
    input: {
      customerName: null,
      items: [
        {
          productId: decodeProductId("product-1"),
          batchId: decodeBatchId("batch-1"),
          quantity: 1,
          quantityType: "pack",
          salePrice: 50,
        },
      ],
    },
    allocations: [
      {
        invoiceItemId: decodeInvoiceItemId("item-1"),
        saleMovementId: "sale-1",
        openPackMovementId: null,
        productId: decodeProductId("product-1"),
        batchId: decodeBatchId("batch-1"),
        quantity: 1,
        quantityType: "pack",
        salePrice: 50,
        packsOpened: 0,
      },
    ],
  },
  invoice: {
    id: decodeInvoiceId("command-1"),
    invoiceNumber: 1,
    customerName: null,
    total: 50,
    organizationId: "org-1",
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    deviceId: "device-1",
    operationId: "command-1",
    rowVersion: 1,
    createdAt: 100,
    updatedAt: 100,
    deletedAt: null,
  },
  items: [
    {
      id: decodeInvoiceItemId("item-1"),
      invoiceId: decodeInvoiceId("command-1"),
      productId: decodeProductId("product-1"),
      batchId: decodeBatchId("batch-1"),
      productName: "Paracetamol",
      batchNumber: "A",
      quantity: 1,
      quantityType: "pack",
      baseUnitQuantity: 10,
      salePrice: 50,
      organizationId: "org-1",
      createdByUserId: "user-1",
      updatedByUserId: "user-1",
      deviceId: "device-1",
      operationId: "command-1",
      rowVersion: 1,
      createdAt: 100,
      updatedAt: 100,
      deletedAt: null,
    },
  ],
  movements: [
    {
      id: "sale-1",
      productId: decodeProductId("product-1"),
      batchId: decodeBatchId("batch-1"),
      invoiceId: decodeInvoiceId("command-1"),
      type: "sale",
      packDelta: -1,
      unitDelta: 0,
      note: "Invoice #0001",
      organizationId: "org-1",
      actorUserId: "user-1",
      deviceId: "device-1",
      operationId: "command-1",
      createdAt: 100,
    },
  ],
});

const batch = (): BatchRow => ({
  id: decodeBatchId("batch-1"),
  productId: decodeProductId("product-1"),
  batchNumber: "A",
  expiresAt: null,
  packQuantity: 2,
  unitQuantity: 0,
  organizationId: "org-1",
  createdByUserId: "user-1",
  updatedByUserId: "user-1",
  deviceId: "device-1",
  operationId: "seed",
  rowVersion: 1,
  createdAt: 1,
  updatedAt: 1,
  deletedAt: null,
});

describe("sale outbox journal", () => {
  it("replaces an entry with the same command id", async () => {
    const store = memorySaleOutbox();
    const first = snapshot();
    await store.put(first);
    await store.put({
      ...first,
      invoice: { ...first.invoice, customerName: "Walk-in" },
    });
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.invoice.customerName).toBe("Walk-in");
  });

  it("restores a journaled sale that sync removed from local tables", async () => {
    const entry = snapshot();
    const tables = {
      invoices: memoryCollection<InvoiceRow>(),
      invoiceItems: memoryCollection<InvoiceItemRow>(),
      stockMovements: memoryCollection<StockMovementRow>(),
      batches: memoryCollection([batch()]),
    };
    await restoreSaleOutbox(memorySaleOutbox([entry]), tables);
    expect(tables.invoices.state.get(entry.invoice.id)?.invoiceNumber).toBe(1);
    expect([...tables.invoiceItems.state.values()]).toHaveLength(1);
    expect(tables.batches.state.get("batch-1")?.packQuantity).toBe(1);
  });

  it("leaves an invoice that is still on the replica alone", async () => {
    const entry = snapshot();
    const tables = {
      invoices: memoryCollection([entry.invoice]),
      invoiceItems: memoryCollection<InvoiceItemRow>(),
      stockMovements: memoryCollection<StockMovementRow>(),
      batches: memoryCollection([batch()]),
    };
    const store = memorySaleOutbox([entry]);
    await restoreSaleOutbox(store, tables);
    expect([...tables.invoiceItems.state.values()]).toHaveLength(0);
    expect(tables.batches.state.get("batch-1")?.packQuantity).toBe(2);
    expect((await store.list()).map((entry) => entry.command.commandId)).toEqual(["command-1"]);
  });
});
