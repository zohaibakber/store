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
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EphemeralStore } from "./ephemeral";
import { AuthError, infrastructureError, infrastructureLog } from "./errors";
import { GoogleOAuth } from "./google";
import { makeGoogleIdentityOps, type GoogleCallback } from "./google-identity";
import { makeLoginOps } from "./login";
import { makeOrganizationOps } from "./organization-ops";
import { AuthRepository } from "./repository";
import { makeSessionOps } from "./session-ops";

export { AuthError, type GoogleCallback };

export interface AuthServiceApi {
  readonly identify: (input: IdentifyInput) => Effect.Effect<LoginRouteType, AuthError>;
  readonly authenticate: (command: LoginCommand) => Effect.Effect<TokenSetType, AuthError>;
  readonly beginGoogle: (input: BeginGoogleInput) => Effect.Effect<URL, AuthError>;
  readonly completeGoogle: (input: {
    readonly code: string;
    readonly state: string;
  }) => Effect.Effect<GoogleCallback, AuthError>;
  readonly exchangeGoogle: (input: ExchangeGoogleInput) => Effect.Effect<TokenSetType, AuthError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInput,
  ) => Effect.Effect<TokenSetType, AuthError>;
  readonly refresh: (input: RefreshInput) => Effect.Effect<TokenSetType, AuthError>;
  readonly signOut: (input: SignOutInput) => Effect.Effect<void, AuthError>;
  readonly roster: (accessToken: string) => Effect.Effect<OrganizationRosterType, AuthError>;
  readonly organize: (input: {
    readonly accessToken: string;
    readonly command: OrganizationCommand;
  }) => Effect.Effect<OrganizationCommandResult, AuthError>;
}

export class AuthService extends Context.Service<AuthService, AuthServiceApi>()(
  "@store/auth-worker/AuthService",
) {}

export interface AuthServiceConfiguration {
  readonly developmentOtp: boolean;
  readonly trustedRedirects: ReadonlyArray<string>;
  readonly refreshTokenPepper: string;
}

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
      const login = makeLoginOps(repository, ephemeral, passwords, email, sessions, configuration);
      const googleIdentity = makeGoogleIdentityOps(
        repository,
        ephemeral,
        google,
        sessions,
        configuration,
      );
      const organizations = makeOrganizationOps(
        repository,
        ephemeral,
        email,
        sessions,
        configuration,
      );

      const handle = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(Effect.tapError(infrastructureLog), Effect.mapError(infrastructureError));

      // Public surface spans stay on AuthService.*; ops modules use Auth.{Login,Session,...}.*
      return AuthService.of({
        identify: Effect.fn("AuthService.identify")(function* (input: IdentifyInput) {
          return yield* handle(login.identify(input));
        }),
        authenticate: Effect.fn("AuthService.authenticate")(function* (command: LoginCommand) {
          return yield* handle(login.authenticate(command));
        }),
        beginGoogle: Effect.fn("AuthService.beginGoogle")(function* (input: BeginGoogleInput) {
          return yield* handle(googleIdentity.beginGoogle(input));
        }),
        completeGoogle: Effect.fn("AuthService.completeGoogle")(function* (input: {
          readonly code: string;
          readonly state: string;
        }) {
          return yield* handle(googleIdentity.completeGoogle(input));
        }),
        exchangeGoogle: Effect.fn("AuthService.exchangeGoogle")(function* (
          input: ExchangeGoogleInput,
        ) {
          return yield* handle(googleIdentity.exchangeGoogle(input));
        }),
        exchangeGoogleIdToken: Effect.fn("AuthService.exchangeGoogleIdToken")(function* (
          input: ExchangeGoogleIdTokenInput,
        ) {
          return yield* handle(googleIdentity.exchangeGoogleIdToken(input));
        }),
        refresh: Effect.fn("AuthService.refresh")(function* (input: RefreshInput) {
          return yield* handle(sessions.refresh(input));
        }),
        signOut: Effect.fn("AuthService.signOut")(function* (input: SignOutInput) {
          return yield* handle(sessions.signOut(input));
        }),
        roster: Effect.fn("AuthService.roster")(function* (accessToken: string) {
          return yield* handle(organizations.roster(accessToken));
        }),
        organize: Effect.fn("AuthService.organize")(function* (input: {
          readonly accessToken: string;
          readonly command: OrganizationCommand;
        }) {
          return yield* handle(organizations.organize(input));
        }),
      });
    }),
  );
