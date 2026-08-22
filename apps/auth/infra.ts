import {
  DEFAULT_ELECTRON_PROTOCOL,
  DEFAULT_MOBILE_PROTOCOL,
  accessTokenLayer,
  decodeJsonWebKey,
  disabledEmailLayer,
  developmentEmailLayer,
  fallbackIfBlank,
  parseTrustedOrigins,
  passwordHasherLayer,
  resolveAuthSecurity,
} from "@store/auth";
import { AuthDatabase } from "@store/db/auth/infra";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as HttpServerError from "effect/unstable/http/HttpServerError";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { ephemeralStoreLayer } from "./src/ephemeral";
import { googleOAuthLayer } from "./src/google";
import { authRoutes } from "./src/http";
import { authRepositoryLayer } from "./src/repository";
import { authServiceLayer } from "./src/service";

const LOCAL_AUTH_ORIGIN = "http://localhost:8788";
const LOCAL_WEB_ORIGINS = ["http://localhost:5173", "http://localhost:5174"] as const;

const hostname = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return undefined;
  }
};

export const resolveProductionAuthHostname = (input: {
  readonly productionDomain: string;
  readonly productionAuthDomain: string;
}) =>
  hostname(input.productionAuthDomain) ??
  (() => {
    const root = hostname(input.productionDomain);
    return root ? `auth.${root}` : undefined;
  })();

export class Auth extends Cloudflare.Worker<Auth, {}>()("Auth") {}

export const AuthLive = Auth.make(
  Effect.gen(function* () {
    const database = yield* AuthDatabase;
    const ephemeral = yield* Cloudflare.KV.Namespace("AuthEphemeral");
    const { stage } = yield* Alchemy.Stack;
    const productionDomain = process.env.PRODUCTION_DOMAIN ?? "";
    const productionAuthDomain = process.env.PRODUCTION_AUTH_DOMAIN ?? "";
    const authHostname =
      !globalThis.__ALCHEMY_RUNTIME__ && stage === "prod"
        ? resolveProductionAuthHostname({ productionDomain, productionAuthDomain })
        : undefined;
    if (!globalThis.__ALCHEMY_RUNTIME__ && stage === "prod" && !authHostname) {
      return yield* Effect.die(
        new Error(
          "Production auth hostname is missing. Set PRODUCTION_DOMAIN or PRODUCTION_AUTH_DOMAIN.",
        ),
      );
    }
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
        AUTH_EPHEMERAL: ephemeral,
      },
    };
    return authHostname ? { ...worker, domain: authHostname } : worker;
  }),
  Effect.gen(function* () {
    const databaseResource = yield* AuthDatabase;
    const ephemeralResource = yield* Cloudflare.KV.Namespace("AuthEphemeral");
    const databaseBinding = yield* Cloudflare.D1.QueryDatabase(databaseResource);
    const ephemeralBinding = yield* Cloudflare.KV.ReadWriteNamespace(ephemeralResource);
    const { stage } = yield* Alchemy.Stack;
    const localDevelopment = yield* Alchemy.ALCHEMY_DEV;

    const productionDomain = yield* Config.string("PRODUCTION_DOMAIN").pipe(Config.withDefault(""));
    const productionAuthDomain = yield* Config.string("PRODUCTION_AUTH_DOMAIN").pipe(
      Config.withDefault(""),
    );
    const configuredAuthUrl = yield* Config.string("AUTH_BASE_URL").pipe(Config.withDefault(""));
    const authHostname = resolveProductionAuthHostname({
      productionDomain,
      productionAuthDomain,
    });
    const baseUrl =
      configuredAuthUrl.trim() ||
      (!localDevelopment && stage === "prod" && authHostname
        ? `https://${authHostname}`
        : LOCAL_AUTH_ORIGIN);
    const trustedOriginsRaw = yield* Config.string("AUTH_TRUSTED_ORIGINS").pipe(
      Config.withDefault(""),
    );
    const electronProtocol = yield* Config.string("ELECTRON_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
    );
    const mobileProtocol = yield* Config.string("MOBILE_PROTOCOL").pipe(
      Config.withDefault(""),
      Config.map((value) => fallbackIfBlank(value, DEFAULT_MOBILE_PROTOCOL)),
    );
    const security = resolveAuthSecurity({
      baseURL: baseUrl,
      electronProtocol,
      mobileProtocol,
      trustedOrigins: [
        ...parseTrustedOrigins(trustedOriginsRaw),
        ...(localDevelopment ? LOCAL_WEB_ORIGINS : []),
        ...(productionDomain ? [`https://${hostname(productionDomain)}`] : []),
      ].filter((origin): origin is string => Boolean(origin)),
    });

    const privateJwkText = Redacted.value(yield* Config.redacted("AUTH_JWT_PRIVATE_JWK"));
    const publicJwkText = yield* Config.string("AUTH_JWT_PUBLIC_JWK");
    const privateJwk = yield* Effect.try({
      try: () => JSON.parse(privateJwkText),
      catch: (cause) => new Error(`AUTH_JWT_PRIVATE_JWK is invalid JSON: ${String(cause)}`),
    }).pipe(Effect.flatMap(decodeJsonWebKey), Effect.orDie);
    const publicJwk = yield* Effect.try({
      try: () => JSON.parse(publicJwkText),
      catch: (cause) => new Error(`AUTH_JWT_PUBLIC_JWK is invalid JSON: ${String(cause)}`),
    }).pipe(Effect.flatMap(decodeJsonWebKey), Effect.orDie);
    const refreshTokenPepper = Redacted.value(yield* Config.redacted("AUTH_REFRESH_TOKEN_PEPPER"));
    const ephemeralPepper = Redacted.value(yield* Config.redacted("AUTH_EPHEMERAL_PEPPER"));
    const googleClientId = yield* Config.string("GOOGLE_OAUTH_CLIENT_ID");
    const googleClientSecret = Redacted.value(yield* Config.redacted("GOOGLE_OAUTH_CLIENT_SECRET"));
    /** Native apps sign in with Google's own SDK, which mints its own audience. */
    const googleNativeClientIds = yield* Config.string("GOOGLE_OAUTH_NATIVE_CLIENT_IDS").pipe(
      Config.withDefault(""),
      Config.map((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
    const developmentOtp = yield* Config.boolean("AUTH_DEV_OTP").pipe(Config.withDefault(false));
    if (stage === "prod" && developmentOtp) {
      return yield* Effect.die(
        new Error("AUTH_DEV_OTP must be disabled in production because it exposes OTP codes."),
      );
    }

    const DependenciesLive = Layer.unwrap(
      Effect.gen(function* () {
        const database = yield* databaseBinding.raw;
        const ephemeral = yield* ephemeralBinding.raw;
        return Layer.mergeAll(
          authRepositoryLayer(database),
          ephemeralStoreLayer(ephemeral, ephemeralPepper),
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
        );
      }),
    );
    const ServiceLive = authServiceLayer({
      developmentOtp,
      trustedRedirects: security.trustedRedirects,
      refreshTokenPepper,
    }).pipe(Layer.provide(DependenciesLive));
    const RoutesLive = authRoutes({
      baseUrl: security.baseURL,
      secureCookies: security.secureCookies,
      trustedOrigins: security.trustedOrigins,
    }).pipe(Layer.provide(ServiceLive), Layer.provide(HttpServer.layerServices));

    const handler = Effect.scoped(Effect.flatten(HttpRouter.toHttpEffect(RoutesLive))).pipe(
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
    Effect.provide(Cloudflare.D1.QueryDatabaseBinding),
    Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding),
  ),
);

export default AuthLive;
