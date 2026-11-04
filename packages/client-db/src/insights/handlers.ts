import type { AnalyticsStatus, InsightsContext } from "@store/contracts";
import { InventoryInsights, type InsightsChange } from "@store/contracts/replica";
import * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { AnalyticsFailure } from "../analytics/errors";
import type { AnalyticsStore } from "../analytics/store";
import { readFailure } from "../store/failures";

type AnalyticsRuns = {
  readonly store: Pick<AnalyticsStore, "published" | "products" | "restockPage">;
  readonly observe: (context: InsightsContext) => Effect.Effect<AnalyticsStatus>;
  readonly changes: Stream.Stream<InsightsChange>;
};

export const layerInventoryInsights = ({ store, observe, changes }: AnalyticsRuns) => {
  const stored = <A>(read: Effect.Effect<A, AnalyticsFailure>) =>
    Effect.mapError(read, (failure) => readFailure(failure.cause ?? failure));
  return InventoryInsights.toLayer({
    InsightsSummary: Effect.fn("InventoryInsights.summary")(function* ({ context }) {
      const status = yield* observe(context);
      const published = yield* stored(store.published());
      return { summary: published?.summary ?? null, status };
    }),
    ProductInsights: Effect.fn("InventoryInsights.products")(function* ({ context, ids }) {
      const status = yield* observe(context);
      const found = yield* stored(store.products(ids));
      return { run: found.run ?? null, insights: found.insights, status };
    }),
    RestockPage: Effect.fn("InventoryInsights.restockPage")(function* ({ context, request }) {
      const status = yield* observe(context);
      const page = yield* stored(store.restockPage(request));
      return page === undefined
        ? { run: null, rows: [], nextCursor: null, total: 0, cursorExpired: false, status }
        : { ...page, status };
    }),
    Changes: () => changes,
  });
};
