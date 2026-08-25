import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { parseCsvRecords } from "../src/invoice-extraction/csv";
import {
  parseMajorCurrencyToMinor,
  parseUnitsPerPack,
  salvageUnitsPerPack,
} from "../src/invoice-extraction/pack-size";
import {
  hasReceivedStock,
  invoiceExtractionLayer,
  InvoiceExtractionService,
  parseCsv,
  type InvoiceAiClient,
} from "../src/invoice-extraction/service";

describe("parseUnitsPerPack", () => {
  it("multiplies pack factors instead of concatenating digits", () => {
    expect(parseUnitsPerPack("10x10")).toBe(100);
    expect(parseUnitsPerPack("10 x 10")).toBe(100);
    expect(parseUnitsPerPack("10×10")).toBe(100);
    expect(parseUnitsPerPack("10x10x10")).toBe(1000);
  });

  it("reads 20's and 20s as twenty units", () => {
    expect(parseUnitsPerPack("20's")).toBe(20);
    expect(parseUnitsPerPack("20s")).toBe(20);
    expect(parseUnitsPerPack("20’s")).toBe(20);
  });

  it("keeps a plain count", () => {
    expect(parseUnitsPerPack("20")).toBe(20);
    expect(parseUnitsPerPack(20)).toBe(20);
  });
});

describe("salvageUnitsPerPack", () => {
  it("repairs concatenated 10x10 when the name still has the factors", () => {
    expect(salvageUnitsPerPack("Amoxicillin 10x10", 1010)).toBe(100);
  });

  it("leaves a correct product of factors alone", () => {
    expect(salvageUnitsPerPack("Amoxicillin 10x10", 100)).toBe(100);
  });
});

describe("parseMajorCurrencyToMinor", () => {
  it("keeps thousand separators in pack prices", () => {
    expect(parseMajorCurrencyToMinor("1,250.00")).toBe(125000);
    expect(parseMajorCurrencyToMinor("9.5")).toBe(950);
  });
});

describe("parseCsvRecords", () => {
  it("keeps commas inside quoted product names", () => {
    expect(parseCsvRecords('name,packs\n"Amoxicillin 250mg, Capsules",3\n')).toEqual([
      ["name", "packs"],
      ["Amoxicillin 250mg, Capsules", "3"],
    ]);
  });
});

describe("parseCsv", () => {
  it("parses quoted names, pack notation, and thousand-separated prices", () => {
    const lines = parseCsv(
      [
        "name,packs,units per pack,pack price",
        '"Amoxicillin 250mg, Capsules",3,10x10,"1,250.00"',
        "Ibuprofen,2,20's,9.5",
      ].join("\n"),
    );
    expect(lines).toEqual([
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

  it("still parses rows whose headers did not map to stock", () => {
    const lines = parseCsv("item,qty\nAmoxicillin,5\n");
    const line = lines[0];
    expect(line).toMatchObject({
      name: "Unspecified item",
      packQuantity: 0,
      unitQuantity: 0,
    });
    expect(line ? hasReceivedStock(line) : false).toBe(false);
  });

  it("treats a named row with packs as received stock", () => {
    const line = parseCsv("name,packs\nAmoxicillin,3\n")[0];
    expect(line ? hasReceivedStock(line) : false).toBe(true);
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
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* InvoiceExtractionService;
      return yield* service.extract(files);
    }).pipe(Effect.provide(invoiceExtractionLayer({ ai }))),
  );

describe("InvoiceExtraction.extract", () => {
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
