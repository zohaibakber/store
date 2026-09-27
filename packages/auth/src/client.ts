import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import { AuthHttpApi } from "./http-api";
import {
  AuthBadRequest,
  AuthConflict,
  AuthForbidden,
  AuthNotFound,
  AuthServiceUnavailable,
  AuthTooManyRequests,
  AuthUnauthenticated,
  AuthUnsupportedMediaType,
  authHttpErrorStatus,
} from "./http-errors";
import {
  BeginGoogleInput,
  ExchangeGoogleIdTokenInput,
  ExchangeGoogleInput,
  IdentifyInput,
  LoginCommand,
  RefreshInput,
  SignOutInput,
  type BeginGoogleInput as BeginGoogleInputType,
  type ExchangeGoogleIdTokenInput as ExchangeGoogleIdTokenInputType,
  type ExchangeGoogleInput as ExchangeGoogleInputType,
  type GoogleAuthorization as GoogleAuthorizationType,
  type IdentifyInput as IdentifyInputType,
  type LoginCommand as LoginCommandType,
  type LoginRoute as LoginRouteType,
  type RefreshInput as RefreshInputType,
  type SignOutInput as SignOutInputType,
  type TokenSet as TokenSetType,
} from "./model";

export class AuthClientError extends Schema.TaggedError<AuthClientError>()("Auth.AuthClientError", {
  operation: Schema.String,
  status: Schema.Number,
  code: Schema.String,
  message: Schema.String,
}) {}

export interface AuthClientConfiguration {
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}

export interface AuthClientApi {
  readonly identify: (input: IdentifyInputType) => Effect.Effect<LoginRouteType, AuthClientError>;
  readonly authenticate: (
    command: LoginCommandType,
  ) => Effect.Effect<TokenSetType, AuthClientError>;
  readonly beginGoogle: (
    input: BeginGoogleInputType,
  ) => Effect.Effect<GoogleAuthorizationType, AuthClientError>;
  readonly exchangeGoogle: (
    input: ExchangeGoogleInputType,
  ) => Effect.Effect<TokenSetType, AuthClientError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInputType,
  ) => Effect.Effect<TokenSetType, AuthClientError>;
  readonly refresh: (input?: RefreshInputType) => Effect.Effect<TokenSetType, AuthClientError>;
  readonly signOut: (input?: SignOutInputType) => Effect.Effect<void, AuthClientError>;
}

export class AuthClient extends Context.Service<AuthClient, AuthClientApi>()(
  "@store/auth/AuthClient",
) {}

const failure = (operation: string, status: number, code: string, message: string) =>
  new AuthClientError({ operation, status, code, message });

const AuthHttpErrorSchema = Schema.Union([
  AuthBadRequest,
  AuthUnauthenticated,
  AuthForbidden,
  AuthNotFound,
  AuthConflict,
  AuthUnsupportedMediaType,
  AuthTooManyRequests,
  AuthServiceUnavailable,
]);

const invalidInput = (operation: string, message: string) =>
  failure(operation, 0, "INVALID_INPUT", message);

const asClientError = (operation: string) =>
  Effect.mapError((cause: AuthClientError | typeof AuthHttpErrorSchema.Type | Error) => {
    if (cause instanceof AuthClientError) return cause;
    const decoded = Schema.decodeUnknownOption(AuthHttpErrorSchema)(cause);
    if (decoded._tag === "Some") {
      return failure(
        operation,
        authHttpErrorStatus(decoded.value._tag),
        decoded.value.error.code,
        decoded.value.error.message,
      );
    }
    const message = cause instanceof Error ? cause.message : "Network request failed.";
    return failure(operation, 0, "NETWORK_ERROR", message);
  });

export const makeAuthClient = (configuration: AuthClientConfiguration): AuthClientApi => {
  const baseUrl = configuration.baseUrl.replace(/\/+$/u, "");
  const fetch = configuration.fetch ?? globalThis.fetch;

  const apiClient = Effect.runSync(
    HttpApiClient.make(AuthHttpApi, { baseUrl }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
    ),
  );

  const identify = Effect.fn("AuthClient.identify")((input: IdentifyInputType) =>
    Schema.decodeUnknownEffect(IdentifyInput)(input).pipe(
      Effect.mapError(() => invalidInput("identify", "Enter a valid email.")),
      Effect.flatMap((valid) => apiClient.session.identify({ payload: valid })),
      asClientError("identify"),
    ),
  );

  const authenticate = Effect.fn("AuthClient.authenticate")((command: LoginCommandType) =>
    Schema.decodeUnknownEffect(LoginCommand)(command).pipe(
      Effect.mapError(() => invalidInput("authenticate", "The sign-in details are invalid.")),
      Effect.flatMap((valid) => {
        switch (valid._tag) {
          case "Password":
            return apiClient.session
              .signInPassword({ payload: valid })
              .pipe(asClientError("authenticate.password"));
          case "Otp":
            return apiClient.session
              .signInOtp({ payload: valid })
              .pipe(asClientError("authenticate.otp"));
          case "RegisterPassword":
            return apiClient.session
              .signUpPassword({ payload: valid })
              .pipe(asClientError("authenticate.register"));
          default: {
            const _exhaustive: never = valid;
            return _exhaustive;
          }
        }
      }),
    ),
  );

  return AuthClient.of({
    identify,
    authenticate,
    beginGoogle: Effect.fn("AuthClient.beginGoogle")((input: BeginGoogleInputType) =>
      Schema.decodeUnknownEffect(BeginGoogleInput)(input).pipe(
        Effect.mapError(() => invalidInput("google.begin", "The Google redirect is invalid.")),
        Effect.flatMap((valid) => apiClient.session.googleStart({ payload: valid })),
        asClientError("google.begin"),
      ),
    ),
    exchangeGoogle: Effect.fn("AuthClient.exchangeGoogle")((input: ExchangeGoogleInputType) =>
      Schema.decodeUnknownEffect(ExchangeGoogleInput)(input).pipe(
        Effect.mapError(() => invalidInput("google.exchange", "The Google callback is invalid.")),
        Effect.flatMap((valid) => apiClient.session.googleExchange({ payload: valid })),
        asClientError("google.exchange"),
      ),
    ),
    exchangeGoogleIdToken: Effect.fn("AuthClient.exchangeGoogleIdToken")(
      (input: ExchangeGoogleIdTokenInputType) =>
        Schema.decodeUnknownEffect(ExchangeGoogleIdTokenInput)(input).pipe(
          Effect.mapError(() => invalidInput("google.native", "The Google sign-in is invalid.")),
          Effect.flatMap((valid) => apiClient.session.googleNative({ payload: valid })),
          asClientError("google.native"),
        ),
    ),
    refresh: Effect.fn("AuthClient.refresh")((input: RefreshInputType = {}) =>
      Schema.decodeUnknownEffect(RefreshInput)(input).pipe(
        Effect.mapError(() => invalidInput("session.refresh", "The refresh request is invalid.")),
        Effect.flatMap((valid) => apiClient.session.refresh({ payload: valid })),
        asClientError("session.refresh"),
      ),
    ),
    signOut: Effect.fn("AuthClient.signOut")((input: SignOutInputType = {}) =>
      Schema.decodeUnknownEffect(SignOutInput)(input).pipe(
        Effect.mapError(() => invalidInput("session.logout", "The sign-out request is invalid.")),
        Effect.flatMap((valid) => apiClient.session.logout({ payload: valid })),
        asClientError("session.logout"),
        Effect.asVoid,
      ),
    ),
  });
};

export const authClientLayer = (configuration: AuthClientConfiguration) =>
  Layer.succeed(AuthClient, makeAuthClient(configuration));
