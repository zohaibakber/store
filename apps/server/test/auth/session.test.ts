import {
  EmailAddress,
  issueAccessToken,
  OrganizationId,
  SessionId,
  UserId,
  type JwtConfiguration,
} from "@store/auth";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { authenticateHeaders } from "../../src/auth/session";

const configuration = async (): Promise<JwtConfiguration> => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    issuer: "https://auth.example.com",
    audience: "tabaaq-api",
    privateJwk: await crypto.subtle.exportKey("jwk", keyPair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", keyPair.publicKey),
    accessTokenTtlSeconds: 300,
  };
};

describe("authenticateHeaders", () => {
  it("builds the API session from first-party access claims", async () => {
    const config = await configuration();
    const issued = await Effect.runPromise(
      issueAccessToken(
        {
          subject: UserId.make("user-1"),
          sessionId: SessionId.make("session-1"),
          activeOrganizationId: OrganizationId.make("organization-1"),
          organizationName: "My Store",
          organizationSlug: "my-store",
          role: "owner",
          email: EmailAddress.make("owner@example.com"),
          name: "Owner",
          image: null,
        },
        config,
      ),
    );

    const session = await Effect.runPromise(
      authenticateHeaders(
        new Headers({ authorization: `Bearer ${issued.token}` }),
        config,
      ),
    );

    expect(session).toMatchObject({
      user: { id: "user-1", email: "owner@example.com" },
      session: { id: "session-1", activeOrganizationId: "organization-1" },
      organizations: [{ id: "organization-1", name: "My Store", role: "owner" }],
    });
  });

  it("treats a missing access token as an anonymous request", async () => {
    const config = await configuration();
    await expect(Effect.runPromise(authenticateHeaders(new Headers(), config))).resolves.toBeNull();
  });
});
