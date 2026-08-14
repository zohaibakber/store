import { normalizeExpiry, parseProductTextLocally } from "@/features/product-scanner/local-parser";
import type {
  ProductScanInference,
  ProductScanMode,
  ProductScanResult,
} from "@/features/product-scanner/types";
import { apiOrigin, nativeAuthHeaders } from "@/lib/auth-client";

const SCAN_TIMEOUT_MS = 20_000;

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

const isNullableText = (value: unknown): value is string | null =>
  value === null || (typeof value === "string" && value.trim().length > 0);

const decodeResult = (value: unknown): ProductScanResult | null => {
  if (typeof value !== "object" || value === null) return null;
  const required = [
    "name",
    "composition",
    "strength",
    "unitsPerPack",
    "batchNumber",
    "expiresAt",
    "confidence",
  ];
  if (required.some((key) => !hasOwn(value, key))) return null;

  const name = Reflect.get(value, "name");
  const composition = Reflect.get(value, "composition");
  const strength = Reflect.get(value, "strength");
  const unitsPerPack = Reflect.get(value, "unitsPerPack");
  const batchNumber = Reflect.get(value, "batchNumber");
  const expiresAt = Reflect.get(value, "expiresAt");
  const confidence = Reflect.get(value, "confidence");
  if (
    !isNullableText(name) ||
    !isNullableText(composition) ||
    !isNullableText(strength) ||
    !isNullableText(batchNumber) ||
    !isNullableText(expiresAt) ||
    (unitsPerPack !== null &&
      (typeof unitsPerPack !== "number" ||
        !Number.isSafeInteger(unitsPerPack) ||
        unitsPerPack < 1 ||
        unitsPerPack > 10_000)) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    (expiresAt !== null && normalizeExpiry(expiresAt) === null)
  )
    return null;

  return {
    name: name?.trim() ?? null,
    composition: composition?.trim() ?? null,
    strength: strength?.trim() ?? null,
    unitsPerPack,
    batchNumber: batchNumber?.trim() ?? null,
    expiresAt,
    confidence,
  };
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
    const parsed = decodeResult(await response.json().catch(() => null));
    if (!parsed) return { ...local, source: "device" };

    return { ...parsed, source: "cloud" };
  } catch {
    return { ...local, source: "device" };
  } finally {
    clearTimeout(timeout);
  }
};
