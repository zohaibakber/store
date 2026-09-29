import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { parseUnitsPerPack, salvageUnitsPerPack } from "../src/invoice-extraction/pack-size";
import { extractInvoice, type InvoiceAiClient } from "../src/invoice-extraction/service";

describe("pack size parsing", () => {
  it.each<[string | number, number]>([
    ["10x10", 100],
    ["10 x 10", 100],
    ["10×10", 100],
    ["10x10x10", 1000],
    ["20's", 20],
    ["20s", 20],
    ["20’s", 20],
    ["20", 20],
    [20, 20],
  ])("reads %s as %i units", (printed, units) => {
    expect(parseUnitsPerPack(printed)).toBe(units);
  });

  it("repairs concatenated factors from the name and leaves a correct product alone", () => {
    expect(salvageUnitsPerPack("Amoxicillin 10x10", 1010)).toBe(100);
    expect(salvageUnitsPerPack("Amoxicillin 10x10", 100)).toBe(100);
  });
});

const unusedAi = (): InvoiceAiClient => ({
  toMarkdown: async () => {
    throw new Error("PDF extraction should not run when the CSV already has stock.");
  },
  generate: async () => {
    throw new Error("PDF extraction should not run when the CSV already has stock.");
  },
});

const pdfAi = (): InvoiceAiClient => ({
  toMarkdown: async () => [{ kind: "ok", name: "invoice.pdf", data: "Amoxicillin 3 packs" }],
  generate: async () => ({
    supplier: "Acme",
    invoiceNumber: "INV-1",
    lines: [
      {
        name: "Amoxicillin",
        batchNumber: null,
        expiresAt: null,
        packQuantity: 3,
        unitQuantity: 0,
        unitsPerPack: 10,
        packPrice: null,
      },
    ],
  }),
});

const extract = (files: ReadonlyArray<File>, ai: InvoiceAiClient) =>
  Effect.runPromise(extractInvoice(ai, files));

describe("InvoiceExtraction.extract", () => {
  it("parses quoted names, pack notation, and thousand-separated prices from a CSV", async () => {
    const csv = [
      "name,packs,units per pack,pack price",
      '"Amoxicillin 250mg, Capsules",3,10x10,"1,250.00"',
      "Ibuprofen,2,20's,9.5",
    ].join("\n");
    const result = await extract([new File([csv], "stock.csv", { type: "text/csv" })], unusedAi());
    expect(result.lines).toEqual([
      {
        name: "Amoxicillin 250mg, Capsules",
        batchNumber: null,
        expiresAt: null,
        packQuantity: 3,
        unitQuantity: 0,
        unitsPerPack: 100,
        packPrice: 125000,
      },
      {
        name: "Ibuprofen",
        batchNumber: null,
        expiresAt: null,
        packQuantity: 2,
        unitQuantity: 0,
        unitsPerPack: 20,
        packPrice: 950,
      },
    ]);
  });

  it("keeps a stock CSV and does not mix in a PDF of the same shipment", async () => {
    const result = await extract(
      [
        new File(["name,packs\nAmoxicillin,3\n"], "stock.csv", { type: "text/csv" }),
        new File(["%PDF-1.4"], "invoice.pdf", { type: "application/pdf" }),
      ],
      unusedAi(),
    );
    expect(result.lines).toEqual([
      {
        name: "Amoxicillin",
        batchNumber: null,
        expiresAt: null,
        packQuantity: 3,
        unitQuantity: 0,
        unitsPerPack: 1,
        packPrice: null,
      },
    ]);
  });

  it("extracts a PDF when the CSV has no received stock", async () => {
    const result = await extract(
      [
        new File(["item,qty\nAmoxicillin,5\n"], "headers.csv", { type: "text/csv" }),
        new File(["%PDF-1.4"], "invoice.pdf", { type: "application/pdf" }),
      ],
      pdfAi(),
    );
    expect(result.supplier).toBe("Acme");
    expect(result.lines).toEqual([
      {
        name: "Amoxicillin",
        batchNumber: null,
        expiresAt: null,
        packQuantity: 3,
        unitQuantity: 0,
        unitsPerPack: 10,
        packPrice: null,
      },
    ]);
  });

  it("drops placeholder CSV rows from a spreadsheet that already has stock", async () => {
    const result = await extract(
      [new File(["name,packs\nAmoxicillin,3\n,\n"], "stock.csv", { type: "text/csv" })],
      unusedAi(),
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.name).toBe("Amoxicillin");
  });
});
