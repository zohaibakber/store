import {
  AccessTokenService,
  activeJwtKeyId,
  decodeSigningJwkText,
  decodeJwtKeyRingText,
  EmailProvider,
  PasswordHasher,
  WebCrypto,
} from "@store/auth";
import { AuthDatabase } from "@store/db/auth/infra";
import { Api, OrgHub } from "@store/server/api";
import { buildOncePerIsolate, workerRuntimeServices } from "@store/server/runtime/isolate";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { AuthCrypto } from "./src/crypto";
import { AuthD1 } from "./src/d1";
import {
  AuthDeploymentConfig,
  resolveAuthDeployment,
  resolveProductionAuthHostname,
} from "./src/deployment";
import { EphemeralStore } from "./src/ephemeral";
import { GoogleOAuth } from "./src/google";
import { GoogleIdentity } from "./src/google-identity";
import { authRoutes, recoverUnexpected } from "./src/http";
import { HubRevocation } from "./src/hub-revocation";
import { writeJwksAssets } from "./src/jwks-asset";
import { AUTH_RATE_LIMIT_PERIOD_SECONDS, AuthLimiter } from "./src/limits";
import { Login } from "./src/login";
import { Organizations } from "./src/organization-ops";
import { AuthRepository } from "./src/repository";
import { pruneExpiredSessions, SESSION_PRUNE_POLICY } from "./src/session-maintenance";
import { Sessions } from "./src/session-ops";
import { AuthSettings } from "./src/settings";

const OperationsLive = Layer.mergeAll(Login.layer, GoogleIdentity.layer, Organizations.layer).pipe(
  Layer.provideMerge(Sessions.layer),
);

export class Auth extends Cloudflare.Worker<Auth, {}>()("Auth") {}

export const AuthLive = Auth.make(
  Effect.gen(function* () {
    const database = yield* AuthDatabase;
    const { stage } = yield* Alchemy.Stack;
    const published = stage === "prod";
    const settings = yield* AuthDeploymentConfig;
    const authHostname =
      !globalThis.__ALCHEMY_RUNTIME__ && published
        ? resolveProductionAuthHostname(settings)
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
              yield* decodeJwtKeyRingText(publicJwkText),
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
        AUTH_BASE_URL: settings.authBaseUrl,
        AUTH_TRUSTED_ORIGINS: settings.trustedOrigins,
      },
    };
    const served = assets ? { ...worker, assets } : worker;
    return authHostname
      ? {
          ...served,
          name: "tabaaq-auth-prod-lsvjysktazcvrrda",
          domain: authHostname,
          workersDev: false,
        }
      : served;
  }),
  Effect.gen(function* () {
    const databaseResource = yield* AuthDatabase;
    const databaseBinding = yield* Cloudflare.D1.QueryDatabase(databaseResource);
    const { stage } = yield* Alchemy.Stack;
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
    const { security, developmentOtp } = yield* Effect.fromResult(
      resolveAuthDeployment(yield* AuthDeploymentConfig, { stage, localDevelopment }),
    ).pipe(
      Effect.mapError((reason) => new Error(reason)),
      Effect.orDie,
    );

    const signingJwk = yield* Effect.flatMap(
      Config.Redacted("AUTH_JWT_PRIVATE_JWK"),
      decodeSigningJwkText,
    ).pipe(Effect.orDie);
    const publicJwkText = yield* Config.String("AUTH_JWT_PUBLIC_JWK");
    const keys = yield* decodeJwtKeyRingText(publicJwkText).pipe(Effect.orDie);
    const refreshTokenPepper = yield* Config.Redacted("AUTH_REFRESH_TOKEN_PEPPER");
    const ephemeralPepper = yield* Config.Redacted("AUTH_EPHEMERAL_PEPPER");
    const googleClientId = yield* Config.String("GOOGLE_OAUTH_CLIENT_ID");
    const googleClientSecret = yield* Config.Redacted("GOOGLE_OAUTH_CLIENT_SECRET");
    const tenPerMinute = yield* Cloudflare.Workers.RateLimit("AUTH_TEN_PER_MINUTE", {
      namespaceId: 1003,
      simple: { limit: 10, period: AUTH_RATE_LIMIT_PERIOD_SECONDS },
    });
    const fivePerMinute = yield* Cloudflare.Workers.RateLimit("AUTH_FIVE_PER_MINUTE", {
      namespaceId: 1004,
      simple: { limit: 5, period: AUTH_RATE_LIMIT_PERIOD_SECONDS },
    });
    const sixtyPerMinute = yield* Cloudflare.Workers.RateLimit("AUTH_SIXTY_PER_MINUTE", {
      namespaceId: 1005,
      simple: { limit: 60, period: AUTH_RATE_LIMIT_PERIOD_SECONDS },
    });
    const orgHubs = yield* globalThis.__ALCHEMY_RUNTIME__ ? OrgHub.from("Api") : OrgHub.from(Api);
    const execution = yield* Cloudflare.WorkerExecutionContext;

    const isolateServices = yield* workerRuntimeServices;
    const database = yield* databaseBinding.raw.pipe(Effect.provideContext(isolateServices));
    const DependenciesLive = Layer.mergeAll(
      AuthRepository.layer,
      EphemeralStore.layer(ephemeralPepper),
      PasswordHasher.layer,
      AccessTokenService.layer({
        issuer: security.baseURL,
        audience: "tabaaq-api",
        keys,
        activeKeyId: activeJwtKeyId(keys, signingJwk.publicHalf),
        privateJwk: signingJwk.jwk,
      }).pipe(Layer.provide(WebCrypto.layer)),
      developmentOtp ? EmailProvider.layerDevelopment : EmailProvider.layerDisabled,
      GoogleOAuth.layer({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        callbackUrl: `${security.baseURL}/v1/oauth/google/callback`,
      }).pipe(Layer.provide(FetchHttpClient.layer)),
      HubRevocation.layer(orgHubs, (effect) => execution.waitUntil(effect)),
      AuthLimiter.layer({
        tenPerMinute: (key) => tenPerMinute.limit({ key }),
        fivePerMinute: (key) => fivePerMinute.limit({ key }),
        sixtyPerMinute: (key) => sixtyPerMinute.limit({ key }),
      }),
      Layer.succeed(AuthSettings, {
        developmentOtp,
        trustedRedirects: security.trustedRedirects,
        refreshTokenPepper,
      }),
    ).pipe(Layer.provide(AuthD1.layer(database)), Layer.provideMerge(AuthCrypto.layer));
    const runtime = yield* Effect.exit(
      buildOncePerIsolate(
        Effect.gen(function* () {
          const dependencies = yield* Layer.build(DependenciesLive);
          const ServiceLive = OperationsLive.pipe(
            Layer.provideMerge(Layer.succeedContext(dependencies)),
          );
          const RoutesLive = authRoutes({
            keys,
            secureCookies: security.secureCookies,
            trustedOrigins: security.trustedOrigins,
          }).pipe(Layer.provide(ServiceLive), Layer.provide(HttpServer.layerServices));
          const serveRequest = yield* HttpRouter.toHttpEffect(RoutesLive);
          return { serveRequest, repository: Context.get(dependencies, AuthRepository) };
        }),
        isolateServices,
      ),
    );
    yield* Cloudflare.Workers.cron(SESSION_PRUNE_POLICY.cronExpression, () =>
      Exit.isSuccess(runtime)
        ? pruneExpiredSessions(runtime.value.repository).pipe(
            Effect.tap((progress) => Effect.log("auth session prune run", progress)),
            Effect.tapError((error) =>
              Effect.logError("auth session prune failed").pipe(
                Effect.annotateLogs({ operation: error.operation, message: error.message }),
              ),
            ),
            Effect.ignore,
          )
        : Effect.logError("auth session prune skipped: the auth runtime failed to build"),
    );

    const serveRequest = Exit.isSuccess(runtime)
      ? runtime.value.serveRequest
      : Effect.failCause(runtime.cause);
    const handler = recoverUnexpected(serveRequest);

    return { fetch: handler };
  }).pipe(
    Effect.provide(Cloudflare.Workers.CronEventSourceLive),
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.Workers.RateLimitBinding),
  ),
);

export default AuthLive;
