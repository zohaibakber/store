import { describe, expect, it } from "vitest";

import type { ParseState, ScanDraft } from "../src/scan/model";
import { batchRow, countStatuses, draftStatus, statusSummary } from "../src/scan/status";

const label = "PANADOL Extra 500mg 2 x 10 Tablets B.No AB1234 EXP 08/27";

const parsed: ParseState = {
  _tag: "Parsed",
  parsedAt: 1,
  result: {
    name: "Panadol Extra",
    composition: null,
    strength: "500mg",
    unitsPerPack: 20,
    batchNumber: "AB1234",
    expiresAt: "2027-08",
    confidence: 0.9,
  },
};

const draft = (parse: ParseState): ScanDraft => ({
  id: "d1",
  mode: "batch",
  photoUri: null,
  recognizedText: label,
  lines: [],
  packs: 3,
  capturedAt: 0,
  updatedAt: 0,
  parse,
});

const match = { id: "p1", name: "Panadol Extra", unitsPerPack: 20 };

describe("draftStatus", () => {
  it("is still reading while auto-fill is pending", () => {
    expect(draftStatus(draft({ _tag: "Waiting" }), false, null)).toBe("reading");
    expect(draftStatus(draft({ _tag: "RateLimited", retryAt: 10 }), false, null)).toBe("reading");
    expect(draftStatus(draft(parsed), true, null)).toBe("reading");
  });

  it("needs a check after a failed or manual auto-fill", () => {
    expect(draftStatus(draft({ _tag: "Failed", attempts: 1, reason: "x" }), false, null)).toBe(
      "check",
    );
    expect(draftStatus(draft({ _tag: "Manual" }), false, true)).toBe("check");
  });
});

describe("batchRow", () => {
  it("plans a batch for a matched product with the draft's pack count", () => {
    expect(batchRow(draft(parsed), false, match)).toMatchObject({
      status: "ready",
      plan: { _tag: "AddBatch", productId: "p1", batch: { packQuantity: 3 } },
    });
  });

  it("plans a new product when nothing matches", () => {
    expect(batchRow(draft(parsed), false, null).plan?._tag).toBe("NewProduct");
  });

  it("keeps rows that cannot be committed as they are", () => {
    const missingUnits: ParseState = {
      ...parsed,
      result: { ...parsed.result, unitsPerPack: null },
    };
    expect(batchRow(draft(missingUnits), false, null)).toEqual({ status: "check", plan: null });
  });
});

describe("statusSummary", () => {
  it("summarises the batch review", () => {
    const counts = countStatuses(["ready", "ready", "check", "reading", "ready"]);
    expect(statusSummary(counts)).toBe("3 ready, 1 to check, 1 still reading");
    expect(statusSummary(countStatuses([]))).toBe("Nothing scanned yet");
  });
});
