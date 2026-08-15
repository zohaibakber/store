import { Platform } from "react-native";

const developmentOrigin = Platform.select({
  android: "http://10.0.2.2:8787",
  default: "http://localhost:8787",
});
const productionOrigin = "https://tabaaq.zohaibakber.com";
export const mobileNativeOrigin = "com.tabaaq.mobile://app";

type WorkspaceSnapshot = {
  readonly status: "authenticated" | "unauthenticated";
  readonly user: { readonly id: string; readonly name: string; readonly email: string } | null;
  readonly activeOrganization: { readonly id: string; readonly name: string } | null;
  readonly organizations: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly isOnline: boolean;
};

export const apiOrigin = (
  process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? developmentOrigin : productionOrigin)
).replace(/\/api\/?$/, "");

export const clerkPublishableKey = (process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").trim();

const jwtTemplate = process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE?.trim();
export const mobileClerkTokenOptions = jwtTemplate
  ? ({ template: jwtTemplate, skipCache: true } as const)
  : ({ skipCache: true } as const);

type AccessTokenProvider = () => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider = async () => null;

export const setAccessTokenProvider = (provider: AccessTokenProvider) => {
  accessTokenProvider = provider;
};

export const nativeAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await accessTokenProvider();
  return {
    "expo-origin": mobileNativeOrigin,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export const fetchWorkspaceSession = async (): Promise<WorkspaceSnapshot> => {
  const response = await fetch(`${apiOrigin}/api/auth/session`, {
    credentials: "omit",
    headers: await nativeAuthHeaders(),
  });
  const payload = (await response.json().catch(() => null)) as WorkspaceSnapshot | null;
  if (!response.ok || !payload) {
    return {
      status: "unauthenticated",
      user: null,
      activeOrganization: null,
      organizations: [],
      isOnline: false,
    };
  }
  return payload;
};

export const authErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.length > 0) return message;
    const errors = Reflect.get(error, "errors");
    if (Array.isArray(errors) && errors[0] && typeof errors[0] === "object") {
      const nested = Reflect.get(errors[0], "message");
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
  }
  return "Something went wrong. Please try again.";
};
