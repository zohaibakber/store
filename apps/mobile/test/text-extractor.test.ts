import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOptionalNativeModule = vi.fn();

vi.mock("expo", () => ({ requireOptionalNativeModule }));

describe("text extractor", () => {
  beforeEach(() => {
    vi.resetModules();
    requireOptionalNativeModule.mockReset();
  });

  it("loads safely when the native OCR module is absent", async () => {
    requireOptionalNativeModule.mockReturnValue(null);

    const scanner = await import("../src/features/product-scanner/text-extractor");

    expect(scanner.isTextRecognitionSupported).toBe(false);
    expect(() => scanner.extractTextFromImage("file:///tmp/label.jpg")).toThrow(
      "Text recognition is not available in this app build.",
    );
  });

  it("uses the native OCR module when it is present", async () => {
    const extractTextFromImage = vi.fn().mockResolvedValue(["Product label"]);
    requireOptionalNativeModule.mockReturnValue({ isSupported: true, extractTextFromImage });

    const scanner = await import("../src/features/product-scanner/text-extractor");

    await expect(scanner.extractTextFromImage("file:///tmp/label.jpg")).resolves.toEqual([
      "Product label",
    ]);
    expect(extractTextFromImage).toHaveBeenCalledWith("/tmp/label.jpg");
  });
});
