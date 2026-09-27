import { describe, expect, it } from "vitest";

import { brandQuery, pickCatalogMatch } from "../src/scan/matching";

const product = (
  id: string,
  name: string,
  strength: string | null,
  composition: string | null,
) => ({
  id,
  name,
  strength,
  composition,
  unitsPerPack: 10,
});

const catalog = [
  product("extra", "Panadol Extra", "500mg", "Paracetamol + Caffeine"),
  product("cf", "Panadol CF", "500mg", "Paracetamol"),
  product("brufen-400", "Brufen", "400mg", "Ibuprofen"),
  product("brufen-200", "Brufen", "200mg", "Ibuprofen"),
  product("calpol", "Calpol", "120mg/5ml", "Paracetamol"),
];

describe("pickCatalogMatch", () => {
  it("matches the full product name", () => {
    expect(
      pickCatalogMatch(catalog, { name: "PANADOL EXTRA", composition: null, strength: null })?.id,
    ).toBe("extra");
  });

  it("uses strength to choose between variants", () => {
    expect(
      pickCatalogMatch(catalog, { name: "Brufen", composition: "Ibuprofen", strength: "200 mg" })
        ?.id,
    ).toBe("brufen-200");
  });

  it("falls back to the brand with a matching strength", () => {
    expect(
      pickCatalogMatch(catalog, {
        name: "Calpol Suspension",
        composition: null,
        strength: "120mg/5ml",
      })?.id,
    ).toBe("calpol");
  });

  it("returns nothing for an unknown product", () => {
    expect(
      pickCatalogMatch(catalog, {
        name: "Augmentin",
        composition: "Amoxicillin",
        strength: "625mg",
      }),
    ).toBeNull();
  });

  it("uses the first word as the brand query", () => {
    expect(brandQuery({ name: " Panadol  Extra ", composition: null, strength: null })).toBe(
      "Panadol",
    );
  });
});
