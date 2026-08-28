import { withSentry } from "@sentry/react-native/expo";
import type { ConfigContext, ExpoConfig } from "expo/config";

export const publicServiceUrl = (input: {
  readonly environmentName: string;
  readonly isProduction: boolean;
  readonly value: string | undefined;
}) => {
  const value = input.value?.trim();
  if (!value) {
    if (input.isProduction) {
      throw new Error(`${input.environmentName} is required for production mobile builds.`);
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${input.environmentName} must be an absolute URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${input.environmentName} must not contain URL credentials.`);
  }
  if (input.isProduction && url.protocol !== "https:") {
    throw new Error(`${input.environmentName} must use HTTPS for production mobile builds.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${input.environmentName} must use HTTP or HTTPS.`);
  }
  return value;
};

export const publicGoogleWebClientId = (input: {
  readonly isProduction: boolean;
  readonly value: string | undefined;
}) => {
  const value = input.value?.trim();
  if (!value) {
    if (input.isProduction) {
      throw new Error("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is required for production mobile builds.");
    }
    return undefined;
  }
  if (!/^\d+-[a-z0-9-]+\.apps\.googleusercontent\.com$/iu.test(value)) {
    throw new Error("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID must be a Google OAuth web client ID.");
  }
  return value;
};

const isProductionBuild =
  process.env.EAS_BUILD_PROFILE === "production" || process.env.APP_VARIANT === "production";

const apiUrl = publicServiceUrl({
  environmentName: "EXPO_PUBLIC_API_URL",
  isProduction: isProductionBuild,
  value: process.env.EXPO_PUBLIC_API_URL,
});
const authUrl = publicServiceUrl({
  environmentName: "EXPO_PUBLIC_AUTH_URL",
  isProduction: isProductionBuild,
  value: process.env.EXPO_PUBLIC_AUTH_URL,
});
publicGoogleWebClientId({
  isProduction: isProductionBuild,
  value: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
});

const extraFromEnv = Object.fromEntries(
  Object.entries({
    EXPO_PUBLIC_API_URL: apiUrl,
    EXPO_PUBLIC_AUTH_URL: authUrl,
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
  }).filter(([, value]) => Boolean(value?.trim())),
);

/**
 * Google's iOS SDK returns to the app through the reversed client ID, so its
 * config plugin needs that scheme at prebuild time. Android autolinks Nitro
 * without the plugin; omitting it avoids a prebuild error when iOS is unset.
 */
const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const googleSignInPlugin: NonNullable<ExpoConfig["plugins"]> = googleIosClientId
  ? [
      [
        "react-native-nitro-google-signin",
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
      plugins: [
        ...(config.plugins ?? []),
        ...googleSignInPlugin,
        "./plugins/with-android-dev-variant",
      ],
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
