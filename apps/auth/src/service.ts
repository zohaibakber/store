import {
  AccessTokenService,
  EmailProvider,
  PasswordHasher,
  type BeginGoogleInput,
  type ExchangeGoogleIdTokenInput,
  type ExchangeGoogleInput,
  type IdentifyInput,
  type LoginCommand,
  type LoginRoute as LoginRouteType,
  type OrganizationCommand,
  type OrganizationCommandResult,
  type OrganizationRoster as OrganizationRosterType,
  type RefreshInput,
  type SignOutInput,
  type TokenSet as TokenSetType,
} from "@store/auth";
import type { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EphemeralStore } from "./ephemeral";
import { AuthError, infrastructureError, infrastructureLog } from "./errors";
import { GoogleOAuth } from "./google";
import { makeGoogleIdentityOps, type GoogleCallback } from "./google-identity";
import type { AuthLimits } from "./limits";
import { makeLoginOps } from "./login";
import { makeOrganizationOps } from "./organization-ops";
import { AuthRepository } from "./repository";
import { makeSessionOps } from "./session-ops";

export interface AuthServiceApi {
  readonly identify: (
    input: IdentifyInput,
  ) => Effect.Effect<LoginRouteType, AuthError, RuntimeContext>;
  readonly authenticate: (
    command: LoginCommand,
  ) => Effect.Effect<TokenSetType, AuthError, RuntimeContext>;
  readonly beginGoogle: (input: BeginGoogleInput) => Effect.Effect<URL, AuthError, RuntimeContext>;
  readonly completeGoogle: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<GoogleCallback, AuthError, RuntimeContext>;
  readonly exchangeGoogle: (
    input: ExchangeGoogleInput,
  ) => Effect.Effect<TokenSetType, AuthError, RuntimeContext>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<TokenSetType, AuthError, RuntimeContext>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSetType, AuthError, RuntimeContext>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthError, RuntimeContext>;
  readonly roster: (
    accessToken: string,
  ) => Effect.Effect<OrganizationRosterType, AuthError, RuntimeContext>;
  readonly organize: (input: {
    readonly accessToken: string;
    readonly command: OrganizationCommand;
  }) => Effect.Effect<OrganizationCommandResult, AuthError, RuntimeContext>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@store/auth-worker/AuthService",
) {}

export interface AuthServiceConfiguration {
  readonly developmentOtp: boolean;
  readonly trustedRedirects: ReadonlyArray<string>;
  readonly refreshTokenPepper: string;
  readonly limits: AuthLimits;
}

const withInfrastructure = <A, E, Args extends ReadonlyArray<unknown>>(
  name: string,
  operation: (...args: Args) => Effect.Effect<A, E, RuntimeContext>,
) =>
  Effect.fn(name)(function* (...args: Args) {
    return yield* operation(...args).pipe(
      Effect.tapError(infrastructureLog),
      Effect.mapError(infrastructureError),
    );
  });

export const authServiceLayer = (configuration: AuthServiceConfiguration) =>
  Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const repository = yield* AuthRepository;
      const ephemeral = yield* EphemeralStore;
      const passwords = yield* PasswordHasher;
      const accessTokens = yield* AccessTokenService;
      const email = yield* EmailProvider;
      const google = yield* GoogleOAuth;

      const sessions = makeSessionOps(repository, accessTokens, configuration);
      const login = makeLoginOps(
        repository,
        ephemeral,
        passwords,
        email,
        sessions,
        configuration,
        configuration.limits,
      );
      const googleIdentity = makeGoogleIdentityOps(
        repository,
        ephemeral,
        google,
        sessions,
        configuration,
        configuration.limits,
      );
      const organizations = makeOrganizationOps(
        repository,
        email,
        sessions,
        configuration,
        configuration.limits,
      );

      return AuthService.of({
        identify: withInfrastructure("AuthService.identify", login.identify),
        authenticate: withInfrastructure("AuthService.authenticate", login.authenticate),
        beginGoogle: withInfrastructure("AuthService.beginGoogle", googleIdentity.beginGoogle),
        completeGoogle: withInfrastructure(
          "AuthService.completeGoogle",
          googleIdentity.completeGoogle,
        ),
        exchangeGoogle: withInfrastructure(
          "AuthService.exchangeGoogle",
          googleIdentity.exchangeGoogle,
        ),
        exchangeGoogleIdToken: withInfrastructure(
          "AuthService.exchangeGoogleIdToken",
          googleIdentity.exchangeGoogleIdToken,
        ),
        refresh: withInfrastructure("AuthService.refresh", sessions.refresh),
        signOut: withInfrastructure("AuthService.signOut", sessions.signOut),
        roster: withInfrastructure("AuthService.roster", organizations.roster),
        organize: withInfrastructure("AuthService.organize", organizations.organize),
      });
    }),
  );
