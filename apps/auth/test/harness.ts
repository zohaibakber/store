import {
  AccessTokenService,
  EmailAddress,
  EmailProvider,
  PasswordHasher,
  WebCrypto,
  type AuthClientKind,
  type OrganizationCommand,
  type OrganizationId,
  type RefreshToken,
  type UserId,
} from "@store/auth";
import { RuntimeContext } from "alchemy";
import { RateLimitError } from "alchemy/Cloudflare";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";

import { AuthCrypto } from "../src/crypto";
import { AuthD1 } from "../src/d1";
import { EphemeralStore } from "../src/ephemeral";
import { unavailableOnInfrastructureFailure } from "../src/errors";
import { authFailureWire, type AuthFailure } from "../src/failures";
import { GoogleOAuth } from "../src/google";
import { GoogleIdentity } from "../src/google-identity";
import { HubRevocation } from "../src/hub-revocation";
import { OAuthState } from "../src/identifiers";
import { AuthLimiter, type AuthLimits, type AuthRateLimit } from "../src/limits";
import { Login } from "../src/login";
import { Organizations } from "../src/organization-ops";
import { AuthRepository } from "../src/repository";
import { Sessions } from "../src/session-ops";
import { AuthSettings } from "../src/settings";
import { authD1 } from "./sqlite-d1";

export const EPHEMERAL_PEPPER = Redacted.make("ephemeral-pepper");
const GOOGLE_CLIENT_ID = "web-client.apps.googleusercontent.com";
export const PASSWORD = Redacted.make("correct horse battery");

export const native: AuthClientKind = { _tag: "Native", deviceName: "Front counter" };

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

export interface HubRevocationCall {
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

export const mintIdToken = (claims: IdTokenClaims, signer: IdTokenSigner = googleSigner) =>
  Effect.promise(async () => {
    const signingInput = [{ alg: "RS256", typ: "JWT", kid: signer.kid }, claims]
      .map((part) => Base64Url.encode(JSON.stringify(part)))
      .join(".");
    const signature = await crypto.subtle.sign(
      RS256.name,
      signer.privateKey,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${Base64Url.encode(new Uint8Array(signature))}`;
  });

export const googleClaims = (profile: {
  readonly sub: string;
  readonly email: string;
  readonly hd?: string;
}) =>
  Effect.map(Clock.currentTimeMillis, (now): IdTokenClaims => ({
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    exp: Math.floor(now / 1_000) + 600,
    email_verified: true,
    name: "Google User",
    picture: "https://example.com/avatar.png",
    hd: "example.com",
    ...profile,
  }));

const OperationsLive = Layer.mergeAll(Login.layer, GoogleIdentity.layer, Organizations.layer).pipe(
  Layer.provideMerge(Sessions.layer),
);

class TestLimits extends Context.Service<TestLimits, AuthLimits>()(
  "@store/auth-worker/TestLimits",
) {}

export class AuthTest extends Context.Service<
  AuthTest,
  {
    readonly d1: ReturnType<typeof authD1>;
    readonly revocations: Effect.Effect<ReadonlyArray<HubRevocationCall>>;
    readonly setGoogleIdToken: (token: string) => Effect.Effect<void>;
    readonly setLimiterAvailable: (available: boolean) => Effect.Effect<void>;
  }
>()("@store/auth-worker/AuthTest") {}

const doubles = Layer.effectContext(
  Effect.gen(function* () {
    const revocations = yield* Ref.make<ReadonlyArray<HubRevocationCall>>([]);
    const googleIdToken = yield* Ref.make("");
    const limiterAvailable = yield* Ref.make(true);
    const countingLimit = (limit: number): AuthRateLimit => {
      const counts = new Map<string, number>();
      return (key) =>
        Effect.gen(function* () {
          if (!(yield* Ref.get(limiterAvailable))) {
            return yield* new RateLimitError({ message: "limiter unavailable", cause: "binding" });
          }
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          return { success: next <= limit };
        });
    };
    const control = AuthTest.of({
      d1: authD1(),
      revocations: Ref.get(revocations),
      setGoogleIdToken: (token) => Ref.set(googleIdToken, token),
      setLimiterAvailable: (available) => Ref.set(limiterAvailable, available),
    });
    const hub = HubRevocation.of({
      revoke: (organizationId, userId) =>
        Ref.update(revocations, (calls) => [...calls, { organizationId, userId }]),
    });
    const http = HttpClient.make((request) =>
      Effect.gen(function* () {
        const idToken = yield* Ref.get(googleIdToken);
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            request.url === "https://oauth2.googleapis.com/token"
              ? { id_token: idToken }
              : { keys: [googleSigner.publicJwk] },
          ),
        );
      }),
    );
    return Context.empty().pipe(
      Context.add(AuthTest, control),
      Context.add(HubRevocation, hub),
      Context.add(HttpClient.HttpClient, http),
      Context.add(
        TestLimits,
        TestLimits.of({
          tenPerMinute: countingLimit(10),
          fivePerMinute: countingLimit(5),
          sixtyPerMinute: countingLimit(60),
        }),
      ),
    );
  }),
);

export const databaseLayer = Layer.unwrap(AuthTest.useSync(({ d1 }) => AuthD1.layer(d1)));

export const ephemeralIsolate = Layer.fresh(EphemeralStore.layer(EPHEMERAL_PEPPER)).pipe(
  Layer.provide([databaseLayer, AuthCrypto.layer]),
);

export class AuthApi extends Context.Service<AuthApi>()("@store/auth-worker/AuthApi", {
  make: Effect.gen(function* () {
    const login = yield* Login;
    const google = yield* GoogleIdentity;
    const sessions = yield* Sessions;
    const organizations = yield* Organizations;
    return {
      identify: (...args: Parameters<typeof login.identify>) =>
        unavailableOnInfrastructureFailure(login.identify(...args)),
      authenticate: (...args: Parameters<typeof login.authenticate>) =>
        unavailableOnInfrastructureFailure(login.authenticate(...args)),
      beginGoogle: (...args: Parameters<typeof google.beginGoogle>) =>
        unavailableOnInfrastructureFailure(google.beginGoogle(...args)),
      completeGoogle: (input: { readonly code: string; readonly state: string }) =>
        unavailableOnInfrastructureFailure(
          google.completeGoogle({ code: input.code, state: OAuthState.make(input.state) }),
        ),
      exchangeGoogle: (...args: Parameters<typeof google.exchangeGoogle>) =>
        unavailableOnInfrastructureFailure(google.exchangeGoogle(...args)),
      refresh: (...args: Parameters<typeof sessions.refresh>) =>
        unavailableOnInfrastructureFailure(sessions.refresh(...args)),
      signOut: (...args: Parameters<typeof sessions.signOut>) =>
        unavailableOnInfrastructureFailure(sessions.signOut(...args)),
      roster: (accessToken: string) =>
        unavailableOnInfrastructureFailure(organizations.roster(Redacted.make(accessToken))),
      organize: (input: { readonly accessToken: string; readonly command: OrganizationCommand }) =>
        unavailableOnInfrastructureFailure(
          organizations.organize({
            command: input.command,
            accessToken: Redacted.make(input.accessToken),
          }),
        ),
    };
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

export const authLayer = (options: { readonly deliversOtp?: boolean } = {}) => {
  const deliversOtp = options.deliversOtp ?? false;
  const dependencies = Layer.mergeAll(
    AuthRepository.layer,
    EphemeralStore.layer(EPHEMERAL_PEPPER),
    PasswordHasher.layer,
    AccessTokenService.layer({
      keys: [{ kid: "test-key", jwk: publicJwk }],
      activeKeyId: "test-key",
      privateJwk: Redacted.make(privateJwk),
    }).pipe(Layer.provide(WebCrypto.layer)),
    deliversOtp ? EmailProvider.layerDevelopment : EmailProvider.layerDisabled,
    GoogleOAuth.layer({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: Redacted.make("google-client-secret"),
      callbackUrl: "https://auth.example.com/v1/oauth/google/callback",
    }),
    Layer.unwrap(TestLimits.useSync(AuthLimiter.layer)),
    Layer.succeed(AuthSettings, {
      developmentOtp: deliversOtp,
    }),
  ).pipe(Layer.provide(databaseLayer), Layer.provideMerge(AuthCrypto.layer));

  return AuthApi.layer.pipe(
    Layer.provideMerge(OperationsLive),
    Layer.provideMerge(dependencies),
    Layer.provideMerge(doubles),
    Layer.provideMerge(
      Layer.succeed(RuntimeContext, Context.get(testRuntimeContext, RuntimeContext)),
    ),
    Layer.provideMerge(Logger.layer([])),
  );
};

export const scenario =
  (options?: { readonly deliversOtp?: boolean }) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.provide(self, authLayer(options));

export const refusal = <A, R>(use: Effect.Effect<A, AuthFailure, R>) =>
  Effect.map(Effect.flip(use), authFailureWire);

export const count = (query: string, ...params: Array<string | number>) =>
  AuthTest.useSync(({ d1 }) => Number(d1.database.prepare(query).get(...params)?.total ?? -1));

export const signUp = (email: string, client: AuthClientKind = native) =>
  AuthApi.use((auth) =>
    auth.authenticate({
      _tag: "RegisterPassword",
      email: EmailAddress.make(email),
      name: email.split("@")[0] ?? "Owner",
      password: PASSWORD,
      client,
    }),
  );

export const refreshWith = (refreshToken: RefreshToken) =>
  AuthApi.use((auth) =>
    Effect.result(auth.refresh(Redacted.make(refreshToken)).pipe(Effect.mapError(authFailureWire))),
  );
