import { describe, expect, it } from "vitest";

import { sameProduct } from "@/components/uploads/same-product";

describe("sameProduct", () => {
  it("restocks only when the name and units per pack both match", () => {
    const line = { name: "Amoxicillin", unitsPerPack: 20 };
    expect(sameProduct(line, { name: "Amoxicillin", unitsPerPack: 20 })).toBe(true);
    expect(sameProduct(line, { name: "amoxicillin", unitsPerPack: 20 })).toBe(true);
    expect(sameProduct(line, { name: "Amoxicillin", unitsPerPack: 10 })).toBe(false);
    expect(sameProduct(line, { name: "Ibuprofen", unitsPerPack: 20 })).toBe(false);
  });
});
