import { decodeBatchId, decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { allocateInvoiceLine, nextInvoiceNumber } from "../src/store/invoice-allocation";

const batch = {
  id: decodeBatchId("batch-1"),
  packQuantity: 2,
  unitQuantity: 3,
  expiresAt: 200,
  createdAt: 1,
  batchNumber: "A",
};

describe("nextInvoiceNumber", () => {
  it("starts at 1 when the replica has no invoices", () => {
    expect(nextInvoiceNumber([])).toBe(1);
  });

  it("is one past the highest replica number", () => {
    expect(nextInvoiceNumber([2, 7, 4])).toBe(8);
  });
});

describe("allocateInvoiceLine", () => {
  it("opens packs then takes units in FEFO order", () => {
    const later = { ...batch, id: decodeBatchId("batch-2"), expiresAt: 300, unitQuantity: 0 };
    const takes = allocateInvoiceLine(
      {
        productId: decodeProductId("product-1"),
        batchId: null,
        quantity: 5,
        quantityType: "unit",
        salePrice: 10,
      },
      { name: "Paracetamol", unitsPerPack: 10 },
      [later, batch],
    );
    expect(takes).toEqual([
      {
        batchId: batch.id,
        batchNumber: "A",
        quantity: 5,
        packsOpened: 1,
        nextPackQuantity: 1,
        nextUnitQuantity: 8,
      },
    ]);
  });

  it("rejects when stock is short", () => {
    expect(() =>
      allocateInvoiceLine(
        {
          productId: decodeProductId("product-1"),
          batchId: null,
          quantity: 40,
          quantityType: "unit",
          salePrice: 10,
        },
        { name: "Paracetamol", unitsPerPack: 10 },
        [batch],
      ),
    ).toThrow("Not enough stock for Paracetamol: 23 available, 40 requested.");
  });
});
