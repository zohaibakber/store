import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  AccessClaims,
  AccessToken,
  EmailAddress,
  OrganizationId,
  OrganizationRole,
  SessionId,
  UserId,
  type AccessClaims as AccessClaimsType,
  type AccessToken as AccessTokenType,
} from "./model";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const AUTH_JWT_KEY_ID = "tabaaq-auth-v1";
const ACCESS_TOKEN_TTL_SECONDS = 3_600;

const JsonWebKeySchema = Schema.Struct({
  kty: Schema.String,
  crv: Schema.optionalKey(Schema.String),
  x: Schema.optionalKey(Schema.String),
  y: Schema.optionalKey(Schema.String),
  d: Schema.optionalKey(Schema.String),
  use: Schema.optionalKey(Schema.String),
  alg: Schema.optionalKey(Schema.String),
  kid: Schema.optionalKey(Schema.String),
});

const JsonWebKeySetSchema = Schema.Struct({
  keys: Schema.NonEmptyArray(
    Schema.Struct({ ...JsonWebKeySchema.fields, kid: Schema.String.check(Schema.isMinLength(1)) }),
  ).check(
    Schema.makeFilter((keys) => new Set(keys.map((key) => key.kid)).size === keys.length, {
      title: "Key ring with distinct key ids",
    }),
  ),
});

export interface JwtKey {
  readonly kid: string;
  readonly jwk: JsonWebKey;
}

export type JwtKeyRing = ReadonlyArray<JwtKey>;

export interface JwtConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly keys: JwtKeyRing;
  readonly activeKeyId?: string | undefined;
  readonly privateJwk?: JsonWebKey;
  readonly accessTokenTtlSeconds?: number;
}

const JwtPayload = Schema.Struct({
  iss: Schema.String,
  aud: Schema.String,
  sub: UserId,
  sid: SessionId,
  org: OrganizationId,
  org_name: Schema.String,
  org_slug: Schema.optionalKey(Schema.NullOr(Schema.String)),
  role: OrganizationRole,
  email: EmailAddress,
  name: Schema.String,
  picture: Schema.NullOr(Schema.String),
  iat: Schema.Number,
  exp: Schema.Number,
  jti: Schema.String,
});

const LEGACY_ORG_SLUG_CLAIM = { org_slug: null } as const;

const JwtHeader = Schema.Struct({
  alg: Schema.Literal("ES256"),
  typ: Schema.Literal("JWT"),
  kid: Schema.String,
});

export class JwtError extends Schema.TaggedError<JwtError>()("Auth.JwtError", {
  reason: Schema.Literals([
    "Malformed",
    "InvalidSignature",
    "Expired",
    "InvalidClaims",
    "NoKey",
    "UnknownKey",
  ]),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const decodeBase64Url = (value: string) =>
  Effect.fromResult(Encoding.decodeBase64Url(value)).pipe(
    Effect.mapError(
      (cause) =>
        new JwtError({
          reason: "Malformed",
          message: "The access token is malformed.",
          cause,
        }),
    ),
  );

const decodeJson = <A>(schema: Schema.Top & Schema.ConstraintDecoder<A>, bytes: Uint8Array) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(textDecoder.decode(bytes)).pipe(
    Effect.mapError(
      (cause) =>
        new JwtError({
          reason: "InvalidClaims",
          message: `The access token claims are invalid: ${cause.message}`,
          cause,
        }),
    ),
  );

const importSigningKey = (jwk: JsonWebKey) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
    catch: (cause) =>
      new JwtError({
        reason: "NoKey",
        message: `The JWT signing key could not be imported: ${String(cause)}`,
        cause,
      }),
  });

const importVerificationKey = (jwk: JsonWebKey) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
        "verify",
      ]),
    catch: (cause) =>
      new JwtError({
        reason: "NoKey",
        message: `The JWT verification key could not be imported: ${String(cause)}`,
        cause,
      }),
  });

type ImportedKeyRing = ReadonlyMap<string, Exit.Exit<CryptoKey, JwtError>>;

const importRingKey = (keys: JwtKeyRing, kid: string): Effect.Effect<CryptoKey, JwtError> => {
  const key = keys.find((candidate) => candidate.kid === kid);
  return key === undefined
    ? Effect.fail(
        new JwtError({
          reason: "UnknownKey",
          message: "The access token key id is not in the key ring.",
        }),
      )
    : importVerificationKey(key.jwk);
};

const importKeyRing = (keys: JwtKeyRing): Effect.Effect<ImportedKeyRing> =>
  Effect.forEach(new Set(keys.map((key) => key.kid)), (kid) =>
    Effect.map(Effect.exit(importRingKey(keys, kid)), (imported) => [kid, imported] as const),
  ).pipe(Effect.map((entries) => new Map(entries)));

interface AccessTokenSigner {
  readonly kid: string;
  readonly key: CryptoKey;
}

const importSigner = (
  configuration: JwtConfiguration,
): Effect.Effect<AccessTokenSigner, JwtError> =>
  Effect.gen(function* () {
    const { activeKeyId, privateJwk } = configuration;
    if (!privateJwk || activeKeyId === undefined) {
      return yield* new JwtError({
        reason: "NoKey",
        message: "The JWT signing key is not configured.",
      });
    }
    if (!configuration.keys.some((key) => key.kid === activeKeyId)) {
      return yield* new JwtError({
        reason: "NoKey",
        message: "The active JWT key id is not in the key ring.",
      });
    }
    return { kid: activeKeyId, key: yield* importSigningKey(privateJwk) };
  });

export interface IssueAccessTokenInput {
  readonly subject: UserId;
  readonly sessionId: SessionId;
  readonly activeOrganizationId: OrganizationId;
  readonly organizationName: string;
  readonly role: typeof OrganizationRole.Type;
  readonly email: EmailAddress;
  readonly name: string;
  readonly image: string | null;
  readonly now?: number;
}

export interface IssuedAccessToken {
  readonly token: AccessTokenType;
  readonly expiresAt: number;
}

export const issueAccessToken = Effect.fn("AccessToken.issue")(function* (
  input: IssueAccessTokenInput,
  configuration: JwtConfiguration,
  importedSigner?: AccessTokenSigner,
) {
  const signer = importedSigner ?? (yield* importSigner(configuration));
  const now = Math.floor((input.now ?? (yield* Clock.currentTimeMillis)) / 1_000);
  const expiresAt = now + (configuration.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS);
  const payload = {
    iss: configuration.issuer,
    aud: configuration.audience,
    sub: input.subject,
    sid: input.sessionId,
    org: input.activeOrganizationId,
    org_name: input.organizationName,
    ...LEGACY_ORG_SLUG_CLAIM,
    role: input.role,
    email: input.email,
    name: input.name,
    picture: input.image,
    iat: now,
    exp: expiresAt,
    jti: crypto.randomUUID(),
  } satisfies typeof JwtPayload.Type;
  const header = {
    alg: "ES256",
    typ: "JWT",
    kid: signer.kid,
  } satisfies typeof JwtHeader.Type;
  const encodedHeader = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(JwtHeader))(
    header,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new JwtError({
          reason: "InvalidClaims",
          message: `The access token header is invalid: ${cause.message}`,
          cause,
        }),
    ),
    Effect.map(Encoding.encodeBase64Url),
  );
  const encodedPayload = yield* Schema.encodeUnknownEffect(Schema.fromJsonString(JwtPayload))(
    payload,
  ).pipe(
    Effect.mapError(
      (cause) =>
        new JwtError({
          reason: "InvalidClaims",
          message: `The access token claims are invalid: ${cause.message}`,
          cause,
        }),
    ),
    Effect.map(Encoding.encodeBase64Url),
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        signer.key,
        textEncoder.encode(signingInput),
      ),
    catch: (cause) =>
      new JwtError({
        reason: "NoKey",
        message: `The access token could not be signed: ${String(cause)}`,
        cause,
      }),
  });
  return {
    token: AccessToken.make(
      `${signingInput}.${Encoding.encodeBase64Url(new Uint8Array(signature))}`,
    ),
    expiresAt: expiresAt * 1_000,
  } satisfies IssuedAccessToken;
});

export const verifyAccessToken = Effect.fn("AccessToken.verify")(function* (
  token: string,
  configuration: JwtConfiguration,
  now?: number,
  importedKeys?: ImportedKeyRing,
) {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    return yield* new JwtError({
      reason: "Malformed",
      message: "The access token is malformed.",
    });
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = yield* decodeJson(JwtHeader, yield* decodeBase64Url(encodedHeader));
  if (header.alg !== "ES256") {
    return yield* new JwtError({
      reason: "Malformed",
      message: "The access token algorithm is not accepted.",
    });
  }
  const key = yield* importedKeys?.get(header.kid) ?? importRingKey(configuration.keys, header.kid);
  const signature = new Uint8Array(yield* decodeBase64Url(encodedSignature));
  const valid = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        signature,
        textEncoder.encode(`${encodedHeader}.${encodedPayload}`),
      ),
    catch: (cause) =>
      new JwtError({
        reason: "InvalidSignature",
        message: "The access token signature is invalid.",
        cause,
      }),
  });
  if (!valid) {
    return yield* new JwtError({
      reason: "InvalidSignature",
      message: "The access token signature is invalid.",
    });
  }
  const payload = yield* decodeJson(JwtPayload, yield* decodeBase64Url(encodedPayload));
  if (payload.iss !== configuration.issuer || payload.aud !== configuration.audience) {
    return yield* new JwtError({
      reason: "InvalidClaims",
      message: "The access token issuer or audience is invalid.",
    });
  }
  if (payload.exp * 1_000 <= (now ?? (yield* Clock.currentTimeMillis))) {
    return yield* new JwtError({
      reason: "Expired",
      message: "The access token has expired.",
    });
  }
  return AccessClaims.make({
    subject: payload.sub,
    sessionId: payload.sid,
    activeOrganizationId: payload.org,
    organizationName: payload.org_name,
    role: payload.role,
    email: payload.email,
    name: payload.name,
    image: payload.picture,
    expiresAt: payload.exp * 1_000,
  });
});

export type AccessTokenVerifier = (
  token: string,
  now?: number,
) => Effect.Effect<AccessClaimsType, JwtError>;

export const makeAccessTokenVerifier = (
  configuration: JwtConfiguration,
): Effect.Effect<AccessTokenVerifier> =>
  Effect.map(
    importKeyRing(configuration.keys),
    (keys) => (token, now) => verifyAccessToken(token, configuration, now, keys),
  );

export interface AccessTokenServiceApi {
  readonly issue: (input: IssueAccessTokenInput) => Effect.Effect<IssuedAccessToken, JwtError>;
  readonly verify: (token: string, now?: number) => Effect.Effect<AccessClaimsType, JwtError>;
}

export class AccessTokenService extends Context.Service<
  AccessTokenService,
  AccessTokenServiceApi
>()("@store/auth/AccessToken") {}

export const accessTokenLayer = (configuration: JwtConfiguration) =>
  Layer.effect(
    AccessTokenService,
    Effect.gen(function* () {
      const verificationKeys = yield* importKeyRing(configuration.keys);
      yield* Effect.all(verificationKeys.values(), { discard: true });
      const signer = configuration.privateJwk ? yield* importSigner(configuration) : undefined;
      return AccessTokenService.of({
        issue: (input) => issueAccessToken(input, configuration, signer),
        verify: (token, now) => verifyAccessToken(token, configuration, now, verificationKeys),
      });
    }),
  );

export const decodeJsonWebKeyText = Schema.decodeUnknownEffect(
  Schema.fromJsonString(JsonWebKeySchema),
);

export const decodeJwtKeyRingText = (text: string) =>
  Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Union([JsonWebKeySetSchema, JsonWebKeySchema])),
  )(text).pipe(
    Effect.map((source): JwtKeyRing =>
      "keys" in source
        ? source.keys.map((jwk) => ({ kid: jwk.kid, jwk }))
        : [{ kid: AUTH_JWT_KEY_ID, jwk: source }],
    ),
  );

export const activeJwtKeyId = (keys: JwtKeyRing, privateJwk: JsonWebKey): string | undefined => {
  const [first, ...rest] = keys;
  if (rest.length === 0) return first?.kid;
  const { x, y } = privateJwk;
  return x === undefined || y === undefined
    ? undefined
    : keys.find(({ jwk }) => jwk.x === x && jwk.y === y)?.kid;
};

export const AuthJwks = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.String,
      crv: Schema.optionalKey(Schema.String),
      x: Schema.optionalKey(Schema.String),
      y: Schema.optionalKey(Schema.String),
      alg: Schema.String,
      use: Schema.String,
      kid: Schema.String,
    }),
  ),
});
export type AuthJwks = typeof AuthJwks.Type;

export const publicJwks = (keys: JwtKeyRing): AuthJwks =>
  AuthJwks.make({
    keys: keys.map(({ kid, jwk }) => ({
      kty: jwk.kty ?? "EC",
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      alg: "ES256",
      use: "sig",
      kid,
    })),
  });
