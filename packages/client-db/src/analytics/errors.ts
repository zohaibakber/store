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

export type Guarded<Methods> = {
  readonly [Name in keyof Methods]: Methods[Name] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Effect.Effect<Result, AnalyticsFailure>
    : never;
};

type Readout = NonNullable<unknown> | null | undefined;

export const guardAll = <
  Methods extends { readonly [name: string]: (...args: never[]) => Readout },
>(
  methods: Methods,
): Guarded<Methods> =>
  // SAFETY: every entry is replaced by a function with the same parameters whose result is the original call lifted into Effect.
  Object.fromEntries(
    Object.entries(methods).map(([name, call]) => [
      name,
      (...args: ReadonlyArray<never>) =>
        Effect.try({ try: () => call(...args), catch: analyticsFailure }),
    ]),
  ) as Guarded<Methods>;
