import {
  decideAuthSecurity,
  DEFAULT_ELECTRON_PROTOCOL,
  fallbackIfBlank,
  LOCAL_WEB_ORIGINS,
  parseTrustedOrigins,
  publicHostnameFrom,
} from "@store/auth/security";
import * as Config from "effect/Config";
import * as Result from "effect/Result";

const LOCAL_AUTH_ORIGIN = "http://localhost:8788";

export const AuthDeploymentConfig = Config.all({
  productionDomain: Config.String("PRODUCTION_DOMAIN").pipe(Config.withDefault("")),
  productionAuthDomain: Config.String("PRODUCTION_AUTH_DOMAIN").pipe(Config.withDefault("")),
  authBaseUrl: Config.String("AUTH_BASE_URL").pipe(Config.withDefault("")),
  trustedOrigins: Config.String("AUTH_TRUSTED_ORIGINS").pipe(Config.withDefault("")),
  electronProtocol: Config.String("ELECTRON_PROTOCOL").pipe(
    Config.withDefault(""),
    Config.map((value) => fallbackIfBlank(value, DEFAULT_ELECTRON_PROTOCOL)),
  ),
  developmentOtp: Config.Boolean("AUTH_DEV_OTP").pipe(Config.withDefault(false)),
});

type AuthDeploymentSettings = Config.Success<typeof AuthDeploymentConfig>;

export const resolveProductionAuthHostname = (
  settings: Pick<AuthDeploymentSettings, "productionDomain" | "productionAuthDomain">,
) => {
  const root = publicHostnameFrom(settings.productionDomain);
  return publicHostnameFrom(settings.productionAuthDomain) ?? (root ? `auth.${root}` : undefined);
};

export const resolveAuthDeployment = (
  settings: AuthDeploymentSettings,
  environment: { readonly stage: string; readonly localDevelopment: boolean },
) => {
  if (!environment.localDevelopment && settings.developmentOtp)
    return Result.fail(
      "AUTH_DEV_OTP must be disabled outside local development because it exposes OTP codes.",
    );
  const authHostname = resolveProductionAuthHostname(settings);
  const baseUrl =
    settings.authBaseUrl.trim() ||
    (!environment.localDevelopment && environment.stage === "prod" && authHostname
      ? `https://${authHostname}`
      : LOCAL_AUTH_ORIGIN);
  const siteHostname = publicHostnameFrom(settings.productionDomain);
  return Result.map(
    decideAuthSecurity({
      baseURL: baseUrl,
      electronProtocol: settings.electronProtocol,
      trustedOrigins: [
        ...parseTrustedOrigins(settings.trustedOrigins),
        ...(environment.localDevelopment ? LOCAL_WEB_ORIGINS : []),
        ...(siteHostname ? [`https://${siteHostname}`] : []),
      ],
    }),
    (security) => ({ security, developmentOtp: settings.developmentOtp }),
  );
};
