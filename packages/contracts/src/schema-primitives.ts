import * as Schema from "effect/Schema";

const MAX_SYNC_IDENTIFIER_LENGTH = 200;

export const SyncIdentifier = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
);

export const INT4_MAX = 2_147_483_647;

export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const PositiveIntFromString = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
);

export const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

export const EpochMillis = Schema.Natural;

export const UtcOffsetMinutes = Schema.Int.check(Schema.isBetween({ minimum: -840, maximum: 840 }));
