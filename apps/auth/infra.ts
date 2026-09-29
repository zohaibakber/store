import {
  accessTokenLayer,
  decodeJsonWebKeyText,
  disabledEmailLayer,
  developmentEmailLayer,
  passwordHasherLayer,
} from "@store/auth";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  fallbackIfBlank,
  LOCAL_WEB_ORIGINS,
  parseTrustedOrigins,
  publicHostnameFrom,
  resolveAuthSecurity,
} from "@store/auth/security";
import { AuthDatabase } from "@store/db/auth/infra";
import { Api, OrgHub } from "@store/server/api";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ephemeralStoreLayer } from "./src/ephemeral";
import { googleOAuthLayer } from "./src/google";
import { authRoutes, buildOncePerIsolate, workerRuntimeServices } from "./src/http";
import { hubRevocationLayer } from "./src/hub-revocation";
import { writeJwksAssets } from "./src/jwks-asset";
import { AUTH_RATE_LIMIT_PERIOD_SECONDS } from "./src/limits";
import { resolveProductionAuthHostname } from "./src/public-hostname";
import { AuthRepository, authRepositoryLayer } from "./src/repository";
import { authServiceLayer } from "./src/service";
import { pruneExpiredSessions, SESSION_PRUNE_POLICY } from "./src/session-maintenance";

const LOCAL_AUTH_ORIGIN = "http://localhost:8788";

export class Auth extends Cloudflare.Worker<Auth, {}>()("Auth") {}

export const AuthLive = Auth.make(
  Effect.gen(function* () {
    const database = yield* AuthDatabase;
    const { stage } = yield* Alchemy.Stack;
    const published = stage === "prod";
    const productionDomain = yield* Config.String("PRODUCTION_DOMAIN").pipe(Config.withDefault(""));
    const productionAuthDomain = yield* Config.String("PRODUCTION_AUTH_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const authBaseUrl = yield* Config.String("AUTH_BASE_URL").pipe(Config.withDefault(""));
    const trustedOrigins = yield* Config.String("AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const authHostname =
      !globalThis.__ALCHEMY_RUNTIME__ && published
        ? resolveProductionAuthHostname({ productionDomain, productionAuthDomain })
        : undefined;
    if (!globalThis.__ALCHEMY_RUNTIME__ && published && !authHostname) {
      return yield* Effect.die(
        new Error(
          "Published auth hostname is missing. Set PRODUCTION_DOMAIN or PRODUCTION_AUTH_DOMAIN.",
        ),
      );
    }
    const assets = globalThis.__ALCHEMY_RUNTIME__
      ? undefined
      : yield* Effect.flatMap(Config.String("AUTH_JWT_PUBLIC_JWK"), (publicJwkText) =>
          Effect.gen(function* () {
            const path = yield* Path.Path;
            return yield* writeJwksAssets(
              path.join(import.meta.dirname, ".alchemy", "jwks-assets"),
              yield* decodeJsonWebKeyText(publicJwkText),
            );
          }).pipe(Effect.orDie),
        );
    const worker = {
      main: import.meta.url,
      compatibility: {
        date: "2026-07-11",
        flags: ["nodejs_compat", "enable_request_signal"],
      },
      placement: { mode: "smart" as const },
      observability: { enabled: true },
      dev: { port: 8788 },
      env: {
        AUTH_DB: database,
        AUTH_BASE_URL: authBaseUrl,
        AUTH_TRUSTED_ORIGINS: trustedOrigins,
      },
    };
    const served = assets ? { ...worker, assets } : worker;
    return authHostname ? { ...served, domain: authHostname, workersDev: false } : served;
  }),
  Effect.gen(function* () {
    const databaseResource = yield* AuthDatabase;
    const databaseBinding = yield* Cloudflare.D1.QueryDatabase(databaseResource);
    const { stage } = yield* Alchemy.Stack;
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
    const published = stage === "prod";

    const productionDomain = yield* Config.String("PRODUCTION_DOMAIN").pipe(Config.withDefault(""));
    const productionAuthDomain = yield* Config.String("PRODUCTION_AUTH_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const configuredAuthUrl = yield* Config.String("AUTH_BASE_URL").pipe(Config.withDefault(""));
    const authHostname = resolveProductionAuthHostname({
      productionDomain,
      productionAuthDomain,
    });
    const baseUrl =
      configuredAuthUrl.trim() ||
      (!localDevelopment && published && authHostname
        ? `https://${authHostname}`
        : LOCAL_AUTH_ORIGIN);
    const trustedOriginsRaw = yield* Config.String("AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const electronProtocol = yield* Config.String("ELECTRON_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
    );
    const mobileProtocol = yield* Config.String("MOBILE_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)),
    );
    const siteHostname = publicHostnameFrom(productionDomain);
    const security = resolveAuthSecurity({
      baseURL: baseUrl,
      electronProtocol,
      mobileProtocol,
      trustedOrigins: [
        ...parseTrustedOrigins(trustedOriginsRaw),
        ...(localDevelopment ? LOCAL_WEB_ORIGINS : []),
        ...(siteHostname ? [`https://${siteHostname}`] : []),
      ],
    });

    const privateJwkText = Redacted.value(yield* Config.Redacted("AUTH_JWT_PRIVATE_JWK"));
    const publicJwkText = yield* Config.String("AUTH_JWT_PUBLIC_JWK");
    const privateJwk = yield* decodeJsonWebKeyText(privateJwkText).pipe(Effect.orDie);
    const publicJwk = yield* decodeJsonWebKeyText(publicJwkText).pipe(Effect.orDie);
    const refreshTokenPepper = Redacted.value(yield* Config.Redacted("AUTH_REFRESH_TOKEN_PEPPER"));
    const ephemeralPepper = Redacted.value(yield* Config.Redacted("AUTH_EPHEMERAL_PEPPER"));
    const googleClientId = yield* Config.String("GOOGLE_OAUTH_CLIENT_ID");
    const googleClientSecret = Redacted.value(yield* Config.Redacted("GOOGLE_OAUTH_CLIENT_SECRET"));
    const googleNativeClientIds = yield* Config.String("GOOGLE_OAUTH_NATIVE_CLIENT_IDS").pipe(
      Config.withDefault(""),
      Config.map((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
    const tenPerMinute = yield* Cloudflare.Workers.RateLimit("AUTH_TEN_PER_MINUTE", {
      namespaceId: 1003,
      simple: { limit: 10, period: AUTH_RATE_LIMIT_PERIOD_SECONDS },
    });
    const fivePerMinute = yield* Cloudflare.Workers.RateLimit("AUTH_FIVE_PER_MINUTE", {
      namespaceId: 1004,
      simple: { limit: 5, period: AUTH_RATE_LIMIT_PERIOD_SECONDS },
    });
    const developmentOtp = yield* Config.Boolean("AUTH_DEV_OTP").pipe(Config.withDefault(false));
    if (!localDevelopment && developmentOtp) {
      return yield* Effect.die(
        new Error(
          "AUTH_DEV_OTP must be disabled outside local development because it exposes OTP codes.",
        ),
      );
    }

    const orgHubs = yield* globalThis.__ALCHEMY_RUNTIME__ ? OrgHub.from("Api") : OrgHub.from(Api);
    const execution = yield* Cloudflare.WorkerExecutionContext;

    const isolateServices = yield* workerRuntimeServices;
    const database = yield* databaseBinding.raw.pipe(Effect.provideContext(isolateServices));
    const DependenciesLive = Layer.mergeAll(
      authRepositoryLayer(database),
      ephemeralStoreLayer(database, ephemeralPepper),
      passwordHasherLayer,
      accessTokenLayer({
        issuer: security.baseURL,
        audience: "tabaaq-api",
        privateJwk,
        publicJwk,
      }),
      developmentOtp ? developmentEmailLayer : disabledEmailLayer,
      googleOAuthLayer({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        callbackUrl: `${security.baseURL}/v1/oauth/google/callback`,
        nativeClientIds: googleNativeClientIds,
      }),
      hubRevocationLayer(orgHubs, (effect) => execution.waitUntil(effect)),
    );
    const runtime = yield* Effect.exit(
      Effect.gen(function* () {
        const dependencies = yield* buildOncePerIsolate(
          Layer.build(DependenciesLive),
          isolateServices,
        );
        const ServiceLive = authServiceLayer({
          developmentOtp,
          trustedRedirects: security.trustedRedirects,
          refreshTokenPepper,
          limits: {
            tenPerMinute: (key) => tenPerMinute.limit({ key }),
            fivePerMinute: (key) => fivePerMinute.limit({ key }),
          },
        }).pipe(Layer.provide(Layer.succeedContext(dependencies)));
        const RoutesLive = authRoutes({
          baseUrl: security.baseURL,
          publicJwk,
          secureCookies: security.secureCookies,
          trustedOrigins: security.trustedOrigins,
        }).pipe(Layer.provide(ServiceLive), Layer.provide(HttpServer.layerServices));
        const serveRequest = yield* buildOncePerIsolate(
          HttpRouter.toHttpEffect(RoutesLive),
          isolateServices,
        );
        return { serveRequest, repository: Context.get(dependencies, AuthRepository) };
      }),
    );
    yield* Cloudflare.Workers.cron(SESSION_PRUNE_POLICY.cronExpression, () =>
      Exit.isSuccess(runtime)
        ? pruneExpiredSessions(runtime.value.repository).pipe(
            Effect.tap((progress) => Effect.log("auth session prune run", progress)),
            Effect.tapError((error) => Effect.logError("auth session prune failed", error)),
            Effect.ignore,
          )
        : Effect.logError("auth session prune skipped: the auth runtime failed to build"),
    );

    const serveRequest = Exit.isSuccess(runtime)
      ? runtime.value.serveRequest
      : Effect.failCause(runtime.cause);
    const handler = serveRequest.pipe(
      Effect.catchIf(
        (error) =>
          HttpServerError.isHttpServerError(error) && error.reason._tag === "RouteNotFound",
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
          Effect.annotateLogs({ cause: Cause.pretty(cause) }),
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

    return { fetch: handler };
  }).pipe(
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default AuthLive;
