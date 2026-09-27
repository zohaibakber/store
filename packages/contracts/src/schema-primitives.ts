import * as Schema from "effect/Schema";

export const MAX_SYNC_IDENTIFIER_LENGTH = 200;

export const SyncIdentifier = Schema.NonEmptyString.check(
  Schema.isMaxLength(MAX_SYNC_IDENTIFIER_LENGTH),
);

export const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));
