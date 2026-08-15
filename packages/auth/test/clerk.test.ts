import { describe, expect, it } from "vitest";

import { clerkClaimsFromPayload } from "../src/clerk";

describe("clerkClaimsFromPayload", () => {
  it("reads Clerk JWT v2 organization claims", () => {
    const claims = clerkClaimsFromPayload({
      sub: "user_123",
      sid: "sess_123",
      v: 2,
      o: { id: "org_123", rol: "admin", slg: "tabaaq" },
    });

    expect(claims.clerkOrganizationId).toBe("org_123");
    expect(claims.organizationRole).toBe("org:admin");
    expect(claims.organizationSlug).toBe("tabaaq");
  });

  it("keeps supporting legacy Clerk JWT v1 organization claims", () => {
    const claims = clerkClaimsFromPayload({
      sub: "user_123",
      org_id: "org_legacy",
      org_role: "org:member",
      org_slug: "legacy",
    });

    expect(claims.clerkOrganizationId).toBe("org_legacy");
    expect(claims.organizationRole).toBe("org:member");
    expect(claims.organizationSlug).toBe("legacy");
  });

  it("prefers v2 organization claims when both versions are present", () => {
    const claims = clerkClaimsFromPayload({
      sub: "user_123",
      o: { id: "org_v2", rol: "member", slg: "current" },
      org_id: "org_v1",
      org_role: "org:admin",
      org_slug: "legacy",
    });

    expect(claims.clerkOrganizationId).toBe("org_v2");
    expect(claims.organizationRole).toBe("org:member");
    expect(claims.organizationSlug).toBe("current");
  });

  it("falls back to legacy claims when the v2 organization claim is malformed", () => {
    const claims = clerkClaimsFromPayload({
      sub: "user_123",
      o: [],
      org_id: "org_legacy",
    });

    expect(claims.clerkOrganizationId).toBe("org_legacy");
  });

  it("rejects a token without a subject", () => {
    expect(() => clerkClaimsFromPayload({ o: { id: "org_123" } })).toThrow(
      "Clerk session token is missing a subject.",
    );
  });
});
