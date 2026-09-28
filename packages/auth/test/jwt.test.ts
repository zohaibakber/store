import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_JWT_KEY_ID,
  EmailAddress,
  issueAccessToken,
  makeAccessTokenVerifier,
  OrganizationId,
  publicJwks,
  SessionId,
  UserId,
  verifyAccessToken,
  type JwtConfiguration,
} from "../src/auth";

const configuration = async (): Promise<JwtConfiguration> => {
  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  return {
    issuer: "https://auth.example.com",
    audience: "tabaaq-api",
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
    accessTokenTtlSeconds: 300,
  };
};

const input = {
  subject: UserId.make("user-1"),
  sessionId: SessionId.make("session-1"),
  activeOrganizationId: OrganizationId.make("organization-1"),
  organizationName: "Owner's Store",
  organizationSlug: "owners-store",
  role: "owner" as const,
  email: EmailAddress.make("owner@example.com"),
  name: "Owner",
  image: null,
  now: 1_800_000_000_000,
};

describe("ES256 access tokens", () => {
  it("round-trips offline workspace claims", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(issueAccessToken(input, config));
    const claims = await Effect.runPromise(
      verifyAccessToken(issued.token, config, input.now + 1_000),
    );

    expect(claims).toEqual({
      subject: "user-1",
      sessionId: "session-1",
      activeOrganizationId: "organization-1",
      organizationName: "Owner's Store",
      organizationSlug: "owners-store",
      role: "owner",
      email: "owner@example.com",
      name: "Owner",
      image: null,
      expiresAt: input.now + 300_000,
    });
  });

  it("issues one-hour access tokens by default", async () => {
    const { accessTokenTtlSeconds: _ttl, ...config } = await configuration();
    const issued = await Effect.runPromise(issueAccessToken(input, config));

    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(3_600);
    expect(issued.expiresAt).toBe(input.now + 3_600_000);
  });

  it("publishes the same key id in access tokens and the public JWKS", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(issueAccessToken(input, config));
    const encodedHeader = issued.token.split(".")[0];
    if (!encodedHeader) throw new Error("The access token header is missing.");
    const header = Schema.decodeUnknownSync(Schema.Struct({ kid: Schema.String }))(
      JSON.parse(atob(encodedHeader.replace(/-/gu, "+").replace(/_/gu, "/"))),
    );

    expect(header.kid).toBe(AUTH_JWT_KEY_ID);
    expect(publicJwks(config.publicJwk)).toEqual({
      keys: [expect.objectContaining({ kid: AUTH_JWT_KEY_ID, alg: "ES256", use: "sig" })],
    });
    expect(publicJwks({ ...config.publicJwk, d: "must-not-publish" }).keys[0]).not.toHaveProperty(
      "d",
    );
  });

  it("rejects a token after its access lifetime", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(issueAccessToken(input, config));
    const failure = await Effect.runPromise(
      Effect.flip(verifyAccessToken(issued.token, config, input.now + 300_000)),
    );

    expect(failure.reason).toBe("Expired");
  });

  it("verifies many tokens with one imported key and still rejects a foreign signature", async () => {
    const config = await configuration();
    const foreign = await configuration();
    const verify = await Effect.runPromise(makeAccessTokenVerifier(config));
    const first = await Effect.runPromise(issueAccessToken(input, config));
    const second = await Effect.runPromise(
      issueAccessToken({ ...input, sessionId: SessionId.make("session-2") }, config),
    );
    const forged = await Effect.runPromise(issueAccessToken(input, foreign));

    const claims = await Effect.runPromise(
      Effect.all([verify(first.token, input.now + 1_000), verify(second.token, input.now + 1_000)]),
    );
    const rejected = await Effect.runPromise(Effect.flip(verify(forged.token, input.now + 1_000)));

    expect(claims.map((claim) => claim.sessionId)).toEqual(["session-1", "session-2"]);
    expect(rejected.reason).toBe("InvalidSignature");
  });

  it("reports an unusable verification key on each call instead of failing construction", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(issueAccessToken(input, config));
    const verify = await Effect.runPromise(
      makeAccessTokenVerifier({
        ...config,
        publicJwk: { kty: "EC", crv: "P-256", x: "AA", y: "AA" },
      }),
    );
    const failure = await Effect.runPromise(Effect.flip(verify(issued.token, input.now + 1_000)));
    expect(failure.reason).toBe("NoKey");
  });
});
