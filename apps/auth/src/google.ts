import {
  EmailAddress,
  normalizeEmail,
  WebCrypto,
  type EmailAddress as EmailAddressType,
} from "@store/auth";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import { constTrue } from "effect/Function";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

const KEY_SET_DEFAULT_TTL_MS = 60 * 60 * 1_000;
const KEY_SET_MAX_TTL_MS = 24 * 60 * 60 * 1_000;
const KEY_SET_REFETCH_COOLDOWN_MS = 60 * 1_000;
const GOOGLE_REQUEST_TIMEOUT = Duration.seconds(10);

const textEncoder = new TextEncoder();

const GoogleTokenResponse = Schema.Struct({
  id_token: Schema.String,
});

const GoogleTokenRefusal = Schema.Struct({
  error: Schema.String,
});

const GoogleKeySet = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kid: Schema.optionalKey(Schema.String),
      kty: Schema.String,
      alg: Schema.optionalKey(Schema.String),
      use: Schema.optionalKey(Schema.String),
      n: Schema.optionalKey(Schema.String),
      e: Schema.optionalKey(Schema.String),
    }),
  ),
});

const IdTokenHeader = Schema.Struct({
  alg: Schema.Literal("RS256"),
  kid: Schema.String,
});

const IdTokenClaims = Schema.Struct({
  iss: Schema.String,
  aud: Schema.String,
  sub: Schema.String,
  exp: Schema.Finite,
  email: EmailAddress,
  email_verified: Schema.Union([Schema.Boolean, Schema.Literals(["true", "false"])]),
  name: Schema.optionalKey(Schema.String),
  picture: Schema.optionalKey(Schema.String),
  nonce: Schema.optionalKey(Schema.String),
  hd: Schema.optionalKey(Schema.String),
});

const GOOGLE_MAILBOX = /@(gmail|googlemail)\.com$/u;

const isTrue = (value: boolean | "true" | "false") => value === true || value === "true";

interface SigningKey {
  readonly n: string;
  readonly e: string;
}

interface KeySet {
  readonly keys: ReadonlyMap<string, SigningKey>;
  readonly fetchedAt: number;
  readonly expiresAt: number;
}

interface IdTokenExpectation {
  readonly audiences: ReadonlySet<string>;
  readonly nonce: string | undefined;
}

export interface GoogleProfile {
  readonly providerAccountId: string;
  readonly email: EmailAddressType;
  readonly ownsMailbox: boolean;
  readonly name: string;
  readonly image: string | null;
}

export class GoogleOAuthError extends Schema.TaggedError<GoogleOAuthError>()(
  "Auth.GoogleOAuthError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

export class GoogleIdentityRejected extends Schema.TaggedError<GoogleIdentityRejected>()(
  "Auth.GoogleIdentityRejected",
  {
    reason: Schema.Literals([
      "Malformed",
      "UnknownKey",
      "Signature",
      "Issuer",
      "Audience",
      "Expired",
      "EmailUnverified",
      "Nonce",
      "Grant",
    ]),
    message: Schema.String,
  },
) {}

interface GoogleOAuthApi {
  readonly authorizationUrl: (input: {
    readonly state: string;
    readonly codeChallenge: string;
    readonly nonce: string;
  }) => URL;
  readonly exchangeCode: (input: {
    readonly code: string;
    readonly codeVerifier: string | undefined;
    readonly nonce: string | undefined;
  }) => Effect.Effect<GoogleProfile, GoogleOAuthError | GoogleIdentityRejected>;
  readonly verifyIdToken: (
    idToken: string,
  ) => Effect.Effect<GoogleProfile, GoogleOAuthError | GoogleIdentityRejected>;
}

export class GoogleOAuth extends Context.Service<GoogleOAuth, GoogleOAuthApi>()(
  "@store/auth-worker/GoogleOAuth",
) {}

interface GoogleOAuthConfiguration {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  readonly callbackUrl: string;
  readonly nativeClientIds?: ReadonlyArray<string>;
}

const oauthError = (operation: string, cause: unknown) =>
  new GoogleOAuthError({ operation, message: String(cause), cause });

const rejected = (reason: GoogleIdentityRejected["reason"], message: string) =>
  new GoogleIdentityRejected({ reason, message });

const malformed = () => rejected("Malformed", "The identity token is malformed.");

const decodeOkJson = <A>(
  operation: string,
  schema: Schema.ConstraintDecoder<A>,
  response: HttpClientResponse.HttpClientResponse,
) =>
  response.status >= 200 && response.status < 300
    ? HttpClientResponse.schemaBodyJson(schema)(response).pipe(
        Effect.mapError((cause) => oauthError(`${operation}.decode`, cause)),
      )
    : Effect.fail(oauthError(operation, `Google request failed (${response.status}).`));

const decodeSegment = <A>(schema: Schema.Top & Schema.ConstraintDecoder<A>, segment: string) =>
  Effect.fromResult(Base64Url.decodeString(segment)).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema))),
    Effect.mapError(malformed),
  );

const keySetTtlMs = (cacheControl: string | undefined) => {
  const seconds = Number(/max-age=(\d+)/.exec(cacheControl ?? "")?.[1]);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1_000, KEY_SET_MAX_TTL_MS)
    : KEY_SET_DEFAULT_TTL_MS;
};

const signingKeys = (keySet: typeof GoogleKeySet.Type): ReadonlyMap<string, SigningKey> =>
  new Map(
    keySet.keys.flatMap((key) =>
      key.kty === "RSA" &&
      key.kid !== undefined &&
      key.n !== undefined &&
      key.e !== undefined &&
      (key.alg === undefined || key.alg === "RS256") &&
      (key.use === undefined || key.use === "sig")
        ? [[key.kid, { n: key.n, e: key.e }] as const]
        : [],
    ),
  );

const verifySignature = (key: SigningKey, signature: Uint8Array, signingInput: string) =>
  WebCrypto.verifyRs256(key, signature, textEncoder.encode(signingInput)).pipe(
    Effect.mapError((failure) => oauthError("verifyIdToken.verify", failure.cause)),
  );

const sameNonce = (presented: string, expected: string) =>
  WebCrypto.constantTimeEqual(textEncoder.encode(presented), textEncoder.encode(expected)).pipe(
    Effect.mapError((failure) => oauthError("verifyIdToken.nonce", failure.cause)),
  );

export const googleOAuthLayer = (configuration: GoogleOAuthConfiguration) =>
  Layer.effect(
    GoogleOAuth,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const keySetCache = yield* Ref.make(Option.none<KeySet>());
      const webAudience = new Set([configuration.clientId]);
      const audiences = new Set(
        [configuration.clientId, ...(configuration.nativeClientIds ?? [])].filter(
          (value) => value.trim().length > 0,
        ),
      );

      const execute = (operation: string, request: HttpClientRequest.HttpClientRequest) =>
        client.execute(request).pipe(
          Effect.provideService(HttpClient.TracerDisabledWhen, constTrue),
          Effect.mapError((cause) => oauthError(operation, cause)),
        );

      const withinDeadline = (operation: string) =>
        Effect.timeoutOrElse({
          duration: GOOGLE_REQUEST_TIMEOUT,
          orElse: () => Effect.fail(oauthError(operation, "Google request timed out.")),
        });

      const fetchKeySet = Effect.fnUntraced(function* (now: number) {
        const response = yield* execute("keys.request", HttpClientRequest.get(GOOGLE_KEYS_URL));
        const keys = signingKeys(yield* decodeOkJson("keys", GoogleKeySet, response));
        const keySet: KeySet = {
          keys,
          fetchedAt: now,
          expiresAt: now + keySetTtlMs(response.headers["cache-control"]),
        };
        yield* Ref.set(keySetCache, Option.some(keySet));
        return keySet;
      }, withinDeadline("keys.request"));

      const exchangeForIdToken = Effect.fnUntraced(function* (
        request: HttpClientRequest.HttpClientRequest,
      ) {
        const response = yield* execute("exchangeCode.request", request);
        if (response.status === 400) {
          const refusal = yield* HttpClientResponse.schemaBodyJson(GoogleTokenRefusal)(
            response,
          ).pipe(Effect.mapError((cause) => oauthError("exchangeCode.refusal", cause)));
          return yield* refusal.error === "invalid_grant"
            ? rejected("Grant", "Google refused the authorization code.")
            : oauthError("exchangeCode.token", `Google refused the request (${refusal.error}).`);
        }
        const tokens = yield* decodeOkJson("exchangeCode.token", GoogleTokenResponse, response);
        return tokens.id_token;
      }, withinDeadline("exchangeCode.request"));

      const currentKeySet = (now: number) =>
        Ref.get(keySetCache).pipe(
          Effect.map(Option.filter((keySet) => keySet.expiresAt > now)),
          Effect.flatMap(
            Option.match({
              onNone: () => fetchKeySet(now),
              onSome: Effect.succeed,
            }),
          ),
        );

      const signingKey = Effect.fnUntraced(function* (kid: string, now: number) {
        const cached = yield* currentKeySet(now);
        const known = cached.keys.get(kid);
        if (known) return known;
        const refreshed =
          now - cached.fetchedAt < KEY_SET_REFETCH_COOLDOWN_MS ? cached : yield* fetchKeySet(now);
        const rotated = refreshed.keys.get(kid);
        if (rotated) return rotated;
        return yield* rejected("UnknownKey", "The identity token was not signed by Google.");
      });

      const verify = Effect.fnUntraced(function* (idToken: string, expected: IdTokenExpectation) {
        const now = yield* Clock.currentTimeMillis;
        const [encodedHeader, encodedClaims, encodedSignature, ...rest] = idToken.split(".");
        if (!encodedHeader || !encodedClaims || !encodedSignature || rest.length > 0) {
          return yield* malformed();
        }
        const header = yield* decodeSegment(IdTokenHeader, encodedHeader);
        const claims = yield* decodeSegment(IdTokenClaims, encodedClaims);
        const signature = yield* Effect.fromResult(Base64Url.decode(encodedSignature)).pipe(
          Effect.mapError(malformed),
        );
        const key = yield* signingKey(header.kid, now);
        if (!(yield* verifySignature(key, signature, `${encodedHeader}.${encodedClaims}`))) {
          return yield* rejected("Signature", "The identity token signature is invalid.");
        }
        if (!GOOGLE_ISSUERS.includes(claims.iss)) {
          return yield* rejected("Issuer", "The identity token is not from Google.");
        }
        if (!expected.audiences.has(claims.aud)) {
          return yield* rejected(
            "Audience",
            "The identity token was issued for another application.",
          );
        }
        if (claims.exp * 1_000 <= now) {
          return yield* rejected("Expired", "The identity token has expired.");
        }
        if (!isTrue(claims.email_verified)) {
          return yield* rejected("EmailUnverified", "Google did not verify this email address.");
        }
        if (
          expected.nonce !== undefined &&
          (claims.nonce === undefined || !(yield* sameNonce(claims.nonce, expected.nonce)))
        ) {
          return yield* rejected("Nonce", "The identity token belongs to another sign-in.");
        }
        const email = EmailAddress.make(normalizeEmail(claims.email));
        return {
          providerAccountId: claims.sub,
          email,
          ownsMailbox: (claims.hd ?? "") !== "" || GOOGLE_MAILBOX.test(email),
          name: claims.name ?? email.split("@")[0] ?? email,
          image: claims.picture ?? null,
        } satisfies GoogleProfile;
      });

      return GoogleOAuth.of({
        authorizationUrl: ({ state, codeChallenge, nonce }) => {
          const url = new URL(GOOGLE_AUTHORIZATION_URL);
          url.search = UrlParams.toString({
            client_id: configuration.clientId,
            redirect_uri: configuration.callbackUrl,
            response_type: "code",
            scope: "openid email profile",
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            prompt: "select_account",
          });
          return url;
        },
        exchangeCode: Effect.fn("GoogleOAuth.exchangeCode")(function* (input) {
          const request = HttpClientRequest.post(GOOGLE_TOKEN_URL).pipe(
            HttpClientRequest.bodyUrlParams({
              client_id: configuration.clientId,
              client_secret: Redacted.value(configuration.clientSecret),
              code: input.code,
              code_verifier: input.codeVerifier,
              grant_type: "authorization_code",
              redirect_uri: configuration.callbackUrl,
            }),
          );
          const idToken = yield* exchangeForIdToken(request);
          return yield* verify(idToken, { audiences: webAudience, nonce: input.nonce });
        }),
        verifyIdToken: Effect.fn("GoogleOAuth.verifyIdToken")(function* (idToken) {
          return yield* verify(idToken, { audiences, nonce: undefined });
        }),
      });
    }),
  );
