import type { ProductScanResult } from "@store/contracts/server-api.schema";
import { describe, expect, it } from "vitest";

import {
  commitLabel,
  commitSummary,
  deriveFieldFlags,
  editedFields,
  editsFrom,
  mergeAutoFill,
  needsCheck,
  planCommit,
  reviewValuesWith,
  sameEdits,
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

describe("deriveFieldFlags", () => {
  it("flags nothing when every value appears on the label", () => {
    const flags = deriveFieldFlags(scan({ composition: null }), label);
    expect(Object.entries(flags).filter(([, flag]) => flag !== null)).toEqual([
      ["composition", "Not found on the label"],
    ]);
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
    expect(Object.values(deriveFieldFlags(null, label)).every((flag) => flag === null)).toBe(true);
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

const parsedValues = {
  name: "Panadol Extra",
  composition: "Paracetamol + Caffeine",
  strength: "500mg",
  unitsPerPack: "20",
  batchNumber: "AB1234",
  expiresAt: "08/2027",
};

const empty = {
  name: "",
  composition: "",
  strength: "",
  unitsPerPack: "",
  batchNumber: "",
  expiresAt: "",
};

describe("planCommit", () => {
  const values = parsedValues;

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
  it("names the effect of the commit on the chosen product", () => {
    const picked = { id: "p2", name: "Panadol CF", unitsPerPack: 10 };
    expect(commitLabel("addBatch", parsedValues, 12, match)).toBe("Add 12 packs to Panadol Extra");
    expect(commitLabel("newProduct", parsedValues, 1, null)).toBe(
      "Create Panadol Extra with 1 pack",
    );
    expect(commitLabel("addBatch", parsedValues, 2, picked)).toBe("Add 2 packs to Panadol CF");
    expect(commitSummary("addBatch", parsedValues, 2, picked)).toBe("Added 2 packs to Panadol CF");
    expect(commitSummary("newProduct", parsedValues, 1, null)).toBe(
      "Created Panadol Extra with 1 pack",
    );
  });
});

describe("auto-fill while editing", () => {
  it("fills only the fields the user has not touched and reports them", () => {
    const typed = { ...empty, batchNumber: "XY99" };
    const merged = mergeAutoFill(typed, new Set(["batchNumber"]), scan());
    expect(merged.values).toEqual({ ...parsedValues, batchNumber: "XY99" });
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
      ...parsedValues,
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
