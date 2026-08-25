import { describe, expect, it } from "vitest";

import { parseCsvRecords } from "../src/invoice-extraction/csv";
import {
  parseMajorCurrencyToMinor,
  parseUnitsPerPack,
  salvageUnitsPerPack,
} from "../src/invoice-extraction/pack-size";
import { parseCsv } from "../src/invoice-extraction/service";

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
});
