import type { ProductScanResult } from "@store/contracts/server-api.schema";
import { describe, expect, it } from "vitest";

import {
  NO_FLAGS,
  commitLabel,
  commitSummary,
  deriveFieldFlags,
  editedFields,
  editsFrom,
  mergeAutoFill,
  needsCheck,
  packCountsInText,
  planCommit,
  reviewValuesFrom,
  reviewValuesWith,
  sameEdits,
  textContains,
  valueFromChip,
} from "../src/scan/fields";

const label = [
  "PANADOL",
  "Extra",
  "Paracetamol 500 mg + Caffeine 65 mg",
  "2 x 10 Tablets",
  "B.No. AB1234",
  "MFG 02/25 EXP 08/27",
].join("\n");

const scan = (overrides: Partial<ProductScanResult> = {}): ProductScanResult => ({
  name: "Panadol Extra",
  composition: "Paracetamol + Caffeine",
  strength: "500mg",
  unitsPerPack: 20,
  batchNumber: "AB1234",
  expiresAt: "2027-08",
  confidence: 0.92,
  ...overrides,
});

describe("textContains", () => {
  it("ignores case, whitespace and line breaks", () => {
    expect(textContains(label, "panadol extra")).toBe(true);
    expect(textContains(label, "500mg")).toBe(true);
    expect(textContains(label, "Brufen")).toBe(false);
    expect(textContains(label, "  ")).toBe(false);
  });
});

describe("packCountsInText", () => {
  it("multiplies pack factors and keeps plain counts", () => {
    const counts = packCountsInText("2 x 10 Tablets, 30's");
    expect(counts.has(20)).toBe(true);
    expect(counts.has(30)).toBe(true);
  });
});

describe("deriveFieldFlags", () => {
  it("flags nothing when every value appears on the label", () => {
    expect(deriveFieldFlags(scan({ composition: null }), label)).toEqual({
      ...NO_FLAGS,
      composition: "Not found on the label",
    });
  });

  it("flags values that are missing from the recognised text", () => {
    const flags = deriveFieldFlags(scan({ batchNumber: "AB1284", expiresAt: "2027-09" }), label);
    expect(flags.batchNumber).toBe("Not on the label · tap to confirm");
    expect(flags.expiresAt).toBe("Label says 08/27 · tap to confirm");
    expect(flags.name).toBeNull();
  });

  it("flags empty fields", () => {
    const flags = deriveFieldFlags(scan({ expiresAt: null, unitsPerPack: null }), label);
    expect(flags.expiresAt).toBe("No expiry found on the label");
    expect(flags.unitsPerPack).toBe("Not found on the label");
  });

  it("flags every derived field when confidence is low", () => {
    const flags = deriveFieldFlags(scan({ confidence: 0.4 }), label);
    expect(Object.values(flags).every((flag) => flag !== null)).toBe(true);
    expect(flags.expiresAt).toBe("Label says 08/27 · tap to confirm");
    expect(flags.name).toBe("Low confidence · tap to confirm");
  });

  it("does not flag a manual draft", () => {
    expect(deriveFieldFlags(null, label)).toEqual(NO_FLAGS);
  });
});

describe("reviewValuesFrom", () => {
  it("formats the parsed fields for editing", () => {
    expect(reviewValuesFrom(scan({ strength: null }))).toEqual({
      name: "Panadol Extra",
      composition: "Paracetamol + Caffeine",
      strength: "",
      unitsPerPack: "20",
      batchNumber: "AB1234",
      expiresAt: "08/2027",
    });
  });
});

describe("valueFromChip", () => {
  it("fills fields from recognised text chips", () => {
    expect(valueFromChip("batchNumber", "B.No. AB1234")).toBe("AB1234");
    expect(valueFromChip("expiresAt", "MFG 02/25 EXP 08/27")).toBe("08/2027");
    expect(valueFromChip("unitsPerPack", "2 x 10 Tablets")).toBe("20");
    expect(valueFromChip("name", " PANADOL ")).toBe("PANADOL");
  });
});

const match = { id: "p1", name: "Panadol Extra", unitsPerPack: 20 };

describe("planCommit", () => {
  const values = reviewValuesFrom(scan());

  it("adds a batch to the matched product", () => {
    const plan = planCommit("addBatch", values, 12, match);
    expect(plan).toMatchObject({
      _tag: "AddBatch",
      productId: "p1",
      batch: { batchNumber: "AB1234", packQuantity: 12, unitQuantity: 0 },
    });
    expect(plan._tag === "AddBatch" && new Date(plan.batch.expiresAt ?? 0).getDate()).toBe(31);
  });

  it("creates a new product with its first batch", () => {
    expect(planCommit("newProduct", values, 3, null)).toMatchObject({
      _tag: "NewProduct",
      product: { name: "Panadol Extra", strength: "500mg", unitsPerPack: 20 },
      batch: { packQuantity: 3 },
    });
  });

  it("rejects incomplete input with a specific message", () => {
    expect(planCommit("addBatch", values, 0, match)).toEqual({
      _tag: "Invalid",
      message: "Enter how many packs arrived.",
    });
    expect(planCommit("addBatch", { ...values, expiresAt: "soon" }, 1, match)).toEqual({
      _tag: "Invalid",
      message: "Enter the expiry as MM/YYYY.",
    });
    expect(planCommit("newProduct", { ...values, unitsPerPack: "" }, 1, null)).toEqual({
      _tag: "Invalid",
      message: "Enter how many units are in one pack.",
    });
    expect(planCommit("addBatch", values, 1, null)._tag).toBe("Invalid");
  });
});

describe("commitLabel", () => {
  const values = reviewValuesFrom(scan());

  it("names the effect of the commit", () => {
    expect(commitLabel("addBatch", values, 12, match)).toBe("Add 12 packs to Panadol Extra");
    expect(commitLabel("newProduct", values, 1, null)).toBe("Create Panadol Extra with 1 pack");
  });

  it("follows a product picked by hand", () => {
    const picked = { id: "p2", name: "Panadol CF", unitsPerPack: 10 };
    expect(commitLabel("addBatch", values, 2, picked)).toBe("Add 2 packs to Panadol CF");
    expect(commitSummary("addBatch", values, 2, picked)).toBe("Added 2 packs to Panadol CF");
    expect(commitSummary("newProduct", values, 1, null)).toBe("Created Panadol Extra with 1 pack");
  });
});

describe("auto-fill while editing", () => {
  const empty = reviewValuesFrom(null);

  it("fills only the fields the user has not touched and reports them", () => {
    const typed = { ...empty, batchNumber: "XY99" };
    const merged = mergeAutoFill(typed, new Set(["batchNumber"]), scan());
    expect(merged.values).toEqual({ ...reviewValuesFrom(scan()), batchNumber: "XY99" });
    expect(merged.filled).toEqual(["name", "composition", "strength", "unitsPerPack", "expiresAt"]);
  });

  it("keeps a value when the parse left that field empty", () => {
    const current = { ...empty, strength: "250mg" };
    const merged = mergeAutoFill(current, new Set(), scan({ strength: null }));
    expect(merged.values.strength).toBe("250mg");
    expect(merged.filled).not.toContain("strength");
  });

  it("round-trips saved edits over a later parse", () => {
    const values = { ...empty, name: "Panadol", expiresAt: "08/2027" };
    const edits = editsFrom(values, new Set(["name", "expiresAt"]));
    expect(edits).toEqual({ name: "Panadol", expiresAt: "08/2027" });
    expect([...editedFields(edits)]).toEqual(["name", "expiresAt"]);
    expect(reviewValuesWith(scan(), edits)).toEqual({
      ...reviewValuesFrom(scan()),
      name: "Panadol",
    });
    expect(sameEdits(undefined, {})).toBe(true);
    expect(sameEdits(edits, { name: "Panadol", expiresAt: "08/2027" })).toBe(true);
    expect(sameEdits(edits, { name: "Panadol" })).toBe(false);
  });
});

describe("needsCheck", () => {
  it("is ready when the batch fields are confirmed by the label", () => {
    const result = scan();
    expect(needsCheck(deriveFieldFlags(result, label), result, true)).toBe(false);
  });

  it("needs a check for low confidence or unconfirmed batch fields", () => {
    const low = scan({ confidence: 0.5 });
    expect(needsCheck(deriveFieldFlags(low, label), low, true)).toBe(true);
    const wrongBatch = scan({ batchNumber: "ZZ9" });
    expect(needsCheck(deriveFieldFlags(wrongBatch, label), wrongBatch, true)).toBe(true);
  });

  it("ignores absent optional product details for a new product", () => {
    const result = scan({ composition: null });
    expect(needsCheck(deriveFieldFlags(result, label), result, false)).toBe(false);
  });
});
