import {
  accessTokenLayer,
  AUTH_JWT_KEY_ID,
  developmentEmailLayer,
  disabledEmailLayer,
  EmailAddress,
  PasswordHasher,
  type AuthClientKind,
  type OrganizationCommand,
  type OrganizationId,
  type RefreshToken,
  type UserId,
} from "@store/auth";
import { RuntimeContext } from "alchemy";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";

import { AuthCrypto } from "../src/crypto";
import { AuthD1 } from "../src/d1";
import { EphemeralStore } from "../src/ephemeral";
import { authFailureWire, type AuthFailure } from "../src/failures";
import { googleOAuthLayer } from "../src/google";
import { HubRevocation } from "../src/hub-revocation";
import { authLimiterLayer, type AuthLimits, type AuthRateLimit } from "../src/limits";
import { AuthRepository } from "../src/repository";
import { AuthService, authServiceLayer } from "../src/service";
import { AuthSettings } from "../src/settings";
import { authD1 } from "./sqlite-d1";

export const EPHEMERAL_PEPPER = Redacted.make("ephemeral-pepper");
const GOOGLE_CLIENT_ID = "web-client.apps.googleusercontent.com";
export const PASSWORD = Redacted.make("correct horse battery");

export const native: AuthClientKind = { _tag: "Native", deviceName: "Front counter" };
export const browser: AuthClientKind = { _tag: "Browser" };

const testRuntimeContext = Context.make(RuntimeContext, {
  Type: "test",
  id: "auth-service-test",
  env: {},
  get: () => Effect.succeed(undefined),
  set: (id) => Effect.succeed(id),
});

const signingKeys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const privateJwk = await crypto.subtle.exportKey("jwk", signingKeys.privateKey);
const publicJwk = await crypto.subtle.exportKey("jwk", signingKeys.publicKey);

const countingLimit = (limit: number): AuthRateLimit => {
  const counts = new Map<string, number>();
  return (key) =>
    Effect.sync(() => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { success: next <= limit };
    });
};

interface HubRevocationCall {
  readonly organizationId: OrganizationId;
  readonly userId: UserId;
}

const RS256 = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export interface IdTokenSigner {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly publicJwk: PublishedKey;
}

type PublishedKey = JsonWebKey & { readonly kid: string };

interface IdTokenClaims {
  readonly iss: string;
  readonly aud: string;
  readonly sub: string;
  readonly exp: number;
  readonly email: string;
  readonly email_verified: boolean;
  readonly name?: string;
  readonly picture?: string;
  readonly nonce?: string;
  readonly hd?: string;
}

const idTokenSigner = async (kid: string): Promise<IdTokenSigner> => {
  const keys = await crypto.subtle.generateKey(RS256, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return { kid, privateKey: keys.privateKey, publicJwk: { ...publicJwk, kid, use: "sig" } };
};

const googleSigner = await idTokenSigner("google-key-1");
export const forgingSigner = await idTokenSigner(googleSigner.kid);

export const mintIdToken = async (claims: IdTokenClaims, signer: IdTokenSigner = googleSigner) => {
  const signingInput = [{ alg: "RS256", typ: "JWT", kid: signer.kid }, claims]
    .map((part) => Base64Url.encode(JSON.stringify(part)))
    .join(".");
  const signature = await crypto.subtle.sign(
    RS256.name,
    signer.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${Base64Url.encode(new Uint8Array(signature))}`;
};

export const googleClaims = (profile: {
  readonly sub: string;
  readonly email: string;
  readonly hd?: string;
}): IdTokenClaims => ({
  iss: "https://accounts.google.com",
  aud: GOOGLE_CLIENT_ID,
  exp: Math.floor(Date.now() / 1_000) + 600,
  email_verified: true,
  name: "Google User",
  picture: "https://example.com/avatar.png",
  hd: "example.com",
  ...profile,
});

export const harness = (
  options: {
    readonly deliversOtp?: boolean;
    readonly limits?: AuthLimits;
  } = {},
) => {
  const d1 = authD1();
  const deliversOtp = options.deliversOtp ?? false;
  const revocations: Array<HubRevocationCall> = [];
  const googleHttp = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json({ keys: [googleSigner.publicJwk] })),
    ),
  );

  const dependencies = Layer.mergeAll(
    AuthRepository.layer,
    EphemeralStore.layer(EPHEMERAL_PEPPER),
    PasswordHasher.layer,
    accessTokenLayer({
      issuer: "https://auth.example.com",
      audience: "tabaaq-api",
      keys: [{ kid: AUTH_JWT_KEY_ID, jwk: publicJwk }],
      activeKeyId: AUTH_JWT_KEY_ID,
      privateJwk,
    }),
    deliversOtp ? developmentEmailLayer : disabledEmailLayer,
    googleOAuthLayer({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: Redacted.make("google-client-secret"),
      callbackUrl: "https://auth.example.com/v1/oauth/google/callback",
    }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, googleHttp))),
    Layer.succeed(
      HubRevocation,
      HubRevocation.of({
        revoke: (organizationId, userId) =>
          Effect.sync(() => {
            revocations.push({ organizationId, userId });
          }),
      }),
    ),
    authLimiterLayer(
      options.limits ?? {
        tenPerMinute: countingLimit(10),
        fivePerMinute: countingLimit(5),
        sixtyPerMinute: countingLimit(60),
      },
    ),
    Layer.succeed(AuthSettings, {
      developmentOtp: deliversOtp,
      trustedRedirects: ["https://app.example.com", "com.tabaaq.desktop://"],
      refreshTokenPepper: Redacted.make("refresh-pepper"),
    }),
  ).pipe(Layer.provide(AuthD1.layer(d1)), Layer.provideMerge(AuthCrypto.layer));

  const layer = Layer.mergeAll(
    authServiceLayer.pipe(Layer.provide(dependencies)),
    Layer.succeed(RuntimeContext, Context.get(testRuntimeContext, RuntimeContext)),
    Logger.layer([]),
  );

  return { d1, revocations, layer };
};

export type Harness = ReturnType<typeof harness>;

const withPlainTokens = (auth: typeof AuthService.Service) => ({
  ...auth,
  roster: (accessToken: string) => auth.roster(Redacted.make(accessToken)),
  organize: (input: { readonly accessToken: string; readonly command: OrganizationCommand }) =>
    auth.organize({ command: input.command, accessToken: Redacted.make(input.accessToken) }),
});

export type Api = ReturnType<typeof withPlainTokens>;

export const run = <A, E>(
  instance: Harness,
  use: (auth: Api) => Effect.Effect<A, E, RuntimeContext>,
) =>
  Effect.runPromise(
    AuthService.use((auth) => use(withPlainTokens(auth))).pipe(Effect.provide(instance.layer)),
  );

export const failing = <A>(
  instance: Harness,
  use: (auth: Api) => Effect.Effect<A, AuthFailure, RuntimeContext>,
) => run(instance, (auth) => Effect.flip(use(auth)).pipe(Effect.map(authFailureWire)));

export const count = (instance: Harness, query: string, ...params: Array<string | number>) =>
  Number(instance.d1.database.prepare(query).get(...params)?.total ?? -1);

export const signUp = (instance: Harness, email: string, client: AuthClientKind = native) =>
  run(instance, (auth) =>
    auth.authenticate({
      _tag: "RegisterPassword",
      email: EmailAddress.make(email),
      name: email.split("@")[0] ?? "Owner",
      password: PASSWORD,
      client,
    }),
  );

export const refreshWith = (
  instance: Harness,
  refreshToken: RefreshToken | undefined,
  client: AuthClientKind = native,
) =>
  run(instance, (auth) =>
    Effect.result(
      auth
        .refresh(
          refreshToken === undefined
            ? undefined
            : { client, refreshToken: Redacted.make(refreshToken) },
        )
        .pipe(Effect.mapError(authFailureWire)),
    ),
  );
