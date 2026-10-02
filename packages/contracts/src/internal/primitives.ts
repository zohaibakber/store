import * as Schema from "effect/Schema";

export const EpochMillis = Schema.Natural;

export const UtcOffsetMinutes = Schema.Int.check(Schema.isBetween({ minimum: -840, maximum: 840 }));

export const PositiveIntFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
);
