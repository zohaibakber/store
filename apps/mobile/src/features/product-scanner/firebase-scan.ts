import { File } from "expo-file-system";
import { getGenerativeModel, Schema } from "firebase/ai";

import {
  decodeProductScanResult,
  promptForMode,
} from "@/features/product-scanner/firebase-scan-core";
import type { ProductScanInference, ProductScanMode } from "@/features/product-scanner/types";
import { getFirebaseAi } from "@/lib/firebase";

const SCAN_TIMEOUT_MS = 25_000;

const productScanResponseSchema = Schema.object({
  properties: {
    name: Schema.string({
      nullable: true,
      description: "Product or brand name as printed on the package.",
    }),
    composition: Schema.string({
      nullable: true,
      description: "Active ingredient(s) without strength.",
    }),
    strength: Schema.string({
      nullable: true,
      description: "Numeric strength with unit, e.g. 500mg or 5mg/5ml.",
    }),
    unitsPerPack: Schema.integer({
      nullable: true,
      description: "Count of sale units in one sealed pack when printed.",
      minimum: 1,
      maximum: 10_000,
    }),
    batchNumber: Schema.string({
      nullable: true,
      description: "Batch, lot, B.No, BN, or LOT value.",
    }),
    expiresAt: Schema.string({
      nullable: true,
      description: "Expiry as YYYY-MM-DD or YYYY-MM when only month/year is printed.",
    }),
    confidence: Schema.number({
      description: "Overall extraction confidence from 0 to 1.",
      minimum: 0,
      maximum: 1,
    }),
  },
  optionalProperties: [
    "name",
    "composition",
    "strength",
    "unitsPerPack",
    "batchNumber",
    "expiresAt",
  ],
});

/**
 * Multimodal label extraction via Firebase AI Logic (Gemini Developer API).
 * Replaces on-device OCR + `/api/product-scans` for the mobile scanner.
 */
export const inferProductFromImage = async (
  imageUri: string,
  mode: ProductScanMode,
): Promise<ProductScanInference> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  try {
    const ai = getFirebaseAi();
    const model = getGenerativeModel(ai, {
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: productScanResponseSchema,
      },
    });

    const data = await new File(imageUri).base64();
    const result = await model.generateContent(
      [
        promptForMode(mode),
        {
          inlineData: {
            mimeType: "image/jpeg",
            data,
          },
        },
      ],
      { signal: controller.signal },
    );

    const parsed = decodeProductScanResult(result.response.text());
    if (!parsed) {
      throw new Error("The label could not be understood. Try again with a clearer photo.");
    }

    return { ...parsed, source: "cloud" };
  } finally {
    clearTimeout(timeout);
  }
};
