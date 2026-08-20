import type { ConfigContext, ExpoConfig } from "expo/config";

const isProductionBuild =
  process.env.EAS_BUILD_PROFILE === "production" || process.env.APP_VARIANT === "production";

/** Runtime origins read from `extra`. Omit blanks so null does not become {}. */
const extraFromEnv = Object.fromEntries(
  Object.entries({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_AUTH_URL: process.env.EXPO_PUBLIC_AUTH_URL,
  }).filter(([, value]) => Boolean(value?.trim())),
);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isProductionBuild ? "Tabaaq" : "Tabaaq Dev",
  slug: config.slug ?? "tabaaq",
  scheme: isProductionBuild ? "com.tabaaq.mobile" : "com.tabaaq.mobile.debug",
  plugins: [...(config.plugins ?? []), "./plugins/with-android-dev-variant"],
  extra: {
    ...config.extra,
    ...extraFromEnv,
  },
});
