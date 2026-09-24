import { decodeProductId } from "@store/contracts/ids";
import { DEFAULT_STOCK_POLICY } from "@store/services/stock-recommendations";
import { describe, expect, it } from "vitest";

import {
  catalogProductSearchResults,
  matchCatalogProducts,
  MAX_PRODUCT_SEARCH_RESULTS,
  productSearchRank,
  summarizeProductStock,
} from "../src/search";

const DAY_MS = 86_400_000;
const now = 1_800_000_000_000;

const product = (
  id: string,
  name: string,
  composition: string | null,
  strength: string | null,
) => ({
  id,
  name,
  composition,
  strength,
});

const catalog = [
  product("1", "Brufen", "Ibuprofen", "400mg"),
  product("2", "Panadol Extra", "Paracetamol, Caffeine", "500mg"),
  product("3", "Calpol", "Paracetamol", "120mg/5ml"),
  product("4", "Extra Panadol Syrup", null, null),
  product("5", "panadol", "Paracetamol", "500mg"),
  product("6", "Adol Panadolic", null, null),
];

const names = (query: string, limit = 50) =>
  matchCatalogProducts(catalog, query, limit).map((entry) => entry.name);

describe("catalog product search matching", () => {
  it("ranks name prefixes before word prefixes, name substrings and detail matches", () => {
    expect(names("panadol")).toEqual([
      "panadol",
      "Panadol Extra",
      "Adol Panadolic",
      "Extra Panadol Syrup",
    ]);
    expect(names("adol")).toEqual([
      "Adol Panadolic",
      "Extra Panadol Syrup",
      "panadol",
      "Panadol Extra",
    ]);
  });

  it("matches case-insensitively across name, composition and strength", () => {
    expect(names("PARACETAMOL")).toEqual(["Calpol", "panadol", "Panadol Extra"]);
    expect(names("  panadol   500 ")).toEqual(["panadol", "Panadol Extra"]);
    expect(names("ibu 400")).toEqual(["Brufen"]);
    expect(names("aspirin")).toEqual([]);
  });

  it("returns the whole catalog by name for an empty query and bounds every result", () => {
    expect(names("")).toEqual([
      "Adol Panadolic",
      "Brufen",
      "Calpol",
      "Extra Panadol Syrup",
      "panadol",
      "Panadol Extra",
    ]);
    expect(names("", 2)).toEqual(["Adol Panadolic", "Brufen"]);
    expect(names("", 0)).toHaveLength(1);
    const many = Array.from({ length: MAX_PRODUCT_SEARCH_RESULTS + 5 }, (_, index) =>
      product(String(index), `Item ${index}`, null, null),
    );
    expect(matchCatalogProducts(many, "item", 10_000)).toHaveLength(MAX_PRODUCT_SEARCH_RESULTS);
  });

  it("reports no rank for a product missing any query token", () => {
    expect(productSearchRank(catalog[1]!, "panadol caffeine")).toBe(3);
    expect(productSearchRank(catalog[1]!, "panadol aspirin")).toBeNull();
  });
});

const batch = (packQuantity: number, unitQuantity: number, expiresAt: number | null) => ({
  packQuantity,
  unitQuantity,
  expiresAt,
});

describe("product stock summary", () => {
  it("totals on-hand units, excludes expired stock from availability and finds the nearest expiry", () => {
    const summary = summarizeProductStock(
      { unitsPerPack: 10 },
      [
        batch(2, 3, now + 30 * DAY_MS),
        batch(1, 0, now - DAY_MS),
        batch(0, 5, null),
        batch(0, 0, now + DAY_MS),
      ],
      DEFAULT_STOCK_POLICY,
      now,
    );
    expect(summary).toEqual({
      onHandUnits: 38,
      availableUnits: 28,
      expiredUnits: 10,
      status: "healthy",
      lowStock: false,
      nearestExpiry: now + 30 * DAY_MS,
    });
  });

  it("flags low and out of stock against the stock policy minimum", () => {
    const low = summarizeProductStock(
      { unitsPerPack: 1 },
      [batch(DEFAULT_STOCK_POLICY.minimumUnits, 0, null)],
      DEFAULT_STOCK_POLICY,
      now,
    );
    expect(low).toMatchObject({ status: "low", lowStock: true, nearestExpiry: null });
    const out = summarizeProductStock(
      { unitsPerPack: 1 },
      [batch(4, 0, now)],
      DEFAULT_STOCK_POLICY,
      now,
    );
    expect(out).toMatchObject({ status: "out", lowStock: true, onHandUnits: 4, availableUnits: 0 });
    expect(summarizeProductStock({ unitsPerPack: 1 }, [], DEFAULT_STOCK_POLICY, now).status).toBe(
      "out",
    );
  });

  it("groups batches under their products in search order", () => {
    const first = decodeProductId("44444444-4444-4444-8444-444444444444");
    const second = decodeProductId("55555555-5555-4555-8555-555555555555");
    const results = catalogProductSearchResults(
      [
        { id: first, unitsPerPack: 2 },
        { id: second, unitsPerPack: 1 },
      ],
      [
        { productId: second, ...batch(0, 20, null) },
        { productId: first, ...batch(1, 0, null) },
        { productId: first, ...batch(2, 1, null) },
      ],
      DEFAULT_STOCK_POLICY,
      now,
    );
    expect(results.map((result) => [result.product.id, result.stock.onHandUnits])).toEqual([
      [first, 7],
      [second, 20],
    ]);
  });
});
