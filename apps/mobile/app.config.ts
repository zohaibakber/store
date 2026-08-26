import { withSentry } from "@sentry/react-native/expo";
import type { ConfigContext, ExpoConfig } from "expo/config";

const isProductionBuild =
  process.env.EAS_BUILD_PROFILE === "production" || process.env.APP_VARIANT === "production";

const extraFromEnv = Object.fromEntries(
  Object.entries({
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_AUTH_URL: process.env.EXPO_PUBLIC_AUTH_URL,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  }).filter(([, value]) => Boolean(value?.trim())),
);

/**
 * Google's iOS SDK returns to the app through the reversed client ID, so its
 * config plugin needs that scheme at prebuild time. Without an iOS client ID
 * the plugin throws, so the app builds without Google Sign-In instead.
 */
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const googleSignInPlugin: NonNullable<ExpoConfig["plugins"]> = googleIosClientId
  ? [
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme: `com.googleusercontent.apps.${googleIosClientId.replace(
            /\.apps\.googleusercontent\.com$/u,
            "",
          )}`,
        },
      ],
    ]
  : [];

export default ({ config }: ConfigContext): ExpoConfig =>
  withSentry(
    {
      ...config,
      name: isProductionBuild ? "Tabaaq" : "Tabaaq Dev",
      slug: config.slug ?? "tabaaq",
      scheme: isProductionBuild ? "com.tabaaq.mobile" : "com.tabaaq.mobile.debug",
      plugins: [...(config.plugins ?? []), ...googleSignInPlugin, "./plugins/with-android-dev-variant"],
      extra: {
        ...config.extra,
        ...extraFromEnv,
      },
    },
    {
      url: "https://sentry.io/",
      organization: "tabaaq",
      project: "tabaaq",
      disableAutoUpload: !process.env.SENTRY_AUTH_TOKEN,
      experimental_android: {
        enableAndroidGradlePlugin: true,
        autoUploadProguardMapping: true,
        uploadNativeSymbols: true,
        includeNativeSources: true,
        includeSourceContext: true,
      },
    },
  );
