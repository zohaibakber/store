import { describe, expect, it } from "vitest";

import {
  decodeProductScanResult,
  promptForMode,
} from "../src/features/product-scanner/firebase-scan-core";

describe("firebase product scan helpers", () => {
  it("builds a mode-specific extraction prompt", () => {
    expect(promptForMode("product")).toContain("Scan mode: product");
    expect(promptForMode("batch")).toContain("Prioritize batch number and expiry");
  });

  it("decodes a valid model payload", () => {
    const result = decodeProductScanResult(
      JSON.stringify({
        name: "Amoxicillin",
        composition: "Amoxicillin trihydrate",
        strength: "500mg",
        unitsPerPack: 10,
        batchNumber: "bn-2048",
        expiresAt: "2027-06",
        confidence: 0.91,
      }),
    );

    expect(result).toMatchObject({
      name: "Amoxicillin",
      composition: "Amoxicillin trihydrate",
      strength: "500mg",
      unitsPerPack: 10,
      batchNumber: "BN-2048",
      confidence: 0.91,
    });
    expect(result?.expiresAt).toMatch(/^2027-06/);
  });

  it("repairs concatenated 10x10 when the name still has the factors", () => {
    const result = decodeProductScanResult(
      JSON.stringify({
        name: "Amoxicillin 10x10",
        composition: null,
        strength: "500mg",
        unitsPerPack: 1010,
        batchNumber: null,
        expiresAt: null,
        confidence: 0.9,
      }),
    );
    expect(result?.unitsPerPack).toBe(100);
  });

  it("rejects malformed JSON", () => {
    expect(decodeProductScanResult("not-json")).toBeNull();
  });
});
