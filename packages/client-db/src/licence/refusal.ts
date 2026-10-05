import {
  licenceAllowsChanges,
  type LicenceRefusalReason,
  type LicenceState,
  type ShopId,
} from "@store/contracts";
import * as Option from "effect/Option";

export const licenceRefusalFor = (
  state: LicenceState,
  databaseShop: Option.Option<ShopId>,
): Option.Option<LicenceRefusalReason> => {
  switch (state._tag) {
    case "missing":
      return Option.some("missing");
    case "expired":
      return Option.some("expired");
    case "valid":
    case "expiring":
    case "grace":
      if (!licenceAllowsChanges(state)) return Option.some("expired");
      return Option.match(databaseShop, {
        onNone: () => true,
        onSome: (shop) => shop === state.licence.shopId,
      })
        ? Option.none()
        : Option.some("otherShop");
  }
};
