import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class AnalyticsFailure extends Schema.TaggedError<AnalyticsFailure>()("AnalyticsFailure", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

export const analyticsFailure = (cause: unknown) =>
  cause instanceof AnalyticsFailure
    ? cause
    : new AnalyticsFailure({ message: "The insights store failed.", cause });

export const attemptStore = <A>(call: () => A): Effect.Effect<A, AnalyticsFailure> =>
  Effect.try({ try: call, catch: analyticsFailure });
