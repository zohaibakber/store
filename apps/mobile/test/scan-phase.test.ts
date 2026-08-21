import { describe, expect, it } from "vitest";

import {
  idlePhase,
  scanCameraBusy,
  scanCameraStatus,
  scanCaptureMode,
  scanReviewOpen,
  scanSheetTitle,
  withActivity,
  type ScanPhase,
} from "../src/features/product-scanner/scan-phase";
import type { ProductScanInference } from "../src/features/product-scanner/types";

const inference = (overrides: Partial<ProductScanInference> = {}): ProductScanInference => ({
  name: "Amoxicillin",
  composition: null,
  strength: "500mg",
  unitsPerPack: 10,
  batchNumber: "BN-1",
  expiresAt: "2027-06",
  confidence: 0.9,
  source: "cloud",
  ...overrides,
});

describe("scan phase helpers", () => {
  it("keeps product capture mode until a batch scan overlay is open", () => {
    expect(scanCaptureMode(idlePhase())).toBe("product");
    expect(
      scanCaptureMode({
        type: "inventoryReady",
        productId: "p1",
        batchScan: null,
      }),
    ).toBe("product");
    expect(
      scanCaptureMode({
        type: "inventoryReady",
        productId: "p1",
        batchScan: { type: "scanning", activity: "ready" },
      }),
    ).toBe("batch");
  });

  it("opens the review sheet for product review and inventory", () => {
    expect(scanReviewOpen(idlePhase())).toBe(false);
    expect(
      scanReviewOpen({
        type: "reviewProduct",
        inference: inference(),
        matchedProductId: null,
      }),
    ).toBe(true);
    expect(
      scanReviewOpen({
        type: "inventoryReady",
        productId: "p1",
        batchScan: null,
      }),
    ).toBe(true);
  });

  it("reports camera busy only while capturing or analyzing", () => {
    expect(scanCameraBusy(idlePhase())).toBe(false);
    expect(scanCameraBusy(idlePhase("capturing"))).toBe(true);
    expect(scanCameraBusy(idlePhase("analyzing"))).toBe(true);
    const inventoryScanning: ScanPhase = {
      type: "inventoryReady",
      productId: "p1",
      batchScan: { type: "scanning", activity: "analyzing" },
    };
    expect(scanCameraBusy(inventoryScanning)).toBe(true);
    expect(scanCameraBusy(withActivity(inventoryScanning, "ready"))).toBe(false);
  });

  it("maps camera status with pause and sync taking priority", () => {
    expect(scanCameraStatus(idlePhase("analyzing"), { cameraActive: false, syncing: false })).toBe(
      "paused",
    );
    expect(scanCameraStatus(idlePhase("analyzing"), { cameraActive: true, syncing: true })).toBe(
      "syncing",
    );
    expect(scanCameraStatus(idlePhase("analyzing"), { cameraActive: true, syncing: false })).toBe(
      "analyzing",
    );
    expect(scanCameraStatus(idlePhase(), { cameraActive: true, syncing: false })).toBe("ready");
  });

  it("titles the sheet from the active review step", () => {
    expect(scanSheetTitle({ type: "reviewProduct", inference: inference(), matchedProductId: null }))
      .toMatchObject({ title: "Review product" });
    expect(
      scanSheetTitle({
        type: "inventoryReady",
        productId: "p1",
        batchScan: { type: "reviewBatch", inference: inference() },
      }),
    ).toMatchObject({ title: "Review batch" });
    expect(
      scanSheetTitle({ type: "inventoryReady", productId: "p1", batchScan: null }),
    ).toMatchObject({ title: "Inventory" });
  });
});
