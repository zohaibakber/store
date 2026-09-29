import type { AuthState } from "../src/auth/model";

export const statusOf = (state: AuthState) => {
  if (state._tag === "Active") return state.confirmed ? "signedIn" : "needsOrganization";
  return state._tag === "Loading" ? "loading" : "signedOut";
};
