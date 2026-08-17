import type { ConfigContext, ExpoConfig } from "expo/config";

const isProductionBuild =
  process.env.EAS_BUILD_PROFILE === "production" || process.env.APP_VARIANT === "production";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isProductionBuild ? "Tabaaq" : "Tabaaq Dev",
  slug: config.slug ?? "tabaaq",
  scheme: isProductionBuild ? "com.tabaaq.mobile" : "com.tabaaq.mobile.debug",
  plugins: [...(config.plugins ?? []), "./plugins/with-android-dev-variant"],
});
