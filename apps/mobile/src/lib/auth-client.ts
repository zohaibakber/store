import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import Constants from "expo-constants";
import * as Network from "expo-network";

import { isOfflineCause, OfflineError } from "@/lib/offline";

export { isOfflineCause, OfflineError } from "@/lib/offline";

const metroHost =
  Constants.expoConfig?.hostUri?.split(":")[0] ??
  (process.env.EXPO_OS === "android" ? "10.0.2.2" : "localhost");
const developmentOrigin = `http://${metroHost}:8787`;
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api\/?$/u, "");
export const mobileApplicationId = __DEV__ ? "com.tabaaq.mobile.debug" : "com.tabaaq.mobile";
export const mobileNativeOrigin = `${mobileApplicationId}://app`;
const SESSION_TIMEOUT_MS = 8_000;

type WorkspaceSnapshot = {
  readonly status: "authenticated" | "unauthenticated";
  readonly user: { readonly id: string; readonly name: string; readonly email: string } | null;
  readonly activeOrganization: { readonly id: string; readonly name: string } | null;
  readonly organizations: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly isOnline: boolean;
};

const WorkspaceSnapshotSchema = Schema.Struct({
  status: Schema.Literals(["authenticated", "unauthenticated"]),
  user: Schema.NullOr(
    Schema.Struct({ id: Schema.String, name: Schema.String, email: Schema.String }),
  ),
  activeOrganization: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  organizations: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  isOnline: Schema.Boolean,
});

const AuthFailure = Schema.Struct({
  message: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.optional(Schema.String) }))),
});

export const apiOrigin = (configuredApiUrl ?? (__DEV__ ? developmentOrigin : "")).replace(
  /\/api\/?$/u,
  "",
);

const ExtraConfig = Schema.Struct({
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: Schema.optional(Schema.String),
});

const extraPublishableKey = Schema.decodeUnknownOption(ExtraConfig)(
  Constants.expoConfig?.extra ?? {},
).pipe(
  Option.map((extra) => extra.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? ""),
  Option.getOrElse(() => ""),
);
export const clerkPublishableKey = (
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || extraPublishableKey
).trim();

const jwtTemplate = process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE?.trim();
export const mobileClerkTokenOptions = jwtTemplate
  ? ({ template: jwtTemplate } as const)
  : undefined;

type AccessTokenProvider = () => Promise<string | null>;

let accessTokenProvider: AccessTokenProvider = async () => null;

export const isDeviceOffline = async () => {
  const state = await Network.getNetworkStateAsync();
  return state.isConnected === false || state.isInternetReachable === false;
};

export const setAccessTokenProvider = (provider: AccessTokenProvider) => {
  accessTokenProvider = provider;
};

export const nativeAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await accessTokenProvider();
  const nativeHeaders = {
    "expo-origin": mobileNativeOrigin,
  };
  return token ? { ...nativeHeaders, Authorization: `Bearer ${token}` } : nativeHeaders;
};

export const fetchWorkspaceSession = async (): Promise<WorkspaceSnapshot> => {
  if (await isDeviceOffline()) throw new OfflineError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(`${apiOrigin}/api/auth/session`, {
      credentials: "omit",
      headers: await nativeAuthHeaders(),
      signal: controller.signal,
    });
    const payload = await response
      .json()
      .then(Schema.decodeUnknownOption(WorkspaceSnapshotSchema))
      .then(Option.getOrNull)
      .catch(() => null);
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
  } catch (cause) {
    if (isOfflineCause(cause)) throw new OfflineError();
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
};

export const authErrorMessage = (cause: unknown) => {
  if (isOfflineCause(cause)) return "You're offline. Showing the inventory saved on this device.";
  const failure = Schema.decodeUnknownOption(AuthFailure)(cause).pipe(Option.getOrNull);
  if (failure?.message) return failure.message;
  const nested = failure?.errors?.[0]?.message;
  if (nested) return nested;
  return "Something went wrong. Please try again.";
};
