import { TokenSet } from "@store/auth";
import type { AuthenticatedWorkspaceSnapshot } from "@store/contracts/workspace";
import * as Schema from "effect/Schema";

export const AccountOrganization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.NullOr(Schema.String),
  role: Schema.String,
});
export interface AccountOrganization extends Schema.Schema.Type<typeof AccountOrganization> {}

export const Account = Schema.Struct({
  userId: Schema.String,
  email: Schema.String,
  displayName: Schema.String,
  organization: Schema.NullOr(AccountOrganization),
});
export interface Account extends Schema.Schema.Type<typeof Account> {}

export const StoredSession = Schema.Struct({
  version: Schema.Literal(1),
  tokens: TokenSet,
  account: Account,
});
export interface StoredSession extends Schema.Schema.Type<typeof StoredSession> {}

export const LastOrganization = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
});
export interface LastOrganization extends Schema.Schema.Type<typeof LastOrganization> {}

export const SESSION_ENDED_NOTICE = "Your session ended. Sign in again.";

export type AuthState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "SignedOut"; readonly notice: string | null }
  | { readonly _tag: "Active"; readonly account: Account; readonly confirmed: boolean };

export type AuthEvent =
  | {
      readonly _tag: "Restored";
      readonly account: Account | null;
      readonly lastOrganization: LastOrganization | null;
    }
  | {
      readonly _tag: "SignedIn";
      readonly account: Account;
      readonly lastOrganization: LastOrganization | null;
    }
  | {
      readonly _tag: "AccountRefreshed";
      readonly account: Account;
      readonly lastOrganization: LastOrganization | null;
    }
  | { readonly _tag: "OrganizationConfirmed"; readonly organizationId: string }
  | { readonly _tag: "SessionEnded" }
  | { readonly _tag: "SignedOut" };

export type SessionStatus = "loading" | "signedOut" | "needsOrganization" | "signedIn";

export const initialAuthState: AuthState = { _tag: "Loading" };

const signedOut = (notice: string | null): AuthState => ({ _tag: "SignedOut", notice });

const sameOrganization = (left: AccountOrganization | null, right: AccountOrganization | null) =>
  left === right ||
  (left !== null &&
    right !== null &&
    left.id === right.id &&
    left.name === right.name &&
    left.slug === right.slug &&
    left.role === right.role);

const sameAccount = (left: Account, right: Account) =>
  left.userId === right.userId &&
  left.email === right.email &&
  left.displayName === right.displayName &&
  sameOrganization(left.organization, right.organization);

const active = (account: Account, confirmed: boolean): AuthState => ({
  _tag: "Active",
  account,
  confirmed: confirmed && account.organization !== null,
});

export const remembersOrganization = (
  account: Account,
  lastOrganization: LastOrganization | null,
): boolean =>
  account.organization !== null &&
  lastOrganization !== null &&
  lastOrganization.userId === account.userId &&
  lastOrganization.organizationId === account.organization.id;

export const transition = (state: AuthState, event: AuthEvent): AuthState => {
  switch (event._tag) {
    case "Restored":
      if (state._tag !== "Loading") return state;
      return event.account === null
        ? signedOut(null)
        : active(event.account, remembersOrganization(event.account, event.lastOrganization));
    case "SignedIn":
      if (state._tag !== "SignedOut") return state;
      return active(event.account, remembersOrganization(event.account, event.lastOrganization));
    case "AccountRefreshed": {
      if (state._tag !== "Active" || state.account.userId !== event.account.userId) return state;
      if (sameAccount(state.account, event.account)) return state;
      const keepsOrganization = state.account.organization?.id === event.account.organization?.id;
      return active(
        event.account,
        keepsOrganization
          ? state.confirmed
          : remembersOrganization(event.account, event.lastOrganization),
      );
    }
    case "OrganizationConfirmed":
      if (state._tag !== "Active" || state.account.organization?.id !== event.organizationId) {
        return state;
      }
      return active(state.account, true);
    case "SessionEnded":
      return state._tag === "Active" ? signedOut(SESSION_ENDED_NOTICE) : state;
    case "SignedOut":
      return signedOut(null);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

export const statusOf = (state: AuthState): SessionStatus => {
  switch (state._tag) {
    case "Loading":
      return "loading";
    case "SignedOut":
      return "signedOut";
    case "Active":
      return state.confirmed ? "signedIn" : "needsOrganization";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
};

export const accountFromWorkspace = (snapshot: AuthenticatedWorkspaceSnapshot): Account => ({
  userId: snapshot.user.id,
  email: snapshot.user.email,
  displayName: snapshot.user.name,
  organization:
    snapshot.activeOrganization === null
      ? null
      : {
          id: snapshot.activeOrganization.id,
          name: snapshot.activeOrganization.name,
          slug: snapshot.activeOrganization.slug ?? null,
          role: snapshot.activeOrganization.role,
        },
});
