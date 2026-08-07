import { expoClient } from "@better-auth/expo/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const mobileScheme = "com.tabaaq.mobile";
const developmentOrigin = Platform.select({
  android: "http://10.0.2.2:8787",
  default: "http://localhost:8787",
});
const productionOrigin = "https://tabaaq.zohaibakber.com";

export const apiOrigin = (
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? developmentOrigin : productionOrigin)
).replace(/\/api\/?$/, "");

const client = createAuthClient({
  baseURL: apiOrigin,
  plugins: [
    organizationClient(),
    // @better-auth/expo and better-auth currently expose incompatible copies
    // of the same BetterFetch generic under Bun. The runtime plugin contract is
    // identical; narrowing only this boundary preserves the typed organization
    // client while upstream aligns the declarations.
    expoClient({
      scheme: mobileScheme,
      storagePrefix: "tabaaq",
      storage: SecureStore,
    }) as never,
  ],
});

export const authClient = client as typeof client & { getCookie: () => string };

/**
 * Authentication headers for API calls made outside Better Auth's fetch client.
 * Native requests do not receive a browser Origin header automatically, so use
 * the same trusted Expo origin that the Better Auth Expo plugin attaches.
 */
export const nativeAuthHeaders = () => {
  const cookie = authClient.getCookie();
  const origin = Linking.createURL("", { scheme: mobileScheme });

  return {
    origin,
    "expo-origin": origin,
    ...(cookie ? { cookie } : {}),
  };
};

export const authErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "Something went wrong. Please try again.";
};
