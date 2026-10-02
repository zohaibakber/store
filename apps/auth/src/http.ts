import {
  AuthBadRequest,
  AuthHttpApi,
  Authorization,
  AuthUnauthenticated,
  authHttpErrorStatus,
  CurrentAccessToken,
  MalformedRequest,
  presentedCredential,
  publicJwks,
  refreshCookieName,
  refreshCookieOptions,
  refreshCookieSecurity,
  type AuthClientKind,
  type JwtKeyRing,
  type RefreshToken,
  type TokenSet,
} from "@store/auth";
import { isTrustedOrigin } from "@store/auth/security";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { causeDiagnostics } from "./errors";
import { authFailureWire, authHttpError, type AuthFailure } from "./failures";
import { AUTH_RATE_LIMIT_PERIOD_SECONDS } from "./limits";
import { googleOAuthAppResponse, oauthCallbackErrorResponse } from "./oauth-callback-page";
import { AuthService } from "./service";
import type { PresentedRefresh } from "./session-ops";

interface AuthHttpConfiguration {
  readonly keys: JwtKeyRing;
  readonly secureCookies: boolean;
  readonly trustedOrigins: ReadonlyArray<string>;
}

class AuthHttpConfig extends Context.Service<AuthHttpConfig, AuthHttpConfiguration>()(
  "@store/auth-worker/AuthHttpConfig",
) {}

const UNIDENTIFIED_NATIVE_CLIENT: AuthClientKind = {
  _tag: "Native",
  deviceName: "Native client",
};

const retryAfterRateLimit = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeader(response, "retry-after", String(AUTH_RATE_LIMIT_PERIOD_SECONDS)),
  ),
);

const fromAuth = <A, R>(effect: Effect.Effect<A, AuthFailure, R>) =>
  effect.pipe(
    Effect.tapError((failure) =>
      authFailureWire(failure).kind === "TooManyRequests" ? retryAfterRateLimit : Effect.void,
    ),
    Effect.mapError(authHttpError),
  );

const browserTokenPayload = <T extends TokenSet>(tokens: T, client: AuthClientKind) =>
  client._tag === "Browser" ? Struct.omit(tokens, ["refreshToken"]) : tokens;

const issueBrowserTokens = <T extends TokenSet, R>(
  effect: Effect.Effect<T, AuthFailure, R>,
  client: AuthClientKind,
  secureCookies: boolean,
) =>
  fromAuth(effect).pipe(
    Effect.flatMap((tokens) =>
      Effect.gen(function* () {
        if (client._tag === "Browser" && tokens.refreshToken) {
          yield* HttpApiBuilder.securitySetCookie(
            refreshCookieSecurity(secureCookies),
            tokens.refreshToken,
            {
              ...refreshCookieOptions(secureCookies),
              expires: new Date(tokens.refreshExpiresAt),
            },
          );
        }
        return browserTokenPayload(tokens, client);
      }),
    ),
  );

const AuthorizationLive = Layer.succeed(
  Authorization,
  Authorization.of({
    bearer: Effect.fn("AuthAuthorization.bearer")(function* (httpEffect, { credential }) {
      const token = presentedCredential(credential);
      if (Option.isNone(token)) {
        return yield* Effect.fail(
          AuthUnauthenticated.make({
            error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
          }),
        );
      }
      return yield* Effect.provideService(httpEffect, CurrentAccessToken, token.value);
    }),
  }),
);

const malformedRequest = AuthBadRequest.make({
  error: {
    code: "INVALID_REQUEST",
    message: "The request is not valid. Check what you entered and try again.",
  },
});

const MalformedRequestLive = HttpApiMiddleware.layerSchemaErrorTransform(
  MalformedRequest,
  (error, { endpoint }) => {
    switch (error.kind) {
      case "Params":
      case "Headers":
      case "Query":
      case "Payload":
        return Effect.logWarning("auth.malformed_request").pipe(
          Effect.annotateLogs({ endpoint: endpoint.identifier, part: error.kind }),
          Effect.andThen(Effect.fail(malformedRequest)),
        );
      case "Body":
      case "ResponseHeaders":
        return Effect.fail(error);
      default: {
        const _exhaustive: never = error.kind;
        return _exhaustive;
      }
    }
  },
);

const SystemHandlers = HttpApiBuilder.group(
  AuthHttpApi,
  "system",
  Effect.fn("AuthSystemHandlers.make")(function* (handlers) {
    const configuration = yield* AuthHttpConfig;
    return handlers
      .handle("landing", () => Effect.succeed({ ok: true as const }))
      .handle("health", () => Effect.succeed({ ok: true as const }))
      .handle("jwks", () => Effect.succeed(publicJwks(configuration.keys)));
  }),
);

const SessionHandlers = HttpApiBuilder.group(
  AuthHttpApi,
  "session",
  Effect.fn("AuthSessionHandlers.make")(function* (handlers) {
    const auth = yield* AuthService;
    const configuration = yield* AuthHttpConfig;
    const cookies = configuration.secureCookies;
    const refreshCookie = refreshCookieSecurity(cookies);
    const presentedRefreshCredential = Effect.fnUntraced(function* (
      bodyToken: RefreshToken | undefined,
    ) {
      const cookie = presentedCredential(yield* HttpApiBuilder.securityDecode(refreshCookie));
      if (bodyToken) {
        return {
          client: UNIDENTIFIED_NATIVE_CLIENT,
          refreshToken: Redacted.make(bodyToken),
        } satisfies PresentedRefresh;
      }
      return Option.match(cookie, {
        onNone: () => undefined,
        onSome: (refreshToken): PresentedRefresh => ({ client: { _tag: "Browser" }, refreshToken }),
      });
    });

    return handlers
      .handle(
        "identify",
        Effect.fn("AuthSessionHandlers.identify")(function* ({ payload }) {
          return yield* fromAuth(auth.identify(payload));
        }),
      )
      .handle(
        "signInPassword",
        Effect.fn("AuthSessionHandlers.signInPassword")(function* ({ payload }) {
          return yield* issueBrowserTokens(auth.authenticate(payload), payload.client, cookies);
        }),
      )
      .handle(
        "signInOtp",
        Effect.fn("AuthSessionHandlers.signInOtp")(function* ({ payload }) {
          return yield* issueBrowserTokens(auth.authenticate(payload), payload.client, cookies);
        }),
      )
      .handle(
        "signUpPassword",
        Effect.fn("AuthSessionHandlers.signUpPassword")(function* ({ payload }) {
          return yield* issueBrowserTokens(auth.authenticate(payload), payload.client, cookies);
        }),
      )
      .handle(
        "googleStart",
        Effect.fn("AuthSessionHandlers.googleStart")(function* ({ payload }) {
          const url = yield* fromAuth(auth.beginGoogle(payload));
          return { url: url.href };
        }),
      )
      .handle(
        "googleExchange",
        Effect.fn("AuthSessionHandlers.googleExchange")(function* ({ payload }) {
          return yield* issueBrowserTokens(auth.exchangeGoogle(payload), payload.client, cookies);
        }),
      )
      .handle(
        "googleNative",
        Effect.fn("AuthSessionHandlers.googleNative")(function* ({ payload }) {
          return yield* issueBrowserTokens(
            auth.exchangeGoogleIdToken(payload),
            payload.client,
            cookies,
          );
        }),
      )
      .handle(
        "refresh",
        Effect.fn("AuthSessionHandlers.refresh")(function* ({ payload }) {
          const presented = yield* presentedRefreshCredential(payload.refreshToken);
          return yield* issueBrowserTokens(
            auth.refresh(presented),
            presented?.client ?? UNIDENTIFIED_NATIVE_CLIENT,
            cookies,
          );
        }),
      )
      .handle(
        "logout",
        Effect.fn("AuthSessionHandlers.logout")(function* ({ payload }) {
          const presented = yield* presentedRefreshCredential(payload.refreshToken);
          yield* fromAuth(auth.signOut(presented?.refreshToken));
          return HttpServerResponse.expireCookieUnsafe(
            HttpServerResponse.jsonUnsafe({ ok: true as const }),
            refreshCookieName(cookies),
            refreshCookieOptions(cookies),
          );
        }),
      );
  }),
);

const OrganizationHandlers = HttpApiBuilder.group(
  AuthHttpApi,
  "organization",
  Effect.fn("AuthOrganizationHandlers.make")(function* (handlers) {
    const auth = yield* AuthService;

    return handlers
      .handle(
        "roster",
        Effect.fn("AuthOrganizationHandlers.roster")(function* () {
          const token = yield* CurrentAccessToken;
          return yield* fromAuth(auth.roster(token));
        }),
      )
      .handle(
        "command",
        Effect.fn("AuthOrganizationHandlers.command")(function* ({ payload }) {
          const token = yield* CurrentAccessToken;
          return yield* fromAuth(auth.organize({ accessToken: token, command: payload }));
        }),
      );
  }),
);

const CallbackParameter = Schema.optionalKey(
  Schema.Union([Schema.String, Schema.Array(Schema.String)]),
);

const GoogleCallbackParameters = Schema.Struct({
  error: CallbackParameter,
  code: CallbackParameter,
  state: CallbackParameter,
});

const firstValue = (value: string | ReadonlyArray<string> | undefined) =>
  Predicate.isString(value) ? value : value?.[0];

const callbackFailureResponse = (failure: AuthFailure) => {
  const { kind, message } = authFailureWire(failure);
  return oauthCallbackErrorResponse(authHttpErrorStatus(kind), message);
};

const GoogleCallbackRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* AuthService;

    yield* router.add(
      "GET",
      "/v1/oauth/google/callback",
      Effect.gen(function* () {
        const parameters = yield* HttpServerRequest.schemaSearchParams(
          GoogleCallbackParameters,
        ).pipe(Effect.orElseSucceed((): typeof GoogleCallbackParameters.Type => ({})));
        if (firstValue(parameters.error) === "access_denied") {
          return oauthCallbackErrorResponse(400, "Google sign-in was cancelled.");
        }
        const code = firstValue(parameters.code);
        const state = firstValue(parameters.state);
        if (!code || !state) {
          return oauthCallbackErrorResponse(400, "Google did not return an authorization code.");
        }
        return yield* auth.completeGoogle({ code, state }).pipe(
          Effect.match({
            onFailure: callbackFailureResponse,
            onSuccess: (callback) => {
              const redirect = new URL(callback.redirectUri);
              redirect.searchParams.set("code", callback.code);
              return googleOAuthAppResponse(redirect);
            },
          }),
        );
      }),
    );
  }),
);

const CorsAndOrigin = HttpRouter.middleware(
  Effect.gen(function* () {
    const configuration = yield* AuthHttpConfig;
    const cors = HttpMiddleware.cors({
      allowedOrigins: (origin) => isTrustedOrigin(origin, configuration.trustedOrigins),
      allowedHeaders: ["Authorization", "Content-Type", "traceparent", "b3"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      maxAge: 7200,
    });
    return (httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, unknown>) =>
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        const origin = request.headers.origin;
        const hasRefreshCookie = refreshCookieName(configuration.secureCookies) in request.cookies;
        if (
          request.method !== "GET" &&
          (origin !== undefined || hasRefreshCookie) &&
          !isTrustedOrigin(origin, configuration.trustedOrigins)
        ) {
          return Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              {
                error: {
                  code: "UNTRUSTED_ORIGIN",
                  message: "The request origin is not trusted.",
                },
              },
              { status: 403 },
            ),
          );
        }
        return cors(httpEffect);
      });
  }),
  { global: true },
);

const NoStoreOnPost = HttpRouter.middleware(
  (httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, unknown>) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      request.method === "POST"
        ? Effect.map(httpEffect, HttpServerResponse.setHeader("cache-control", "no-store"))
        : httpEffect,
    ),
  { global: true },
);

export const authRoutes = (configuration: AuthHttpConfiguration) => {
  const ConfigLive = Layer.succeed(AuthHttpConfig, configuration);
  const ApiRoutes = HttpApiBuilder.layer(AuthHttpApi).pipe(
    Layer.provide(
      Layer.mergeAll(SystemHandlers, SessionHandlers, OrganizationHandlers).pipe(
        Layer.provide([AuthorizationLive, MalformedRequestLive]),
      ),
    ),
    Layer.provide(ConfigLive),
  );
  return Layer.mergeAll(
    ApiRoutes,
    GoogleCallbackRoutes,
    CorsAndOrigin.pipe(Layer.provide(ConfigLive)),
    NoStoreOnPost,
  );
};

export const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchIf(
      (error) => HttpServerError.isHttpServerError(error) && error.reason._tag === "RouteNotFound",
      () =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: { code: "NOT_FOUND", message: "No such authentication route." } },
            { status: 404 },
          ),
        ),
    ),
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      return Effect.logError("auth.request_failed").pipe(
        Effect.annotateLogs(causeDiagnostics(cause)),
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            {
              error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "The authentication request could not be handled.",
              },
            },
            { status: 500 },
          ),
        ),
      );
    }),
  );
