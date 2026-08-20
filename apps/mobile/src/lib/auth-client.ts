import {
  AuthClientError,
  BeginGoogleInput,
  ExchangeGoogleInput,
  IdentifyInput,
  LoginCommand,
  makeAuthClient,
  nativeClient,
  TokenSet,
  type LoginRoute,
  type TokenSet as TokenSetType,
} from "@store/auth";
import {
  type AuthenticatedWorkspaceSnapshot,
  unauthenticatedWorkspace,
  WorkspaceSnapshot,
} from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import * as SecureStore from "expo-secure-store";
import Storage from "expo-sqlite/kv-store";

import { isOfflineCause, OfflineError } from "@/lib/offline";

export { isOfflineCause, OfflineError } from "@/lib/offline";

const TOKEN_KEY = "tabaaq-auth-tokens-v1";
const SNAPSHOT_KEY = "tabaaq-auth-snapshot-v1";
const SESSION_TIMEOUT_MS = 8_000;
const REFRESH_WINDOW_MS = 60_000;

const metroHost =
  Constants.expoConfig?.hostUri?.split(":")[0] ??
  (process.env.EXPO_OS === "android" ? "10.0.2.2" : "localhost");
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const configuredAuthUrl = process.env.EXPO_PUBLIC_AUTH_URL?.trim();

export const apiOrigin = (
  configuredApiUrl || (__DEV__ ? `http://${metroHost}:8787` : "")
).replace(/\/api\/?$/u, "");
export const authOrigin = (
  configuredAuthUrl || (__DEV__ ? `http://${metroHost}:8788` : "")
).replace(/\/+$/u, "");
export const mobileApplicationId = __DEV__ ? "com.tabaaq.mobile.debug" : "com.tabaaq.mobile";
export const mobileNativeOrigin = `${mobileApplicationId}://app`;

const client = makeAuthClient({ baseUrl: authOrigin });
const native = nativeClient(__DEV__ ? "Tabaaq Dev Mobile" : "Tabaaq Mobile");

let tokens: TokenSetType | null = null;
let refreshInFlight: Promise<TokenSetType | null> | null = null;

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const persistTokens = async (next: TokenSetType | null) => {
  tokens = next;
  if (next) {
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(next));
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};

const decodeStoredTokens = (serialized: string | null) => {
  if (!serialized) return null;
  try {
    return Schema.decodeUnknownOption(TokenSet)(JSON.parse(serialized)).pipe(Option.getOrNull);
  } catch {
    return null;
  }
};

export const restoreTokens = async () => {
  const serialized = await SecureStore.getItemAsync(TOKEN_KEY);
  const restored = decodeStoredTokens(serialized);
  if (!restored && serialized) await SecureStore.deleteItemAsync(TOKEN_KEY);
  tokens = restored;
  return restored;
};

export const isDeviceOffline = async () => {
  const state = await Network.getNetworkStateAsync();
  return state.isConnected === false || state.isInternetReachable === false;
};

const refreshTokens = async () => {
  if (refreshInFlight) return refreshInFlight;
  const refreshToken = tokens?.refreshToken;
  if (!refreshToken || (await isDeviceOffline())) return null;

  refreshInFlight = run(client.refresh({ refreshToken }))
    .then(async (next) => {
      await persistTokens(next);
      return next;
    })
    .catch(async (cause: unknown) => {
      if (cause instanceof AuthClientError && (cause.status === 401 || cause.status === 403)) {
        await persistTokens(null);
      }
      if (isOfflineCause(cause)) return null;
      throw cause;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
};

export const getAccessToken = async () => {
  if (!tokens) await restoreTokens();
  if (!tokens) return null;
  if (tokens.accessExpiresAt > Date.now() + REFRESH_WINDOW_MS) return tokens.accessToken;
  const refreshed = await refreshTokens();
  return refreshed?.accessToken ?? null;
};

export const nativeAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await getAccessToken();
  const nativeHeaders = { "expo-origin": mobileNativeOrigin };
  return token ? { ...nativeHeaders, Authorization: `Bearer ${token}` } : nativeHeaders;
};

export const fetchWorkspaceSession = async (): Promise<typeof WorkspaceSnapshot.Type> => {
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
      .then(Schema.decodeUnknownOption(WorkspaceSnapshot))
      .then(Option.getOrNull)
      .catch(() => null);
    if (!response.ok || !payload) return unauthenticatedWorkspace({ isOnline: false });
    return payload;
  } catch (cause) {
    if (isOfflineCause(cause)) throw new OfflineError();
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
};

export const saveWorkspaceSnapshot = async (snapshot: AuthenticatedWorkspaceSnapshot) => {
  await Storage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
};

export const readWorkspaceSnapshot = async () => {
  const serialized = await Storage.getItem(SNAPSHOT_KEY);
  if (!serialized) return null;
  try {
    const snapshot = Schema.decodeUnknownOption(WorkspaceSnapshot)(JSON.parse(serialized)).pipe(
      Option.getOrNull,
    );
    return snapshot?.status === "authenticated" ? snapshot : null;
  } catch {
    return null;
  }
};

export const identifyMobile = async (email: string): Promise<LoginRoute> => {
  const input = await run(Schema.decodeUnknownEffect(IdentifyInput)({ email }));
  return run(client.identify(input));
};

export const authenticateMobile = async (input: unknown) => {
  const command = await run(Schema.decodeUnknownEffect(LoginCommand)(input));
  const next = await run(client.authenticate(command));
  await persistTokens(next);
  return next;
};

const base64Url = (value: string) =>
  value.replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");

const makePkce = async () => {
  const verifier = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/gu, "");
  const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64Url(challenge) };
};

export const beginGoogleMobile = async (redirectUri: string) => {
  const { verifier, challenge } = await makePkce();
  const input = BeginGoogleInput.make({
    redirectUri,
    codeChallenge: challenge,
    client: native,
  });
  const authorization = await run(client.beginGoogle(input));
  return { authorization, verifier };
};

export const exchangeGoogleMobile = async (input: {
  readonly code: string;
  readonly verifier: string;
}) => {
  const command = ExchangeGoogleInput.make({
    code: input.code,
    codeVerifier: input.verifier,
    client: native,
  });
  const next = await run(client.exchangeGoogle(command));
  await persistTokens(next);
  return next;
};

export const signOutMobile = async (everywhere = false) => {
  if (!tokens) await restoreTokens();
  const refreshToken = tokens?.refreshToken;
  try {
    await run(client.signOut({ ...(refreshToken ? { refreshToken } : {}), everywhere }));
  } catch (cause) {
    if (!isOfflineCause(cause)) throw cause;
  } finally {
    await persistTokens(null);
  }
};

const AuthFailure = Schema.Struct({
  message: Schema.optional(Schema.String),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.optional(Schema.String) }))),
});

export const authErrorMessage = (cause: unknown) => {
  if (isOfflineCause(cause)) return "You're offline. Your local inventory is still available.";
  if (cause instanceof AuthClientError) return cause.message;
  const failure = Schema.decodeUnknownOption(AuthFailure)(cause).pipe(Option.getOrNull);
  if (failure?.message) return failure.message;
  const nested = failure?.errors?.[0]?.message;
  if (nested) return nested;
  return "Something went wrong. Please try again.";
};

export const refreshMobileSession = refreshTokens;
export const clearMobileTokens = () => persistTokens(null);
