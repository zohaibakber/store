import {
  AuthBadRequest,
  type AuthErrorCode,
  AuthHttpApi,
  Authorization,
  AuthUnauthenticated,
  authHttpErrorStatus,
  CurrentAccessToken,
  MalformedRequest,
  presentedCredential,
  publicJwks,
  type JwtKeyRing,
} from "@store/auth";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerError from "effect/http/HttpServerError";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  causeDiagnostics,
  unavailableOnInfrastructureFailure,
  type InfrastructureFailure,
} from "./errors";
import { authFailureWire, authHttpError, AuthRefusal, type AuthFailure } from "./failures";
import { GoogleIdentity } from "./google-identity";
import { OAuthState } from "./identifiers";
import { addressBucket, AUTH_RATE_LIMIT_PERIOD_SECONDS, AuthLimiter } from "./limits";
import { Login } from "./login";
import { googleOAuthAppResponse, oauthCallbackErrorResponse } from "./oauth-callback-page";
import { Organizations } from "./organization-ops";
import { Sessions } from "./session-ops";

interface AuthHttpConfiguration {
  readonly keys: JwtKeyRing;
}

class AuthHttpConfig extends Context.Service<AuthHttpConfig, AuthHttpConfiguration>()(
  "@store/auth-worker/AuthHttpConfig",
) {}

const retryAfterRateLimit = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeader(response, "retry-after", String(AUTH_RATE_LIMIT_PERIOD_SECONDS)),
  ),
);

const publicBody = (code: AuthErrorCode, message: string) => ({ error: { code, message } });

const fromAuth = <A, R>(effect: Effect.Effect<A, AuthFailure | InfrastructureFailure, R>) =>
  unavailableOnInfrastructureFailure(effect).pipe(
    Effect.tapError((failure) =>
      authFailureWire(failure).kind === "TooManyRequests" ? retryAfterRateLimit : Effect.void,
    ),
    Effect.mapError(authHttpError),
  );

const admitCallerAddress = (limiter: AuthLimiter["Service"]) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
    const address = request.headers["cf-connecting-ip"];
    return address === undefined
      ? Effect.void
      : limiter.admit("sixtyPerMinute", `address:${addressBucket(address)}`, "request");
  });

const AuthorizationLive = Layer.succeed(
  Authorization,
  Authorization.of({
    bearer: Effect.fn("AuthAuthorization.bearer")(function* (httpEffect, { credential }) {
      const token = presentedCredential(credential);
      if (Option.isNone(token)) {
        const { code, message } = authFailureWire(new AuthRefusal({ reason: "Unauthenticated" }));
        return yield* Effect.fail(AuthUnauthenticated.make(publicBody(code, message)));
      }
      return yield* Effect.provideService(httpEffect, CurrentAccessToken, token.value);
    }),
  }),
);

const malformedRequest = AuthBadRequest.make(
  publicBody("INVALID_REQUEST", "The request is not valid. Check what you entered and try again."),
);

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
    const limiter = yield* AuthLimiter;
    const login = yield* Login;
    const google = yield* GoogleIdentity;
    const sessions = yield* Sessions;
    const admitCaller = fromAuth(admitCallerAddress(limiter));

    return handlers
      .handle(
        "identify",
        Effect.fn("AuthSessionHandlers.identify")(function* ({ payload }) {
          yield* admitCaller;
          return yield* fromAuth(login.identify(payload));
        }),
      )
      .handle(
        "signInPassword",
        Effect.fn("AuthSessionHandlers.signInPassword")(function* ({ payload }) {
          yield* admitCaller;
          return yield* fromAuth(login.authenticate(payload));
        }),
      )
      .handle(
        "signInOtp",
        Effect.fn("AuthSessionHandlers.signInOtp")(function* ({ payload }) {
          yield* admitCaller;
          return yield* fromAuth(login.authenticate(payload));
        }),
      )
      .handle(
        "signUpPassword",
        Effect.fn("AuthSessionHandlers.signUpPassword")(function* ({ payload }) {
          yield* admitCaller;
          return yield* fromAuth(login.authenticate(payload));
        }),
      )
      .handle(
        "googleStart",
        Effect.fn("AuthSessionHandlers.googleStart")(function* ({ payload }) {
          yield* admitCaller;
          const url = yield* fromAuth(google.beginGoogle(payload));
          return { url: url.href };
        }),
      )
      .handle(
        "googleExchange",
        Effect.fn("AuthSessionHandlers.googleExchange")(function* ({ payload }) {
          yield* admitCaller;
          return yield* fromAuth(google.exchangeGoogle(payload));
        }),
      )
      .handle(
        "refresh",
        Effect.fn("AuthSessionHandlers.refresh")(function* ({ payload }) {
          return yield* fromAuth(sessions.refresh(Redacted.make(payload.refreshToken)));
        }),
      )
      .handle(
        "logout",
        Effect.fn("AuthSessionHandlers.logout")(function* ({ payload }) {
          yield* fromAuth(sessions.signOut(Redacted.make(payload.refreshToken)));
          return { ok: true as const };
        }),
      );
  }),
);

const OrganizationHandlers = HttpApiBuilder.group(
  AuthHttpApi,
  "organization",
  Effect.fn("AuthOrganizationHandlers.make")(function* (handlers) {
    const organizations = yield* Organizations;

    return handlers
      .handle(
        "roster",
        Effect.fn("AuthOrganizationHandlers.roster")(function* () {
          const token = yield* CurrentAccessToken;
          return yield* fromAuth(organizations.roster(token));
        }),
      )
      .handle(
        "command",
        Effect.fn("AuthOrganizationHandlers.command")(function* ({ payload }) {
          const token = yield* CurrentAccessToken;
          return yield* fromAuth(organizations.organize({ accessToken: token, command: payload }));
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
    const limiter = yield* AuthLimiter;
    const google = yield* GoogleIdentity;

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
        return yield* unavailableOnInfrastructureFailure(
          admitCallerAddress(limiter).pipe(
            Effect.andThen(google.completeGoogle({ code, state: OAuthState.make(state) })),
          ),
        ).pipe(
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
  return Layer.mergeAll(ApiRoutes, GoogleCallbackRoutes, NoStoreOnPost);
};

export const recoverUnexpected = <E, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  effect.pipe(
    Effect.catchIf(
      (error) => HttpServerError.isHttpServerError(error) && error.reason._tag === "RouteNotFound",
      () =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(publicBody("NOT_FOUND", "No such authentication route."), {
            status: 404,
          }),
        ),
    ),
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      return Effect.logError("auth.request_failed").pipe(
        Effect.annotateLogs(causeDiagnostics(cause)),
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            publicBody("INTERNAL_SERVER_ERROR", "The authentication request could not be handled."),
            { status: 500 },
          ),
        ),
      );
    }),
  );
