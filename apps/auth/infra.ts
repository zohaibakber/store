import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  AccessTokenService,
  decodePublicKeyPem,
  decodeSigningKeyPem,
  EmailProvider,
  PasswordHasher,
  WebCrypto,
  type JwtKeyRing,
} from "@store/auth";
import { AuthDatabase, AuthEphemeralSecret, AuthSigningKeyPair } from "@store/db/auth/infra";
import { Api, OrgHub } from "@store/server/api";
import { buildOncePerIsolate, workerRuntimeServices } from "@store/server/runtime/isolate";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import {
  GOOGLE_OAUTH_CLIENT_ID,
  LOCAL_AUTH_PORT,
  PRODUCTION_AUTH_HOSTNAME,
} from "../../infra/deployment";
import { AuthCrypto } from "./src/crypto";
import { AuthD1 } from "./src/d1";
import { EphemeralStore } from "./src/ephemeral";
import { GoogleOAuth } from "./src/google";
import { GoogleIdentity } from "./src/google-identity";
import { authRoutes, recoverUnexpected } from "./src/http";
import { HubRevocation } from "./src/hub-revocation";
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

const AuthBindings = Config.all({
  origin: Config.String("AUTH_ORIGIN"),
  signingKey: Config.Redacted("AUTH_JWT_PRIVATE_KEY"),
  publicKey: Config.String("AUTH_JWT_PUBLIC_KEY"),
  ephemeralSecret: Config.Redacted("AUTH_EPHEMERAL_SECRET"),
});

class AuthDeploymentError extends Schema.TaggedError<AuthDeploymentError>()("AuthDeploymentError", {
  reason: Schema.String,
}) {}

export class Auth extends Cloudflare.Worker<Auth, {}>()("Auth") {}

export const AuthLive = Auth.make(
  Effect.gen(function* () {
    const database = yield* AuthDatabase;
    const { stage } = yield* Alchemy.Stack;
    const signingKey = yield* AuthSigningKeyPair;
    const ephemeralSecret = yield* AuthEphemeralSecret;
    const worker = {
      main: import.meta.url,
      compatibility: {
        date: "2026-07-11",
        flags: ["nodejs_compat", "enable_request_signal"],
      },
      placement: { mode: "smart" as const },
      observability: { enabled: true },
      dev: { port: LOCAL_AUTH_PORT },
      env: {
        AUTH_DB: database,
        AUTH_ORIGIN: Cloudflare.Workers.URL,
        AUTH_JWT_PRIVATE_KEY: signingKey.privateKey,
        AUTH_JWT_PUBLIC_KEY: signingKey.publicKey,
        AUTH_EPHEMERAL_SECRET: ephemeralSecret.text,
      },
    };
    return !globalThis.__ALCHEMY_RUNTIME__ && stage === "prod"
      ? {
          ...worker,
          name: "tabaaq-auth-prod-lsvjysktazcvrrda",
          domain: PRODUCTION_AUTH_HOSTNAME,
          workersDev: false,
        }
      : worker;
  }),
  Effect.gen(function* () {
    const databaseResource = yield* AuthDatabase;
    const databaseBinding = yield* Cloudflare.D1.QueryDatabase(databaseResource);
    const developmentOtp = yield* Alchemy.ALCHEMY_DEV;
    const bindings = yield* Config.option(AuthBindings);
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
    const dependencies = (keys: {
      readonly origin: string;
      readonly ring: JwtKeyRing;
      readonly signingJwk: Redacted.Redacted<JsonWebKey>;
      readonly ephemeralSecret: Redacted.Redacted<string>;
    }) =>
      Layer.mergeAll(
        AuthRepository.layer,
        EphemeralStore.layer(keys.ephemeralSecret),
        PasswordHasher.layer,
        AccessTokenService.layer({
          keys: keys.ring,
          activeKeyId: keys.ring[0]?.kid,
          privateJwk: keys.signingJwk,
        }).pipe(Layer.provide(WebCrypto.layer)),
        developmentOtp ? EmailProvider.layerDevelopment : EmailProvider.layerDisabled,
        GoogleOAuth.layer({
          clientId: GOOGLE_OAUTH_CLIENT_ID,
          clientSecret: googleClientSecret,
          callbackUrl: `${keys.origin}/v1/oauth/google/callback`,
        }).pipe(Layer.provide(FetchHttpClient.layer)),
        HubRevocation.layer(orgHubs, (effect) => execution.waitUntil(effect)),
        AuthLimiter.layer({
          tenPerMinute: (key) => tenPerMinute.limit({ key }),
          fivePerMinute: (key) => fivePerMinute.limit({ key }),
          sixtyPerMinute: (key) => sixtyPerMinute.limit({ key }),
        }),
        Layer.succeed(AuthSettings, { developmentOtp }),
      ).pipe(Layer.provide(AuthD1.layer(database)), Layer.provideMerge(AuthCrypto.layer));
    const runtime = yield* Effect.exit(
      buildOncePerIsolate(
        Effect.gen(function* () {
          const material = yield* Option.match(bindings, {
            onNone: () =>
              Effect.die(
                new AuthDeploymentError({
                  reason: "The auth Worker bindings are missing.",
                }),
              ),
            onSome: Effect.succeed,
          });
          const ring = yield* decodePublicKeyPem(material.publicKey);
          const signingJwk = yield* decodeSigningKeyPem(material.signingKey);
          const built = yield* Layer.build(
            dependencies({
              origin: material.origin,
              ring,
              signingJwk,
              ephemeralSecret: material.ephemeralSecret,
            }),
          );
          const ServiceLive = OperationsLive.pipe(Layer.provideMerge(Layer.succeedContext(built)));
          const RoutesLive = authRoutes({ keys: ring }).pipe(
            Layer.provide(ServiceLive),
            Layer.provide(HttpServer.layerServices),
          );
          const serveRequest = yield* HttpRouter.toHttpEffect(RoutesLive);
          return { serveRequest, repository: Context.get(built, AuthRepository) };
        }).pipe(Effect.provide(WebCrypto.layer)),
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
