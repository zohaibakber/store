import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  EmailAddress,
  issueAccessToken,
  OrganizationId,
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

  it("rejects a token after its access lifetime", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(issueAccessToken(input, config));
    const failure = await Effect.runPromise(
      Effect.flip(verifyAccessToken(issued.token, config, input.now + 300_000)),
    );

    expect(failure.reason).toBe("Expired");
  });
});
