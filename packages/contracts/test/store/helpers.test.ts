import { describe, expect, test } from "vitest";

import { inventorySkuKey, normalizedProductName } from "../../src/store/helpers";

describe("inventory SKU matching", () => {
  test("treats the same name with a different pack size as a different SKU", () => {
    expect(normalizedProductName("  Amoxicillin ")).toBe("amoxicillin");
    expect(inventorySkuKey("Amoxicillin", 10)).not.toBe(inventorySkuKey("Amoxicillin", 20));
    expect(inventorySkuKey("Amoxicillin", 20)).toBe(inventorySkuKey("  amoxicillin", 20));
  });
});
