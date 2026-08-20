import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
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

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
};

const base64UrlDecode = (value: string) => {
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const JsonWebKeySchema = Schema.Struct({
  kty: Schema.String,
  crv: Schema.optionalKey(Schema.String),
  x: Schema.optionalKey(Schema.String),
  y: Schema.optionalKey(Schema.String),
  d: Schema.optionalKey(Schema.String),
  use: Schema.optionalKey(Schema.String),
  key_ops: Schema.optionalKey(Schema.Array(Schema.String)),
  alg: Schema.optionalKey(Schema.String),
  kid: Schema.optionalKey(Schema.String),
});

export interface JwtConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly publicJwk: JsonWebKey;
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
  org_slug: Schema.NullOr(Schema.String),
  role: OrganizationRole,
  email: EmailAddress,
  name: Schema.String,
  picture: Schema.NullOr(Schema.String),
  iat: Schema.Number,
  exp: Schema.Number,
  jti: Schema.String,
});

const JwtHeader = Schema.Struct({
  alg: Schema.Literal("ES256"),
  typ: Schema.Literal("JWT"),
});

export class JwtError extends Schema.TaggedErrorClass<JwtError>()("Auth.JwtError", {
  reason: Schema.Literals(["Malformed", "InvalidSignature", "Expired", "InvalidClaims", "NoKey"]),
  message: Schema.String,
}) {}

const decodeJson = <A, I, R>(schema: Schema.Schema<A, I, R>, bytes: Uint8Array) =>
  Effect.try({
    try: () => JSON.parse(textDecoder.decode(bytes)),
    catch: () => new JwtError({ reason: "Malformed", message: "The access token is malformed." }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      (cause) =>
        new JwtError({
          reason: "InvalidClaims",
          message: `The access token claims are invalid: ${String(cause)}`,
        }),
    ),
  );

const importSigningKey = (jwk: JsonWebKey) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      ),
    catch: (cause) =>
      new JwtError({
        reason: "NoKey",
        message: `The JWT signing key could not be imported: ${String(cause)}`,
      }),
  });

const importVerificationKey = (jwk: JsonWebKey) =>
  Effect.tryPromise({
    try: () =>
      crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
    catch: (cause) =>
      new JwtError({
        reason: "NoKey",
        message: `The JWT verification key could not be imported: ${String(cause)}`,
      }),
  });

export interface IssueAccessTokenInput {
  readonly subject: UserId;
  readonly sessionId: SessionId;
  readonly activeOrganizationId: OrganizationId;
  readonly organizationName: string;
  readonly organizationSlug: string | null;
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
) {
  if (!configuration.privateJwk) {
    return yield* new JwtError({
      reason: "NoKey",
      message: "The JWT signing key is not configured.",
    });
  }
  const now = Math.floor((input.now ?? Date.now()) / 1_000);
  const expiresAt = now + (configuration.accessTokenTtlSeconds ?? 600);
  const payload = {
    iss: configuration.issuer,
    aud: configuration.audience,
    sub: input.subject,
    sid: input.sessionId,
    org: input.activeOrganizationId,
    org_name: input.organizationName,
    org_slug: input.organizationSlug,
    role: input.role,
    email: input.email,
    name: input.name,
    picture: input.image,
    iat: now,
    exp: expiresAt,
    jti: crypto.randomUUID(),
  } satisfies typeof JwtPayload.Type;
  const header = { alg: "ES256", typ: "JWT" } satisfies typeof JwtHeader.Type;
  const encodedHeader = base64UrlEncode(textEncoder.encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = yield* importSigningKey(configuration.privateJwk);
  const signature = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        textEncoder.encode(signingInput),
      ),
    catch: (cause) =>
      new JwtError({
        reason: "NoKey",
        message: `The access token could not be signed: ${String(cause)}`,
      }),
  });
  return {
    token: AccessToken.make(`${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`),
    expiresAt: expiresAt * 1_000,
  } satisfies IssuedAccessToken;
});

export const verifyAccessToken = Effect.fn("AccessToken.verify")(function* (
  token: string,
  configuration: JwtConfiguration,
  now = Date.now(),
) {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments[0] || !segments[1] || !segments[2]) {
    return yield* new JwtError({
      reason: "Malformed",
      message: "The access token is malformed.",
    });
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = yield* decodeJson(JwtHeader, base64UrlDecode(encodedHeader));
  if (header.alg !== "ES256") {
    return yield* new JwtError({
      reason: "Malformed",
      message: "The access token algorithm is not accepted.",
    });
  }
  const key = yield* importVerificationKey(configuration.publicJwk);
  const valid = yield* Effect.tryPromise({
    try: () =>
      crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        base64UrlDecode(encodedSignature),
        textEncoder.encode(`${encodedHeader}.${encodedPayload}`),
      ),
    catch: () =>
      new JwtError({
        reason: "InvalidSignature",
        message: "The access token signature is invalid.",
      }),
  });
  if (!valid) {
    return yield* new JwtError({
      reason: "InvalidSignature",
      message: "The access token signature is invalid.",
    });
  }
  const payload = yield* decodeJson(JwtPayload, base64UrlDecode(encodedPayload));
  if (payload.iss !== configuration.issuer || payload.aud !== configuration.audience) {
    return yield* new JwtError({
      reason: "InvalidClaims",
      message: "The access token issuer or audience is invalid.",
    });
  }
  if (payload.exp * 1_000 <= now) {
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
    organizationSlug: payload.org_slug,
    role: payload.role,
    email: payload.email,
    name: payload.name,
    image: payload.picture,
    expiresAt: payload.exp * 1_000,
  });
});

export interface AccessTokenServiceApi {
  readonly issue: (
    input: IssueAccessTokenInput,
  ) => Effect.Effect<IssuedAccessToken, JwtError>;
  readonly verify: (token: string, now?: number) => Effect.Effect<AccessClaimsType, JwtError>;
}

export class AccessTokenService extends Context.Service<
  AccessTokenService,
  AccessTokenServiceApi
>()("@store/auth/AccessToken") {}

export const accessTokenLayer = (configuration: JwtConfiguration) =>
  Layer.succeed(
    AccessTokenService,
    AccessTokenService.of({
      issue: (input) => issueAccessToken(input, configuration),
      verify: (token, now) => verifyAccessToken(token, configuration, now),
    }),
  );

export const decodeJsonWebKey = Schema.decodeUnknownEffect(JsonWebKeySchema);
