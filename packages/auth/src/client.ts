import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientError from "effect/http/HttpClientError";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AuthHttpApi } from "./http-api";
import { authHttpErrorStatus, type AuthHttpError } from "./http-errors";
import {
  BeginGoogleInput,
  ExchangeGoogleIdTokenInput,
  ExchangeGoogleInput,
  IdentifyInput,
  LoginCommand,
  type BeginGoogleInput as BeginGoogleInputType,
  type ExchangeGoogleIdTokenInput as ExchangeGoogleIdTokenInputType,
  type ExchangeGoogleInput as ExchangeGoogleInputType,
  type GoogleAuthorization as GoogleAuthorizationType,
  type IdentifyInput as IdentifyInputType,
  type IssuedSession as IssuedSessionType,
  type LoginCredentials,
  type LoginRoute as LoginRouteType,
} from "./model";

const AuthClientOperation = Schema.Literals([
  "identify",
  "authenticate",
  "authenticate.password",
  "authenticate.otp",
  "authenticate.register",
  "google.begin",
  "google.exchange",
  "google.native",
]);
type AuthClientOperation = typeof AuthClientOperation.Type;

const AuthClientFailure = Schema.Union([
  Schema.TaggedStruct("InvalidInput", {}),
  Schema.TaggedStruct("Unreachable", {}),
  Schema.TaggedStruct("Rejected", { status: Schema.Number, code: Schema.String }),
]);

export class AuthClientError extends Schema.TaggedError<AuthClientError>()("Auth.AuthClientError", {
  operation: AuthClientOperation,
  reason: AuthClientFailure,
  message: Schema.String,
}) {}

export interface AuthClientApi {
  readonly identify: (input: IdentifyInputType) => Effect.Effect<LoginRouteType, AuthClientError>;
  readonly authenticate: (
    command: LoginCredentials,
  ) => Effect.Effect<IssuedSessionType, AuthClientError>;
  readonly beginGoogle: (
    input: BeginGoogleInputType,
  ) => Effect.Effect<GoogleAuthorizationType, AuthClientError>;
  readonly exchangeGoogle: (
    input: ExchangeGoogleInputType,
  ) => Effect.Effect<IssuedSessionType, AuthClientError>;
  readonly exchangeGoogleIdToken: (
    input: ExchangeGoogleIdTokenInputType,
  ) => Effect.Effect<IssuedSessionType, AuthClientError>;
}

export class AuthClient extends Context.Service<AuthClient, AuthClientApi>()(
  "@store/auth/AuthClient",
) {}

type TransportFailure = HttpClientError.HttpClientError | Schema.SchemaError;

const invalidInput = (operation: AuthClientOperation, message: string) =>
  new AuthClientError({ operation, reason: { _tag: "InvalidInput" }, message });

const clientError =
  (operation: AuthClientOperation) =>
  (cause: AuthHttpError | TransportFailure): AuthClientError => {
    switch (cause._tag) {
      case "HttpClientError":
      case "SchemaError":
        return new AuthClientError({
          operation,
          reason: { _tag: "Unreachable" },
          message: cause.message,
        });
      case "BadRequest":
      case "Unauthenticated":
      case "Forbidden":
      case "NotFound":
      case "Conflict":
      case "UnsupportedMediaType":
      case "TooManyRequests":
      case "ServiceUnavailable":
        return new AuthClientError({
          operation,
          reason: {
            _tag: "Rejected",
            status: authHttpErrorStatus(cause._tag),
            code: cause.error.code,
          },
          message: cause.error.message,
        });
      default: {
        const _exhaustive: never = cause;
        return _exhaustive;
      }
    }
  };

const decodeLoginCommand = Schema.decodeEffect(LoginCommand);

const request = <Payload, A>(
  operation: AuthClientOperation,
  invalidMessage: string,
  schema: Schema.Codec<Payload, unknown>,
  input: Payload,
  send: (payload: Payload) => Effect.Effect<A, AuthHttpError | TransportFailure>,
) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError(() => invalidInput(operation, invalidMessage)),
    Effect.flatMap((payload) => Effect.mapError(send(payload), clientError(operation))),
  );

const make = Effect.fnUntraced(function* (baseUrl: string) {
  const httpClient = yield* HttpClient.HttpClient;
  const session = yield* HttpApiClient.group(AuthHttpApi, {
    group: "session",
    httpClient: HttpClient.transformResponse(
      httpClient,
      Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }),
    ),
    baseUrl: baseUrl.replace(/\/+$/u, ""),
  });

  const authenticate = Effect.fn("AuthClient.authenticate")((command: LoginCredentials) =>
    decodeLoginCommand(command).pipe(
      Effect.mapError(() => invalidInput("authenticate", "The sign-in details are invalid.")),
      Effect.flatMap((valid) => {
        switch (valid._tag) {
          case "Password":
            return session
              .signInPassword({ payload: valid })
              .pipe(Effect.mapError(clientError("authenticate.password")));
          case "Otp":
            return session
              .signInOtp({ payload: valid })
              .pipe(Effect.mapError(clientError("authenticate.otp")));
          case "RegisterPassword":
            return session
              .signUpPassword({ payload: valid })
              .pipe(Effect.mapError(clientError("authenticate.register")));
          default: {
            const _exhaustive: never = valid;
            return _exhaustive;
          }
        }
      }),
    ),
  );

  return AuthClient.of({
    identify: Effect.fn("AuthClient.identify")((input: IdentifyInputType) =>
      request("identify", "Enter a valid email.", IdentifyInput, input, (payload) =>
        session.identify({ payload }),
      ),
    ),
    authenticate,
    beginGoogle: Effect.fn("AuthClient.beginGoogle")((input: BeginGoogleInputType) =>
      request(
        "google.begin",
        "The Google redirect is invalid.",
        BeginGoogleInput,
        input,
        (payload) => session.googleStart({ payload }),
      ),
    ),
    exchangeGoogle: Effect.fn("AuthClient.exchangeGoogle")((input: ExchangeGoogleInputType) =>
      request(
        "google.exchange",
        "The Google callback is invalid.",
        ExchangeGoogleInput,
        input,
        (payload) => session.googleExchange({ payload }),
      ),
    ),
    exchangeGoogleIdToken: Effect.fn("AuthClient.exchangeGoogleIdToken")(
      (input: ExchangeGoogleIdTokenInputType) =>
        request(
          "google.native",
          "The Google sign-in is invalid.",
          ExchangeGoogleIdTokenInput,
          input,
          (payload) => session.googleNative({ payload }),
        ),
    ),
  });
});

export const authClientLayer = (configuration: { readonly baseUrl: string }) =>
  Layer.effect(AuthClient, make(configuration.baseUrl));
