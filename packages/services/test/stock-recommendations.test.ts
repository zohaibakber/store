import { it } from "@effect/vitest";
import { decodeCategoryId, decodeProductId, type Product } from "@store/contracts";
import { Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { expect } from "vitest";

import {
  DEFAULT_STOCK_POLICY,
  StockRecommendationService,
  stockRecommendationLayer,
} from "../src/stock-recommendations/service";

const now = Date.UTC(2026, 8, 13);
const metadata = {
  organizationId: "org",
  createdByUserId: "user",
  updatedByUserId: "user",
  deviceId: "device",
  operationId: "op",
  rowVersion: 1,
  createdAt: now - 90 * 86400000,
  updatedAt: now,
};
const product: Product = {
  ...metadata,
  id: decodeProductId("p"),
  name: "Product",
  categoryId: decodeCategoryId("c"),
  category: { ...metadata, id: decodeCategoryId("c"), name: "Category", tracksPacks: true },
  aisle: null,
  composition: null,
  strength: null,
  unitsPerPack: 10,
  purchasePrice: null,
  retailPrice: null,
  unitPrice: null,
  visible: true,
  batches: [],
};
const snapshot = {
  organizationId: "org",
  products: [product],
  invoices: [],
  policy: DEFAULT_STOCK_POLICY,
};

it.effect("service uses Effect clock and preserves the evidence-poor review result", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now);
    const service = yield* StockRecommendationService;
    const report = yield* service.analyze(snapshot);
    expect(report.generatedAt).toBe(now);
    expect(report.recommendations[0]).toMatchObject({
      status: "out",
      history: "limited",
      orderQuantity: 0,
    });
    yield* TestClock.adjust("1 day");
    expect((yield* service.analyze(snapshot)).generatedAt).toBe(now + 86400000);
  }).pipe(Effect.provide(stockRecommendationLayer)),
);

it.effect("invalid policy fails in the typed error channel", () =>
  Effect.gen(function* () {
    const service = yield* StockRecommendationService;
    for (const invalid of [NaN, Infinity, -1, 1.5, 91]) {
      const result = yield* service
        .analyze({ ...snapshot, policy: { ...DEFAULT_STOCK_POLICY, leadDays: invalid } })
        .pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure._tag).toBe("StockRecommendationError");
    }
  }).pipe(Effect.provide(stockRecommendationLayer)),
);

it.effect("rejects mixed organizations instead of producing a mixed buy list", () =>
  Effect.gen(function* () {
    const service = yield* StockRecommendationService;
    const result = yield* service
      .analyze({ ...snapshot, organizationId: "another-org" })
      .pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure.message).toContain("one organization");
  }).pipe(Effect.provide(stockRecommendationLayer)),
);

it.effect("rejects invalid pack sizes before calculating order quantities", () =>
  Effect.gen(function* () {
    const service = yield* StockRecommendationService;
    const result = yield* service
      .analyze({ ...snapshot, products: [{ ...product, unitsPerPack: 0 }] })
      .pipe(Effect.result);
    expect(Result.isFailure(result)).toBe(true);
  }).pipe(Effect.provide(stockRecommendationLayer)),
);
