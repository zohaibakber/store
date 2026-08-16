import { describe, expect, it, vi } from "vitest";

import { createTextExtractor } from "../src/features/product-scanner/text-extractor-core";

describe("text extractor", () => {
  it("loads safely when the native OCR module is absent", () => {
    const scanner = createTextExtractor(null);

    expect(scanner.isTextRecognitionSupported).toBe(false);
    expect(() => scanner.extractTextFromImage("file:///tmp/label.jpg")).toThrow(
      "Text recognition is not available in this app build.",
    );
  });

  it("uses the native OCR module when it is present", async () => {
    const extractTextFromImage = vi.fn().mockResolvedValue(["Product label"]);
    const scanner = createTextExtractor({ isSupported: true, extractTextFromImage });

    await expect(scanner.extractTextFromImage("file:///tmp/label.jpg")).resolves.toEqual([
      "Product label",
    ]);
    expect(extractTextFromImage).toHaveBeenCalledWith("/tmp/label.jpg");
  });
});
