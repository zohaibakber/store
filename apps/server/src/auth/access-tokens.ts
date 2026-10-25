import {
  decodeJwtKeyRingText,
  type AccessTokenVerifier,
  makeAccessTokenVerifier,
} from "@store/auth";
import {
  DEFAULT_ELECTRON_PROTOCOL,
  fallbackIfBlank,
  LOCAL_WEB_ORIGINS,
  parseTrustedOrigins,
  publicHostnameFrom,
  resolveAuthSecurity,
} from "@store/auth/security";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  PRODUCTION_API_DOMAIN_MISSING_MESSAGE,
  PRODUCTION_DOMAIN_MISSING_MESSAGE,
  productionDomainConfig,
  productionSiteOrigin,
  resolveProductionApiHostname,
  resolveProductionHostname,
} from "../runtime/production-domain";

export class AccessTokens extends Context.Service<
  AccessTokens,
  {
    readonly trustedOrigins: ReadonlyArray<string>;
    readonly verify: AccessTokenVerifier;
  }
>()("@store/server/AccessTokens") {
  static readonly layer = Layer.effect(
    AccessTokens,
    Effect.gen(function* () {
      const { stage } = yield* Alchemy.Stack;
      const authPublicJwkText = yield* Config.String("AUTH_JWT_PUBLIC_JWK");
      const authBaseUrl = yield* Config.String("AUTH_BASE_URL").pipe(Config.withDefault(""));
      const productionAuthDomain = yield* Config.String("PRODUCTION_AUTH_DOMAIN").pipe(
        Config.withDefault(""),
      );
      const productionDomainEnv = yield* productionDomainConfig;
      const trustedOrigins = parseTrustedOrigins(productionDomainEnv.AUTH_TRUSTED_ORIGINS);
      const electronProtocol = yield* Config.String("ELECTRON_PROTOCOL").pipe(
        Config.withDefault(""),
        Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
      );
      const localDevelopment = yield* Alchemy.ALCHEMY_DEV;
      const published = stage === "prod";
      const productionHostname = resolveProductionHostname(productionDomainEnv);
      const productionApiHostname = resolveProductionApiHostname(productionDomainEnv);
      if (!globalThis.__ALCHEMY_RUNTIME__ && !localDevelopment && published) {
        if (!productionHostname) {
          return yield* Effect.die(new Error(PRODUCTION_DOMAIN_MISSING_MESSAGE));
        }
        if (!productionApiHostname) {
          return yield* Effect.die(new Error(PRODUCTION_API_DOMAIN_MISSING_MESSAGE));
        }
      }
      const siteOrigin = productionSiteOrigin(productionDomainEnv);
      const authHostname =
        publicHostnameFrom(productionAuthDomain) ??
        (productionHostname ? `auth.${productionHostname}` : undefined);
      const authOrigin =
        authBaseUrl.trim() ||
        (localDevelopment || !authHostname ? "http://localhost:8788" : `https://${authHostname}`);
      const security = resolveAuthSecurity({
        baseURL: authOrigin,
        electronProtocol,
        trustedOrigins: [
          ...trustedOrigins,
          ...(siteOrigin ? [siteOrigin] : []),
          ...(localDevelopment ? LOCAL_WEB_ORIGINS : []),
        ],
      });
      yield* Effect.forEach(
        security.rejectedSettings,
        (setting) =>
          Effect.logError("auth.setting_rejected").pipe(
            Effect.annotateLogs({
              message: `${setting.setting} value "${setting.value}" ${setting.reason} and was ignored.`,
              setting: setting.setting,
              value: setting.value,
              reason: setting.reason,
            }),
          ),
        { discard: true },
      );
      const keys = yield* decodeJwtKeyRingText(authPublicJwkText).pipe(Effect.orDie);
      const verify = yield* makeAccessTokenVerifier({
        issuer: security.baseURL,
        audience: "tabaaq-api",
        keys,
      });
      return AccessTokens.of({ trustedOrigins: security.trustedOrigins, verify });
    }),
  );
}
