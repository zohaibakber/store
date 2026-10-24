import { useLicenceState } from "@store/inventory-react";

export const useShopName = (): string | undefined => {
  const state = useLicenceState();
  return state === undefined || state._tag === "missing" ? undefined : state.licence.shopName;
};
