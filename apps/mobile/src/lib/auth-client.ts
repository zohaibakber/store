import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const developmentOrigin =
  process.env.EXPO_OS === "android" ? "http://10.0.2.2:8787" : "http://localhost:8787";
const productionOrigin = "https://tabaaq.zohaibakber.com";
export const mobileNativeOrigin = "com.tabaaq.mobile://app";

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
  const nativeHeaders = {
    "expo-origin": mobileNativeOrigin,
  };
  return token ? { ...nativeHeaders, Authorization: `Bearer ${token}` } : nativeHeaders;
};

export const fetchWorkspaceSession = async (): Promise<WorkspaceSnapshot> => {
  const response = await fetch(`${apiOrigin}/api/auth/session`, {
    credentials: "omit",
    headers: await nativeAuthHeaders(),
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
};

export const authErrorMessage = (cause: unknown) => {
  const failure = Schema.decodeUnknownOption(AuthFailure)(cause).pipe(Option.getOrNull);
  if (failure?.message) return failure.message;
  const nested = failure?.errors?.[0]?.message;
  if (nested) return nested;
  return "Something went wrong. Please try again.";
};
