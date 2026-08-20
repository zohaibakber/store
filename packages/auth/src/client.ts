import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  BeginGoogleInput,
  ExchangeGoogleInput,
  GoogleAuthorization,
  IdentifyInput,
  LoginCommand,
  LoginRoute,
  RefreshInput,
  SignOutInput,
  TokenSet,
  type BeginGoogleInput as BeginGoogleInputType,
  type ExchangeGoogleInput as ExchangeGoogleInputType,
  type GoogleAuthorization as GoogleAuthorizationType,
  type IdentifyInput as IdentifyInputType,
  type LoginCommand as LoginCommandType,
  type LoginRoute as LoginRouteType,
  type RefreshInput as RefreshInputType,
  type SignOutInput as SignOutInputType,
  type TokenSet as TokenSetType,
} from "./model";

const ErrorPayload = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
});

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
  readonly refresh: (input?: RefreshInputType) => Effect.Effect<TokenSetType, AuthClientError>;
  readonly signOut: (input?: SignOutInputType) => Effect.Effect<void, AuthClientError>;
}

export class AuthClient extends Context.Service<AuthClient, AuthClientApi>()(
  "@store/auth/AuthClient",
) {}

const failure = (operation: string, status: number, code: string, message: string) =>
  new AuthClientError({ operation, status, code, message });

export const makeAuthClient = (configuration: AuthClientConfiguration): AuthClientApi => {
  const baseUrl = configuration.baseUrl.replace(/\/+$/u, "");
  const fetch = configuration.fetch ?? globalThis.fetch;

  const request = <A, Input>(
    operation: string,
    pathname: string,
    input: Input,
    schema: Schema.ConstraintDecoder<A>,
  ): Effect.Effect<A, AuthClientError> =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(`${baseUrl}${pathname}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(input),
          signal,
        }),
      catch: (cause) => failure(operation, 0, "NETWORK_ERROR", String(cause)),
    }).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json(),
          catch: () =>
            failure(
              operation,
              response.status,
              "INVALID_RESPONSE",
              "The authentication service returned an invalid response.",
            ),
        }).pipe(
          Effect.flatMap((payload) => {
            if (!response.ok) {
              return Schema.decodeUnknownEffect(ErrorPayload)(payload).pipe(
                Effect.mapError(() =>
                  failure(
                    operation,
                    response.status,
                    "REQUEST_FAILED",
                    `Authentication request failed (${response.status}).`,
                  ),
                ),
                Effect.flatMap(({ error }) =>
                  Effect.fail(failure(operation, response.status, error.code, error.message)),
                ),
              );
            }
            return Schema.decodeUnknownEffect(schema)(payload).pipe(
              Effect.mapError(() =>
                failure(
                  operation,
                  response.status,
                  "INVALID_RESPONSE",
                  "The authentication service returned an invalid response.",
                ),
              ),
            );
          }),
        ),
      ),
    );

  const identify = Effect.fn("AuthClient.identify")((input: IdentifyInputType) =>
    Schema.decodeUnknownEffect(IdentifyInput)(input).pipe(
      Effect.mapError(() => failure("identify", 0, "INVALID_INPUT", "Enter a valid email.")),
      Effect.flatMap((valid) => request("identify", "/v1/identify", valid, LoginRoute)),
    ),
  );

  const authenticate = Effect.fn("AuthClient.authenticate")((command: LoginCommandType) =>
    Schema.decodeUnknownEffect(LoginCommand)(command).pipe(
      Effect.mapError(() =>
        failure("authenticate", 0, "INVALID_INPUT", "The sign-in details are invalid."),
      ),
      Effect.flatMap((valid) => {
        switch (valid._tag) {
          case "Password":
            return request("authenticate.password", "/v1/sign-in/password", valid, TokenSet);
          case "Otp":
            return request("authenticate.otp", "/v1/sign-in/otp", valid, TokenSet);
          case "RegisterPassword":
            return request("authenticate.register", "/v1/sign-up/password", valid, TokenSet);
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
        Effect.mapError(() =>
          failure("google.begin", 0, "INVALID_INPUT", "The Google redirect is invalid."),
        ),
        Effect.flatMap((valid) =>
          request("google.begin", "/v1/oauth/google/start", valid, GoogleAuthorization),
        ),
      ),
    ),
    exchangeGoogle: Effect.fn("AuthClient.exchangeGoogle")((input: ExchangeGoogleInputType) =>
      Schema.decodeUnknownEffect(ExchangeGoogleInput)(input).pipe(
        Effect.mapError(() =>
          failure("google.exchange", 0, "INVALID_INPUT", "The Google callback is invalid."),
        ),
        Effect.flatMap((valid) =>
          request("google.exchange", "/v1/oauth/google/exchange", valid, TokenSet),
        ),
      ),
    ),
    refresh: Effect.fn("AuthClient.refresh")((input: RefreshInputType = {}) =>
      Schema.decodeUnknownEffect(RefreshInput)(input).pipe(
        Effect.mapError(() =>
          failure("session.refresh", 0, "INVALID_INPUT", "The refresh request is invalid."),
        ),
        Effect.flatMap((valid) =>
          request("session.refresh", "/v1/session/refresh", valid, TokenSet),
        ),
      ),
    ),
    signOut: Effect.fn("AuthClient.signOut")((input: SignOutInputType = {}) =>
      Schema.decodeUnknownEffect(SignOutInput)(input).pipe(
        Effect.mapError(() =>
          failure("session.logout", 0, "INVALID_INPUT", "The sign-out request is invalid."),
        ),
        Effect.flatMap((valid) =>
          request(
            "session.logout",
            "/v1/session/logout",
            valid,
            Schema.Struct({ ok: Schema.Literal(true) }),
          ),
        ),
        Effect.asVoid,
      ),
    ),
  });
};

export const authClientLayer = (configuration: AuthClientConfiguration) =>
  Layer.succeed(AuthClient, makeAuthClient(configuration));
