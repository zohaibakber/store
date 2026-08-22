import type { ProductScanInference, ProductScanMode } from "@/features/product-scanner/types";

export type ScanActivity = "ready" | "capturing" | "analyzing";

export type ScanPhase =
  | { type: "idle"; activity: ScanActivity }
  | {
      type: "reviewProduct";
      inference: ProductScanInference;
      matchedProductId: string | null;
    }
  | {
      type: "inventoryReady";
      productId: string;
      batchScan:
        | null
        | { type: "scanning"; activity: ScanActivity }
        | { type: "reviewBatch"; inference: ProductScanInference };
    };

export type ScanPending = null | "product" | "batch" | "quantity";

export const idlePhase = (activity: ScanActivity = "ready"): ScanPhase => ({
  type: "idle",
  activity,
});

export const scanCaptureMode = (phase: ScanPhase): ProductScanMode =>
  phase.type === "inventoryReady" && phase.batchScan ? "batch" : "product";

export const scanReviewOpen = (phase: ScanPhase): boolean =>
  phase.type === "reviewProduct" || phase.type === "inventoryReady";

export const scanCameraBusy = (phase: ScanPhase): boolean => {
  if (phase.type === "idle") return phase.activity !== "ready";
  if (phase.type === "inventoryReady" && phase.batchScan?.type === "scanning") {
    return phase.batchScan.activity !== "ready";
  }
  return false;
};

export const scanCameraStatus = (
  phase: ScanPhase,
  options: { cameraActive: boolean; syncing: boolean },
): "paused" | "syncing" | "analyzing" | "ready" => {
  if (!options.cameraActive) return "paused";
  if (options.syncing) return "syncing";
  if (phase.type === "idle" && phase.activity === "analyzing") return "analyzing";
  if (
    phase.type === "inventoryReady" &&
    phase.batchScan?.type === "scanning" &&
    phase.batchScan.activity === "analyzing"
  ) {
    return "analyzing";
  }
  return "ready";
};

export interface ScanSheetCopy {
  readonly title: string;
  readonly subtitle: string;
}

export const scanSheetTitle = (phase: ScanPhase): ScanSheetCopy => {
  if (phase.type === "reviewProduct") {
    return {
      title: "Review product",
      subtitle: "Everything stays editable until you save.",
    };
  }
  if (phase.type === "inventoryReady" && phase.batchScan?.type === "reviewBatch") {
    return {
      title: "Review batch",
      subtitle: "Confirm the lot and expiry, then save.",
    };
  }
  return {
    title: "Inventory",
    subtitle: "Everything stays editable until you save.",
  };
};

export const withActivity = (phase: ScanPhase, activity: ScanActivity): ScanPhase => {
  if (phase.type === "idle") return { ...phase, activity };
  if (phase.type === "inventoryReady" && phase.batchScan?.type === "scanning") {
    return { ...phase, batchScan: { type: "scanning", activity } };
  }
  return phase;
};
