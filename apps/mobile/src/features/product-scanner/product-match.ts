import type { ProductScanResult } from "@/features/product-scanner/types";
import type { MobileProduct } from "@/lib/inventory-types";

const normalized = (value: string | null | undefined) =>
  value
    ?.normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim() ?? "";

const words = (value: string) => new Set(value.split(/\s+/).filter((part) => part.length > 1));

const overlap = (left: string, right: string) => {
  const leftWords = words(left);
  const rightWords = words(right);
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let shared = 0;
  for (const word of leftWords) if (rightWords.has(word)) shared += 1;
  return shared / Math.max(leftWords.size, rightWords.size);
};

const matchScore = (product: MobileProduct, result: ProductScanResult, recognizedText: string) => {
  const productName = normalized(product.name);
  const inferredName = normalized(result.name);
  const ocr = normalized(recognizedText);
  let score = 0;

  if (inferredName && inferredName === productName) score = 0.68;
  else if (productName.length >= 3 && ocr.includes(productName)) score = 0.62;
  else if (inferredName) score = overlap(productName, inferredName) * 0.64;

  const inferredComposition = normalized(result.composition);
  const productComposition = normalized(product.composition);
  if (inferredComposition && productComposition) {
    const compositionScore =
      inferredComposition === productComposition
        ? 1
        : overlap(productComposition, inferredComposition);
    score += compositionScore * 0.18;
    if (compositionScore < 0.25) score -= 0.28;
  }

  const inferredStrength = normalized(result.strength);
  const productStrength = normalized(product.strength);
  if (inferredStrength && productStrength)
    score += inferredStrength === productStrength ? 0.24 : -0.55;
  return Math.min(1, Math.max(0, score));
};

export const findProductMatch = (
  products: ReadonlyArray<MobileProduct>,
  result: ProductScanResult,
  recognizedText: string,
) => {
  const ranked = products
    .map((product) => ({ product, score: matchScore(product, result, recognizedText) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (!best || best.score < 0.5) return null;
  if (runnerUp && best.score - runnerUp.score < 0.08) return null;
  return best.product;
};
