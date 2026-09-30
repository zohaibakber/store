import * as Schema from "effect/Schema";

export class AnalyticsFailure extends Schema.TaggedError<AnalyticsFailure>()("AnalyticsFailure", {
  message: Schema.String,
}) {}

export const analyticsFailure = (cause: unknown) =>
  cause instanceof AnalyticsFailure
    ? cause
    : new AnalyticsFailure({
        message: cause instanceof Error ? cause.message : "The insights store failed.",
      });
