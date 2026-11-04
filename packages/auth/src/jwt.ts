import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Jwk from "effect/jose/Jwk";
import * as Jwks from "effect/jose/Jwks";
import * as Jwt from "effect/jose/Jwt";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
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

const ACCESS_TOKEN_TTL_SECONDS = 3_600;

export type JwtKeyRing = ReadonlyArray<Jwk.PublicKey>;

const ISSUER = "tabaaq-auth";
const AUDIENCE = "tabaaq-api";

export interface JwtConfiguration {
  readonly keys: JwtKeyRing;
  readonly signer?: Jwk.PrivateKey | undefined;
  readonly accessTokenTtlSeconds?: number;
}

const JwtPayload = Schema.Struct({
  iss: Schema.String,
  aud: Schema.String,
  sub: UserId,
  sid: SessionId,
  org: OrganizationId,
  org_name: Schema.String,
  role: OrganizationRole,
  email: EmailAddress,
  name: Schema.String,
  picture: Schema.NullOr(Schema.String),
  iat: Schema.Number,
  exp: Schema.Number,
  jti: Schema.String,
});

export class JwtError extends Schema.TaggedError<JwtError>()("JwtError", {
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

const jwtError = (error: Jwt.JwtError) => {
  if (error._tag === "SchemaError") {
    return new JwtError({
      reason: "InvalidClaims",
      message: `The access token claims are invalid: ${error.message}`,
      cause: error,
    });
  }
  const { reason } = error;
  const known = (jwtReason: JwtError["reason"], message: string) =>
    new JwtError({ reason: jwtReason, message, cause: error });
  switch (reason._tag) {
    case "InvalidToken":
      return known("Malformed", "The access token is malformed.");
    case "SignatureVerificationFailed":
    case "AlgorithmNotAllowed":
      return known("InvalidSignature", "The access token signature is invalid.");
    case "KeyNotFound":
    case "AmbiguousKey":
      return known("UnknownKey", "The access token key id is not in the key ring.");
    case "ClaimValidationFailed":
      return reason.claim === "exp" && reason.reason === "expired"
        ? known("Expired", "The access token has expired.")
        : known("InvalidClaims", "The access token issuer or audience is invalid.");
    case "InvalidKey":
    case "InvalidArgument":
    case "DecryptionFailed":
    case "KeySetUnavailable":
      return known("NoKey", "The access token could not be processed.");
  }
  return reason satisfies never;
};

export interface IssueAccessTokenInput {
  readonly subject: UserId;
  readonly sessionId: SessionId;
  readonly activeOrganizationId: OrganizationId;
  readonly organizationName: string;
  readonly role: typeof OrganizationRole.Type;
  readonly email: EmailAddress;
  readonly name: string;
  readonly image: string | null;
}

export interface IssuedAccessToken {
  readonly token: AccessTokenType;
  readonly expiresAt: number;
}

export const issueAccessToken = Effect.fn("AccessToken.issue")(function* (
  input: IssueAccessTokenInput,
  configuration: JwtConfiguration,
) {
  const { signer } = configuration;
  if (signer === undefined) {
    return yield* new JwtError({
      reason: "NoKey",
      message: "The JWT signing key is not configured.",
    });
  }
  const random = yield* SecureRandom.SecureRandom;
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
  const expiresAt = now + (configuration.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS);
  const token = yield* Jwt.sign(
    JwtPayload,
    {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: input.subject,
      sid: input.sessionId,
      org: input.activeOrganizationId,
      org_name: input.organizationName,
      role: input.role,
      email: input.email,
      name: input.name,
      picture: input.image,
      iat: now,
      exp: expiresAt,
      jti: yield* random.uuidV4(),
    },
    signer,
    { typ: "JWT" },
  ).pipe(Effect.mapError(jwtError));
  return {
    token: AccessToken.make(Redacted.value(token)),
    expiresAt: expiresAt * 1_000,
  } satisfies IssuedAccessToken;
});

export type AccessTokenVerifier = (token: string) => Effect.Effect<AccessClaimsType, JwtError>;

export const makeAccessTokenVerifier = Effect.fn("AccessToken.makeVerifier")(function* (
  configuration: Pick<JwtConfiguration, "keys">,
) {
  const jwks = yield* Jwks.makeLocal({ keys: configuration.keys.map((key) => key.jwk) });
  const services = Context.make(Jwks.Jwks, jwks).pipe(
    Context.add(Signature.Signature, yield* Signature.Signature),
  );
  const verify: AccessTokenVerifier = (token) =>
    Jwt.verifyWithKeySet(JwtPayload, token, {
      algorithms: ["ES256"],
      issuer: ISSUER,
      audience: AUDIENCE,
      typ: "JWT",
      requiredClaims: ["exp"],
    }).pipe(
      Effect.provideContext(services),
      Effect.mapError(jwtError),
      Effect.map(({ claims }) =>
        AccessClaims.make({
          subject: claims.sub,
          sessionId: claims.sid,
          activeOrganizationId: claims.org,
          organizationName: claims.org_name,
          role: claims.role,
          email: claims.email,
          name: claims.name,
          image: claims.picture,
          expiresAt: claims.exp * 1_000,
        }),
      ),
    );
  return verify;
});

export class AccessTokenService extends Context.Service<
  AccessTokenService,
  {
    readonly issue: (input: IssueAccessTokenInput) => Effect.Effect<IssuedAccessToken, JwtError>;
    readonly verify: AccessTokenVerifier;
  }
>()("@store/auth/AccessTokenService") {
  static readonly layer = (configuration: JwtConfiguration) =>
    Layer.effect(
      AccessTokenService,
      Effect.gen(function* () {
        const services = yield* Effect.context<SecureRandom.SecureRandom | Signature.Signature>();
        return AccessTokenService.of({
          issue: (input) =>
            issueAccessToken(input, configuration).pipe(Effect.provideContext(services)),
          verify: yield* makeAccessTokenVerifier(configuration),
        });
      }),
    );
}

const noKey = (message: string) => (cause: unknown) =>
  new JwtError({ reason: "NoKey", message, cause });

export const decodePublicKeyPem = Effect.fn("AccessToken.decodePublicKeyPem")(
  function* (pem: string) {
    const kid = yield* Jwk.thumbprint(yield* Jwk.importSpki(pem, "ES256"));
    return [yield* Jwk.importSpki(pem, "ES256", { kid })] satisfies JwtKeyRing;
  },
  Effect.mapError(noKey("The JWT public key is not a P-256 SPKI PEM.")),
);

export const decodeSigningKeyPem = Effect.fn("AccessToken.decodeSigningKeyPem")(
  function* (pem: Redacted.Redacted<string>) {
    const kid = yield* Jwk.thumbprint(yield* Jwk.importPkcs8(pem, "ES256"));
    return yield* Jwk.importPkcs8(pem, "ES256", { kid });
  },
  Effect.mapError(noKey("The JWT signing key is not a P-256 PKCS #8 PEM.")),
);

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
    keys: keys.flatMap(({ kid, jwk }) =>
      kid !== undefined && jwk.kty === "EC"
        ? [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, alg: "ES256", use: "sig", kid }]
        : [],
    ),
  });
