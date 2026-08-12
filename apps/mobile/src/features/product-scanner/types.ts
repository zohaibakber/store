export type ProductScanMode = "product" | "batch";

export type ProductScanResult = {
  name: string | null;
  composition: string | null;
  strength: string | null;
  unitsPerPack: number | null;
  batchNumber: string | null;
  /** A calendar date, normalized to YYYY-MM-DD whenever it can be read. */
  expiresAt: string | null;
  confidence: number;
};

export type ProductScanInference = ProductScanResult & {
  source: "cloud" | "device";
};
