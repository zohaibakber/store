import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
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
};

const ISSUED_AT = 1_800_000_000_000;

const onTestClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(
    TestClock.setTime(ISSUED_AT).pipe(Effect.andThen(effect), Effect.provide(TestClock.layer())),
  );

describe("ES256 access tokens", () => {
  it("round-trips offline workspace claims", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(issueAccessToken({ ...input, now: ISSUED_AT }, config));
    const claims = await Effect.runPromise(
      verifyAccessToken(issued.token, config, ISSUED_AT + 1_000),
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
      expiresAt: ISSUED_AT + 300_000,
    });
  });

  it("issues one-hour access tokens by default", async () => {
    const { accessTokenTtlSeconds: _ttl, ...config } = await configuration();
    const issued = await onTestClock(issueAccessToken(input, config));

    expect(issued.expiresAt).toBe(ISSUED_AT + 3_600_000);
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
    const [claims, failure] = await onTestClock(
      Effect.gen(function* () {
        const issued = yield* issueAccessToken(input, config);
        yield* TestClock.adjust("299999 millis");
        const claims = yield* verifyAccessToken(issued.token, config);
        yield* TestClock.adjust("1 millis");
        const failure = yield* Effect.flip(verifyAccessToken(issued.token, config));
        return [claims, failure] as const;
      }),
    );

    expect(claims.expiresAt).toBe(ISSUED_AT + 300_000);
    expect(failure.reason).toBe("Expired");
  });

  it("verifies many tokens with one imported key and still rejects a foreign signature", async () => {
    const config = await configuration();
    const foreign = await configuration();
    const [claims, rejected] = await onTestClock(
      Effect.gen(function* () {
        const verify = yield* makeAccessTokenVerifier(config);
        const first = yield* issueAccessToken(input, config);
        const second = yield* issueAccessToken(
          { ...input, sessionId: SessionId.make("session-2") },
          config,
        );
        const forged = yield* issueAccessToken(input, foreign);
        yield* TestClock.adjust("1 second");
        const claims = yield* Effect.all([verify(first.token), verify(second.token)]);
        const rejected = yield* Effect.flip(verify(forged.token));
        return [claims, rejected] as const;
      }),
    );

    expect(claims.map((claim) => claim.sessionId)).toEqual(["session-1", "session-2"]);
    expect(rejected.reason).toBe("InvalidSignature");
  });

  it("reports an unusable verification key on each call instead of failing construction", async () => {
    const config = await configuration();
    const failure = await onTestClock(
      Effect.gen(function* () {
        const issued = yield* issueAccessToken(input, config);
        const verify = yield* makeAccessTokenVerifier({
          ...config,
          publicJwk: { kty: "EC", crv: "P-256", x: "AA", y: "AA" },
        });
        return yield* Effect.flip(verify(issued.token));
      }),
    );
    expect(failure.reason).toBe("NoKey");
  });
});
