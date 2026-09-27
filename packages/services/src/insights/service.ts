import type { ReplicaInsightsFacts } from "@store/contracts/sync/replica-insights";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import { analyzeInsights, type InsightsReport } from "./analysis";
import { StockPolicy } from "./policy";

export class InsightsError extends Schema.TaggedError<InsightsError>()("InsightsError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class InsightsService extends Context.Service<
  InsightsService,
  {
    readonly analyze: (input: {
      readonly facts: ReplicaInsightsFacts;
      readonly policy: StockPolicy;
    }) => Effect.Effect<InsightsReport, InsightsError>;
  }
>()("@store/services/InsightsService") {}

export const insightsLayer = Layer.succeed(
  InsightsService,
  InsightsService.of({
    analyze: Effect.fn("Insights.analyze")(function* (input) {
      const policy = yield* Schema.decodeUnknownEffect(StockPolicy)(input.policy).pipe(
        Effect.mapError(
          (cause) => new InsightsError({ message: "Check the planning settings.", cause }),
        ),
      );
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.annotateCurrentSpan({
        products: input.facts.products.length,
        saleFacts: input.facts.sales.length,
      });
      return analyzeInsights(input.facts, policy, now);
    }),
  }),
);
