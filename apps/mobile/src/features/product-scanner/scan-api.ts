import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { normalizeExpiry, parseProductTextLocally } from "@/features/product-scanner/local-parser";
import type { ProductScanInference, ProductScanMode } from "@/features/product-scanner/types";
import { ProductScanResult } from "@/features/product-scanner/types";
import { apiOrigin, nativeAuthHeaders } from "@/lib/auth-client";

const SCAN_TIMEOUT_MS = 20_000;

const decodeResult = (input: Response): Promise<ProductScanResult | null> => {
  return input
    .json()
    .then(Schema.decodeUnknownOption(ProductScanResult))
    .then(
      Option.match({
        onNone: () => null,
        onSome: (result) =>
          result.expiresAt !== null && normalizeExpiry(result.expiresAt) === null ? null : result,
      }),
    )
    .catch(() => null);
};

export const inferProductText = async (
  recognizedText: string,
  mode: ProductScanMode,
): Promise<ProductScanInference> => {
  const scanText = recognizedText.trim().slice(0, 12_000);
  const local = parseProductTextLocally(scanText, mode);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiOrigin}/api/product-scans`, {
      method: "POST",
      credentials: "omit",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(await nativeAuthHeaders()),
      },
      body: JSON.stringify({ recognizedText: scanText, mode }),
    });
    if (!response.ok) return { ...local, source: "device" };
    const parsed = await decodeResult(response);
    if (!parsed) return { ...local, source: "device" };

    return { ...parsed, source: "cloud" };
  } catch {
    return { ...local, source: "device" };
  } finally {
    clearTimeout(timeout);
  }
};
