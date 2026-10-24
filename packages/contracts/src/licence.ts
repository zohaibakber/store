import * as Schema from "effect/Schema";

import { LicenceId, ShopId } from "./ids";
import { EpochMillis, PositiveInt, Sha256Hex } from "./schema-primitives";

export const LICENCE_FORMAT = 1;

export const MAX_SHOP_NAME_LENGTH = 80;

export const MAX_LICENCE_TEXT_LENGTH = 4_096;

export const LICENCE_WARNING_DAYS = 30;

export const LICENCE_GRACE_DAYS = 14;

const DAY_MILLIS = 86_400_000;

export const ShopName = Schema.Trimmed.check(Schema.isBetweenLength(1, MAX_SHOP_NAME_LENGTH));
export type ShopName = typeof ShopName.Type;

export const LicenceBackup = Schema.Struct({
  keyVersion: PositiveInt,
  keyHash: Sha256Hex,
});
export type LicenceBackup = typeof LicenceBackup.Type;

export const Licence = Schema.Struct({
  format: Schema.Literal(LICENCE_FORMAT),
  id: LicenceId,
  shopId: ShopId,
  shopName: ShopName,
  issuedAt: EpochMillis,
  expiresAt: EpochMillis,
  signingKeyId: Schema.NonEmptyString,
  backup: Schema.NullOr(LicenceBackup),
});
export type Licence = typeof Licence.Type;

export const LicenceState = Schema.TaggedUnion({
  missing: {},
  valid: { licence: Licence },
  expiring: { licence: Licence, daysLeft: PositiveInt },
  grace: { licence: Licence, daysLeft: PositiveInt },
  expired: { licence: Licence },
});
export type LicenceState = typeof LicenceState.Type;

const wholeDays = (millis: number) => Math.max(1, Math.ceil(millis / DAY_MILLIS));

export const licenceStateOf = (licence: Licence | null, now: number): LicenceState => {
  if (licence === null) return { _tag: "missing" };
  const untilExpiry = licence.expiresAt - now;
  if (untilExpiry > LICENCE_WARNING_DAYS * DAY_MILLIS) return { _tag: "valid", licence };
  if (untilExpiry > 0) return { _tag: "expiring", licence, daysLeft: wholeDays(untilExpiry) };
  const untilReadOnly = untilExpiry + LICENCE_GRACE_DAYS * DAY_MILLIS;
  return untilReadOnly > 0
    ? { _tag: "grace", licence, daysLeft: wholeDays(untilReadOnly) }
    : { _tag: "expired", licence };
};

export const licenceAllowsChanges = (state: LicenceState): boolean =>
  state._tag === "valid" || state._tag === "expiring" || state._tag === "grace";

export const LicenceRefusalReason = Schema.Literals([
  "missing",
  "expired",
  "malformed",
  "badSignature",
  "unknownKey",
  "otherShop",
  "notNewer",
]);
export type LicenceRefusalReason = typeof LicenceRefusalReason.Type;

export class LicenceRefusal extends Schema.TaggedError<LicenceRefusal>()("LicenceRefusal", {
  reason: LicenceRefusalReason,
}) {}
