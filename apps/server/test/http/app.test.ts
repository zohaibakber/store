import { describe, expect, it } from "vitest";

import { appFor } from "../lib/app";

describe("HTTP auth and CORS", () => {
  it("serves health without constructing an absolute request URL", async () => {
    const response = await appFor(true).request("/api/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns a workspace snapshot for a Clerk session", async () => {
    const response = await appFor(true).request("/api/auth/session", {
      headers: { authorization: "Bearer test-token" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "authenticated",
      activeOrganization: { id: "org-1", clerkOrganizationId: "org_clerk_1" },
    });
  });

  it("adds CORS headers on API routes for a trusted origin", async () => {
    const response = await appFor(true).request("/api/health", {
      headers: { origin: "http://localhost:5173" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });
});
