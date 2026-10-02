import {
  AuthClient,
  AuthorizationCode,
  type AuthClientKind,
  type IdentifyInput,
  type IssuedSession,
} from "@store/auth";
import type { WorkspaceSnapshot } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { SignInCredentials } from "@/host";

const PKCE_KEY = "tabaaq-oauth-pkce";
const configuredAuthUrl = import.meta.env.VITE_AUTH_URL?.trim();

export const authBaseUrl = (configuredAuthUrl || "http://localhost:8788").replace(/\/+$/u, "");

const browserClient: AuthClientKind = { _tag: "Browser" };

class BrowserStorageBlocked extends Schema.TaggedError<BrowserStorageBlocked>()(
  "BrowserStorageBlocked",
  { message: Schema.String },
) {}

const storageBlocked = (cause: unknown) =>
  new BrowserStorageBlocked({
    message: cause instanceof Error ? cause.message : "Browser storage is unavailable.",
  });

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const browserStore = (storage: () => KeyValueStorage) => ({
  get: (key: string) =>
    Effect.try({
      try: () => Option.fromNullishOr(storage().getItem(key)),
      catch: storageBlocked,
    }),
  set: (key: string, value: string) =>
    Effect.try({ try: () => storage().setItem(key, value), catch: storageBlocked }),
  remove: (key: string) =>
    Effect.try({ try: () => storage().removeItem(key), catch: storageBlocked }),
});

export type BrowserStore = ReturnType<typeof browserStore>;

const proofKey = Effect.promise(async () => {
  const verifier = Encoding.encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = Encoding.encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  return { verifier, challenge };
});

type BrowserSignInOptions<E, R> = {
  readonly redirectUri: string;
  readonly storage: BrowserStore;
  readonly openAuthorization: (url: string) => Effect.Effect<void, E>;
  readonly adopt: (issued: IssuedSession) => Effect.Effect<WorkspaceSnapshot, never, R>;
};

export const browserSignIn = <E, R>(options: BrowserSignInOptions<E, R>) => ({
  identify: (input: IdentifyInput) => AuthClient.use((client) => client.identify(input)),
  authenticate: (credentials: SignInCredentials) =>
    AuthClient.use((client) => client.authenticate({ ...credentials, client: browserClient })).pipe(
      Effect.flatMap(options.adopt),
    ),
  beginGoogle: Effect.gen(function* () {
    const client = yield* AuthClient;
    const { verifier, challenge } = yield* proofKey;
    yield* options.storage.set(PKCE_KEY, verifier);
    const authorization = yield* client.beginGoogle({
      redirectUri: options.redirectUri,
      codeChallenge: challenge,
      client: browserClient,
    });
    yield* options.openAuthorization(authorization.url);
  }),
  completeGoogle: Effect.fnUntraced(function* (callbackUrl: string) {
    const code = URL.parse(callbackUrl)?.searchParams.get("code");
    const verifier = yield* options.storage
      .get(PKCE_KEY)
      .pipe(Effect.orElseSucceed(() => Option.none<string>()));
    if (!code || Option.isNone(verifier) || verifier.value === "") return null;
    yield* Effect.ignore(options.storage.remove(PKCE_KEY));
    const authorizationCode = yield* Schema.decodeUnknownEffect(AuthorizationCode)(code);
    const client = yield* AuthClient;
    const issued = yield* client.exchangeGoogle({
      code: authorizationCode,
      codeVerifier: verifier.value,
      client: browserClient,
    });
    return yield* options.adopt(issued);
  }),
});
