import type {
  BeginGoogleInput,
  ExchangeGoogleIdTokenInput,
  ExchangeGoogleInput,
  IdentifyInput,
  LoginCommand,
  LoginRoute,
  OrganizationCommand,
  OrganizationCommandResult,
  OrganizationRoster,
  RefreshedSession,
} from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Redacted from "effect/Redacted";

import { unavailableOnInfrastructureFailure, type InfrastructureFailure } from "./errors";
import type { AuthFailure } from "./failures";
import { GoogleIdentity, type GoogleCallback } from "./google-identity";
import { AuthLimiter } from "./limits";
import { Login } from "./login";
import { Organizations } from "./organization-ops";
import { Sessions, type PresentedRefresh } from "./session-ops";

interface AuthServiceApi {
  readonly admitAddress: (address: string) => Effect.Effect<void, AuthFailure, RuntimeContext>;
  readonly identify: (
    input: IdentifyInput,
  ) => Effect.Effect<LoginRoute, AuthFailure, RuntimeContext>;
  readonly authenticate: (
    command: LoginCommand,
  ) => Effect.Effect<RefreshedSession, AuthFailure, RuntimeContext>;
  readonly beginGoogle: (
    input: BeginGoogleInput,
  ) => Effect.Effect<URL, AuthFailure, RuntimeContext>;
  readonly completeGoogle: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<GoogleCallback, AuthFailure, RuntimeContext>;
  readonly exchangeGoogle: (
    input: ExchangeGoogleInput,
  ) => Effect.Effect<RefreshedSession, AuthFailure, RuntimeContext>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<RefreshedSession, AuthFailure, RuntimeContext>;
  readonly refresh: (
    presented: PresentedRefresh | undefined,
  ) => Effect.Effect<RefreshedSession, AuthFailure, RuntimeContext>;
  readonly signOut: (
    refreshToken: Redacted.Redacted<string> | undefined,
  ) => Effect.Effect<void, AuthFailure, RuntimeContext>;
  readonly roster: (
    accessToken: Redacted.Redacted<string>,
  ) => Effect.Effect<OrganizationRoster, AuthFailure, RuntimeContext>;
  readonly organize: (input: {
    readonly accessToken: Redacted.Redacted<string>;
    readonly command: OrganizationCommand;
  }) => Effect.Effect<OrganizationCommandResult, AuthFailure, RuntimeContext>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@store/auth-worker/AuthService",
) {}

const withInfrastructure = <
  A,
  E extends AuthFailure | InfrastructureFailure,
  Args extends ReadonlyArray<unknown>,
>(
  name: string,
  operation: (...args: Args) => Effect.Effect<A, E, RuntimeContext>,
) =>
  Effect.fn(name)(function* (...args: Args) {
    return yield* unavailableOnInfrastructureFailure(operation(...args));
  });

const addressBucket = (address: string) => {
  if (!address.includes(":") || address.includes(".")) return address;
  const [head = "", tail = ""] = address.split("::");
  const leading = head === "" ? [] : head.split(":");
  const trailing = tail === "" ? [] : tail.split(":");
  const elided = Array.from({ length: 8 - leading.length - trailing.length }, () => "0");
  return [...leading, ...elided, ...trailing]
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":");
};

const OperationsLive = Layer.mergeAll(Login.layer, GoogleIdentity.layer, Organizations.layer).pipe(
  Layer.provideMerge(Sessions.layer),
);

export const authServiceLayer = Layer.effect(
  AuthService,
  Effect.gen(function* () {
    const sessions = yield* Sessions;
    const login = yield* Login;
    const google = yield* GoogleIdentity;
    const organizations = yield* Organizations;
    const limiter = yield* AuthLimiter;

    return AuthService.of({
      admitAddress: withInfrastructure("AuthService.admitAddress", (address: string) =>
        limiter.admit("sixtyPerMinute", `address:${addressBucket(address)}`, "request"),
      ),
      identify: withInfrastructure("AuthService.identify", login.identify),
      authenticate: withInfrastructure("AuthService.authenticate", login.authenticate),
      beginGoogle: withInfrastructure("AuthService.beginGoogle", google.beginGoogle),
      completeGoogle: withInfrastructure("AuthService.completeGoogle", google.completeGoogle),
      exchangeGoogle: withInfrastructure("AuthService.exchangeGoogle", google.exchangeGoogle),
      exchangeGoogleIdToken: withInfrastructure(
        "AuthService.exchangeGoogleIdToken",
        google.exchangeGoogleIdToken,
      ),
      refresh: withInfrastructure("AuthService.refresh", sessions.refresh),
      signOut: withInfrastructure("AuthService.signOut", sessions.signOut),
      roster: withInfrastructure("AuthService.roster", organizations.roster),
      organize: withInfrastructure("AuthService.organize", organizations.organize),
    });
  }),
).pipe(Layer.provide(OperationsLive));
