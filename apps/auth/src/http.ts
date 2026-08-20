import {
  BeginGoogleInput,
  ExchangeGoogleIdTokenInput,
  ExchangeGoogleInput,
  GoogleAuthorization,
  IdentifyInput,
  LoginCommand,
  RefreshInput,
  RefreshToken,
  SignOutInput,
  isTrustedOrigin,
  type AuthClientKind,
  type TokenSet,
} from "@store/auth";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { AuthError, AuthService } from "./service";

const refreshCookieName = (secureCookies: boolean) =>
  secureCookies ? "__Host-tabaaq_refresh" : "tabaaq_refresh";

export interface AuthHttpConfiguration {
  readonly baseUrl: string;
  readonly secureCookies: boolean;
  readonly trustedOrigins: ReadonlyArray<string>;
}

const errorResponse = (error: AuthError) =>
  HttpServerResponse.jsonUnsafe(
    { error: { code: error.code, message: error.message } },
    { status: error.status },
  );

const invalidRequest = (message: string) =>
  errorResponse(new AuthError({ status: 400, code: "INVALID_REQUEST", message }));

const requestJson = <A>(schema: Schema.ConstraintDecoder<A>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") {
      return yield* new AuthError({
        status: 415,
        code: "JSON_REQUIRED",
        message: "Authentication requests must use application/json.",
      });
    }
    const json = yield* request.json.pipe(
      Effect.mapError(
        () =>
          new AuthError({
            status: 400,
            code: "INVALID_JSON",
            message: "The request body is not valid JSON.",
          }),
      ),
    );
    return yield* Schema.decodeUnknownEffect(schema)(json).pipe(
      Effect.mapError(
        () =>
          new AuthError({
            status: 400,
            code: "INVALID_REQUEST",
            message: "The authentication request is invalid.",
          }),
      ),
    );
  });

const browserTokenResponse = (tokens: TokenSet, client: AuthClientKind, secureCookies: boolean) => {
  const responseTokens =
    client._tag === "Browser"
      ? {
          accessToken: tokens.accessToken,
          accessExpiresAt: tokens.accessExpiresAt,
          refreshExpiresAt: tokens.refreshExpiresAt,
        }
      : tokens;
  let response = HttpServerResponse.jsonUnsafe(responseTokens);
  if (client._tag === "Browser" && tokens.refreshToken) {
    response = HttpServerResponse.setCookieUnsafe(
      response,
      refreshCookieName(secureCookies),
      tokens.refreshToken,
      {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "lax",
        path: "/",
        expires: new Date(tokens.refreshExpiresAt),
      },
    );
  }
  return response;
};

const withAuthErrorResponse = <R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, AuthError, R>,
) =>
  effect.pipe(Effect.catchTag("Auth.AuthError", (error) => Effect.succeed(errorResponse(error))));

export const authRoutes = (configuration: AuthHttpConfiguration) =>
  Layer.mergeAll(
    HttpRouter.use((router) =>
      Effect.gen(function* () {
        const auth = yield* AuthService;

        yield* router.add(
          "GET",
          "/health",
          Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true })),
        );
        yield* router.add(
          "POST",
          "/v1/identify",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(IdentifyInput);
              return HttpServerResponse.jsonUnsafe(yield* auth.identify(input));
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/sign-in/password",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(LoginCommand);
              if (input._tag !== "Password") return invalidRequest("Password sign-in is required.");
              const tokens = yield* auth.authenticate(input);
              return browserTokenResponse(tokens, input.client, configuration.secureCookies);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/sign-in/otp",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(LoginCommand);
              if (input._tag !== "Otp") return invalidRequest("OTP sign-in is required.");
              const tokens = yield* auth.authenticate(input);
              return browserTokenResponse(tokens, input.client, configuration.secureCookies);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/sign-up/password",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(LoginCommand);
              if (input._tag !== "RegisterPassword") {
                return invalidRequest("Password registration is required.");
              }
              const tokens = yield* auth.authenticate(input);
              return browserTokenResponse(tokens, input.client, configuration.secureCookies);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/oauth/google/start",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(BeginGoogleInput);
              const url = yield* auth.beginGoogle(input);
              return HttpServerResponse.jsonUnsafe(GoogleAuthorization.make({ url: url.href }));
            }),
          ),
        );
        yield* router.add(
          "GET",
          "/v1/oauth/google/callback",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const url = new URL(request.originalUrl, configuration.baseUrl);
              const code = url.searchParams.get("code");
              const state = url.searchParams.get("state");
              if (!code || !state) {
                return invalidRequest("Google did not return an authorization code.");
              }
              const callback = yield* auth.completeGoogle({ code, state });
              const redirect = new URL(callback.redirectUri);
              redirect.searchParams.set("code", callback.code);
              return HttpServerResponse.redirect(redirect);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/oauth/google/exchange",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(ExchangeGoogleInput);
              const tokens = yield* auth.exchangeGoogle(input);
              return browserTokenResponse(tokens, input.client, configuration.secureCookies);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/oauth/google/native",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const input = yield* requestJson(ExchangeGoogleIdTokenInput);
              const tokens = yield* auth.exchangeGoogleIdToken(input);
              return browserTokenResponse(tokens, input.client, configuration.secureCookies);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/session/refresh",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const input = yield* requestJson(RefreshInput);
              const cookie = request.cookies[refreshCookieName(configuration.secureCookies)];
              const refreshToken =
                input.refreshToken ??
                (cookie
                  ? Schema.decodeUnknownOption(RefreshToken)(cookie).pipe((option) =>
                      option._tag === "Some" ? option.value : undefined,
                    )
                  : undefined);
              const tokens = yield* auth.refresh({ refreshToken });
              const client: AuthClientKind = cookie
                ? { _tag: "Browser" }
                : { _tag: "Native", deviceName: "Native client" };
              return browserTokenResponse(tokens, client, configuration.secureCookies);
            }),
          ),
        );
        yield* router.add(
          "POST",
          "/v1/session/logout",
          withAuthErrorResponse(
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              const input = yield* requestJson(SignOutInput);
              const cookie = request.cookies[refreshCookieName(configuration.secureCookies)];
              const refreshToken =
                input.refreshToken ??
                (cookie
                  ? Schema.decodeUnknownOption(RefreshToken)(cookie).pipe((option) =>
                      option._tag === "Some" ? option.value : undefined,
                    )
                  : undefined);
              yield* auth.signOut({ ...input, refreshToken });
              return HttpServerResponse.expireCookieUnsafe(
                HttpServerResponse.jsonUnsafe({ ok: true }),
                refreshCookieName(configuration.secureCookies),
                {
                  secure: configuration.secureCookies,
                  httpOnly: true,
                  sameSite: "lax",
                  path: "/",
                },
              );
            }),
          ),
        );
      }),
    ),
    HttpRouter.middleware(
      Effect.succeed((httpEffect) =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
          const origin = request.headers.origin;
          const hasRefreshCookie =
            refreshCookieName(configuration.secureCookies) in request.cookies;
          if (
            request.method !== "GET" &&
            (origin !== undefined || hasRefreshCookie) &&
            !isTrustedOrigin(origin, configuration.trustedOrigins)
          ) {
            return Effect.succeed(
              errorResponse(
                new AuthError({
                  status: 403,
                  code: "UNTRUSTED_ORIGIN",
                  message: "The request origin is not trusted.",
                }),
              ),
            );
          }
          return httpEffect;
        }),
      ),
      { global: true },
    ),
    HttpRouter.middleware(
      Effect.succeed(
        HttpMiddleware.cors({
          allowedOrigins: (origin) => isTrustedOrigin(origin, configuration.trustedOrigins),
          allowedHeaders: ["Content-Type"],
          allowedMethods: ["GET", "POST", "OPTIONS"],
          credentials: true,
          maxAge: 600,
        }),
      ),
      { global: true },
    ),
  );
