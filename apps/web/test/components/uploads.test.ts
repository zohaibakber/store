import { decodeProductId } from "@store/contracts/ids";
import { describe, expect, it } from "vitest";

import { importProductMatch, sameProduct } from "@/components/uploads/same-product";

describe("sameProduct", () => {
  it("restocks only when the name and units per pack both match", () => {
    const line = { name: "Amoxicillin", unitsPerPack: 20 };
    expect(sameProduct(line, { name: "Amoxicillin", unitsPerPack: 20 })).toBe(true);
    expect(sameProduct(line, { name: "amoxicillin", unitsPerPack: 20 })).toBe(true);
    expect(sameProduct(line, { name: "Amoxicillin", unitsPerPack: 10 })).toBe(false);
    expect(sameProduct(line, { name: "Ibuprofen", unitsPerPack: 20 })).toBe(false);
  });
});

describe("importProductMatch", () => {
  const ten = {
    id: decodeProductId("11111111-1111-4111-8111-111111111111"),
    name: "Amoxicillin",
    unitsPerPack: 10,
  };
  const twenty = {
    id: decodeProductId("22222222-2222-4222-8222-222222222222"),
    name: "Amoxicillin",
    unitsPerPack: 20,
  };
  const duplicateTwenty = {
    id: decodeProductId("33333333-3333-4333-8333-333333333333"),
    name: "amoxicillin",
    unitsPerPack: 20,
  };

  it("binds the only catalog product with that SKU", () => {
    expect(importProductMatch({ name: "Amoxicillin", unitsPerPack: 20 }, [ten, twenty])).toEqual({
      _tag: "one",
      id: twenty.id,
    });
  });

  it("does not invent a match for a new SKU", () => {
    expect(importProductMatch({ name: "Ibuprofen", unitsPerPack: 10 }, [ten, twenty])).toEqual({
      _tag: "none",
    });
  });

  it("refuses to pick when two live products share the SKU", () => {
    expect(
      importProductMatch({ name: "Amoxicillin", unitsPerPack: 20 }, [ten, twenty, duplicateTwenty]),
    ).toEqual({ _tag: "many" });
  });
});
