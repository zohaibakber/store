import type { Invoice, Product } from "@store/contracts";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import { recommendStock } from "./analysis";
import { StockPolicy } from "./policy";

export { DEFAULT_STOCK_POLICY, StockPolicy } from "./policy";
export type { StockRecommendation, StockStatus } from "./analysis";

export class StockRecommendationError extends Schema.TaggedError<StockRecommendationError>()(
  "StockRecommendationError",
  { message: Schema.String, cause: Schema.Defect() },
) {}

export interface StockSnapshot {
  readonly organizationId: string;
  readonly products: ReadonlyArray<Product>;
  readonly invoices: ReadonlyArray<Invoice>;
  readonly policy: StockPolicy;
}

export interface StockReport {
  readonly generatedAt: number;
  readonly policy: StockPolicy;
  readonly recommendations: ReturnType<typeof recommendStock>;
}

export class StockRecommendationService extends Context.Service<
  StockRecommendationService,
  {
    readonly analyze: (
      snapshot: StockSnapshot,
    ) => Effect.Effect<StockReport, StockRecommendationError>;
  }
>()("@store/services/StockRecommendationService") {}

export const stockRecommendationLayer = Layer.effect(
  StockRecommendationService,
  Effect.sync(() => {
    const analyze = Effect.fn("StockRecommendation.analyze")(function* (snapshot: StockSnapshot) {
      const policy = yield* Schema.decodeUnknownEffect(StockPolicy)(snapshot.policy).pipe(
        Effect.mapError(
          (cause) =>
            new StockRecommendationError({ message: "Check the stock planning values.", cause }),
        ),
      );
      const invalidProduct = snapshot.products.some(
        (product) =>
          product.organizationId !== snapshot.organizationId ||
          product.category.organizationId !== snapshot.organizationId ||
          !Number.isFinite(product.createdAt) ||
          (product.purchasePrice !== null &&
            (!Number.isFinite(product.purchasePrice) || product.purchasePrice < 0)) ||
          !Number.isInteger(product.unitsPerPack) ||
          product.unitsPerPack < 1 ||
          product.batches.some(
            (batch) =>
              batch.organizationId !== snapshot.organizationId ||
              batch.productId !== product.id ||
              (batch.expiresAt !== null && !Number.isFinite(batch.expiresAt)) ||
              !Number.isInteger(batch.packQuantity) ||
              batch.packQuantity < 0 ||
              !Number.isInteger(batch.unitQuantity) ||
              batch.unitQuantity < 0,
          ),
      );
      const invalidInvoice = snapshot.invoices.some(
        (invoice) =>
          invoice.organizationId !== snapshot.organizationId ||
          !Number.isFinite(invoice.createdAt) ||
          invoice.items.some(
            (item) =>
              item.organizationId !== snapshot.organizationId ||
              item.invoiceId !== invoice.id ||
              !Number.isInteger(item.baseUnitQuantity) ||
              item.baseUnitQuantity < 1,
          ),
      );
      if (invalidProduct || invalidInvoice) {
        return yield* new StockRecommendationError({
          message: "Stock recommendations need valid inventory and sales from one organization.",
          cause: "Invalid stock snapshot",
        });
      }
      const generatedAt = yield* Clock.currentTimeMillis;
      const recommendations = yield* Effect.sync(() =>
        recommendStock(snapshot.products, snapshot.invoices, policy, generatedAt),
      );
      return { generatedAt, policy, recommendations };
    });
    return StockRecommendationService.of({ analyze });
  }),
);
