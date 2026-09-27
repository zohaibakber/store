import {
  AuthHttpApi,
  Authorization,
  AuthUnauthenticated,
  authHttpErrorFromStatus,
  CurrentAccessToken,
  isTrustedOrigin,
  optionalRedactedValue,
  publicJwks,
  refreshCookieName,
  refreshCookieOptions,
  refreshCookieSecurity,
  type AuthClientKind,
  type AuthHttpError,
  type JwtConfiguration,
  type TokenSet,
} from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Struct from "effect/Struct";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import type { AuthError } from "./errors";
import { AUTH_RATE_LIMIT_PERIOD_SECONDS } from "./limits";
import { googleOAuthAppResponse, oauthCallbackErrorResponse } from "./oauth-callback-page";
import { resolveRefreshCredential } from "./refresh-credential";
import { AuthService } from "./service";

interface AuthHttpConfiguration {
  readonly baseUrl: string;
  readonly publicJwk: JwtConfiguration["publicJwk"];
  readonly secureCookies: boolean;
  readonly trustedOrigins: ReadonlyArray<string>;
}

class AuthHttpConfig extends Context.Service<AuthHttpConfig, AuthHttpConfiguration>()(
  "@store/auth-worker/AuthHttpConfig",
) {}

const mapAuthError = (error: AuthError): AuthHttpError =>
  authHttpErrorFromStatus(error.status, error.code, error.message);

const retryAfterRateLimit = HttpEffect.appendPreResponseHandler((_request, response) =>
  Effect.succeed(
    HttpServerResponse.setHeader(response, "retry-after", String(AUTH_RATE_LIMIT_PERIOD_SECONDS)),
  ),
);

const fromAuth = <A, R>(effect: Effect.Effect<A, AuthError, R>) =>
  effect.pipe(
    Effect.tapError((error) => (error.status === 429 ? retryAfterRateLimit : Effect.void)),
    Effect.mapError(mapAuthError),
  );

const browserTokenPayload = <T extends TokenSet>(tokens: T, client: AuthClientKind) =>
  client._tag === "Browser" ? Struct.omit(tokens, ["refreshToken"]) : tokens;

const issueBrowserTokens = <R>(
  effect: Effect.Effect<TokenSet, AuthError, R>,
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
      const token = optionalRedactedValue(credential);
      if (!token) {
        return yield* Effect.fail(
          AuthUnauthenticated.make({
            error: { code: "UNAUTHENTICATED", message: "Sign in to continue." },
          }),
        );
      }
      return yield* Effect.provideService(httpEffect, CurrentAccessToken, token);
    }),
  }),
);

const SystemHandlers = HttpApiBuilder.group(
  AuthHttpApi,
  "system",
  Effect.fn("AuthSystemHandlers.make")(function* (handlers) {
    const configuration = yield* AuthHttpConfig;
    return handlers
      .handle("landing", () => Effect.succeed({ ok: true as const }))
      .handle("health", () => Effect.succeed({ ok: true as const }))
      .handle("jwks", () => Effect.succeed(publicJwks(configuration.publicJwk)));
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
          const cookie = optionalRedactedValue(yield* HttpApiBuilder.securityDecode(refreshCookie));
          const resolved = resolveRefreshCredential({
            cookie,
            bodyToken: payload.refreshToken,
          });
          const tokens = yield* fromAuth(auth.refresh({ refreshToken: resolved?.refreshToken }));
          const client: AuthClientKind = resolved?.client ?? {
            _tag: "Native",
            deviceName: "Native client",
          };
          if (client._tag === "Browser" && tokens.refreshToken) {
            yield* HttpApiBuilder.securitySetCookie(refreshCookie, tokens.refreshToken, {
              ...refreshCookieOptions(cookies),
              expires: new Date(tokens.refreshExpiresAt),
            });
          }
          return browserTokenPayload(tokens, client);
        }),
      )
      .handle(
        "logout",
        Effect.fn("AuthSessionHandlers.logout")(function* ({ payload }) {
          const cookie = optionalRedactedValue(yield* HttpApiBuilder.securityDecode(refreshCookie));
          const refreshToken = resolveRefreshCredential({
            cookie,
            bodyToken: payload.refreshToken,
          })?.refreshToken;
          yield* fromAuth(auth.signOut({ ...payload, refreshToken }));
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

const GoogleCallbackRoutes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* AuthService;
    const configuration = yield* AuthHttpConfig;

    yield* router.add(
      "GET",
      "/v1/oauth/google/callback",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(request.originalUrl, configuration.baseUrl);
        if (url.searchParams.get("error") === "access_denied") {
          return oauthCallbackErrorResponse(400, "Google sign-in was cancelled.");
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) {
          return oauthCallbackErrorResponse(400, "Google did not return an authorization code.");
        }
        return yield* auth.completeGoogle({ code, state }).pipe(
          Effect.map((callback) => {
            const redirect = new URL(callback.redirectUri);
            redirect.searchParams.set("code", callback.code);
            return googleOAuthAppResponse(redirect);
          }),
          Effect.catchTag("Auth.AuthError", (error) =>
            Effect.succeed(oauthCallbackErrorResponse(error.status, error.message)),
          ),
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
      allowedHeaders: ["Authorization", "Content-Type"],
      allowedMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      maxAge: 600,
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

export const authRoutes = (configuration: AuthHttpConfiguration) => {
  const ConfigLive = Layer.succeed(AuthHttpConfig, configuration);
  const ApiRoutes = HttpApiBuilder.layer(AuthHttpApi).pipe(
    Layer.provide(
      Layer.mergeAll(SystemHandlers, SessionHandlers, OrganizationHandlers).pipe(
        Layer.provide(AuthorizationLive),
      ),
    ),
    Layer.provide(ConfigLive),
  );
  return Layer.mergeAll(
    ApiRoutes,
    GoogleCallbackRoutes.pipe(Layer.provide(ConfigLive)),
    CorsAndOrigin.pipe(Layer.provide(ConfigLive)),
  );
};

export const buildOncePerIsolate = <A, E, R>(
  build: Effect.Effect<A, E, R | Scope.Scope>,
  isolateServices: Context.Context<R>,
) =>
  Effect.gen(function* () {
    const neverClosedIsolateScope = yield* Scope.make();
    return yield* build.pipe(
      Scope.provide(neverClosedIsolateScope),
      Effect.updateContext<never, R>(() => isolateServices),
    );
  });

export const workerRuntimeServices = Effect.serviceOption(RuntimeContext).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.die(new Error("Alchemy did not provide the Worker RuntimeContext.")),
      onSome: (runtime) => Effect.succeed(Context.make(RuntimeContext, runtime)),
    }),
  ),
);
