import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, issueTursoCredentials } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TURSO_PLATFORM_API_TOKEN;
  delete process.env.TURSO_ORGANIZATION_SLUG;
  delete process.env.TURSO_DATABASE_URL_TEMPLATE;
});

const session = {
  user: {
    id: "user-1",
    name: "Member",
    email: "member@example.com",
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: "session-1",
    token: "secret",
    userId: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    activeOrganizationId: "org-1",
  },
};

const appFor = (member: boolean, authenticated = true) =>
  createApp({
    authApi: {
      getSession: async () => (authenticated ? session : null),
      getActiveMember: async () => (member ? { id: "member-1" } : null),
    },
    authHandler: async () => new Response(null, { status: 404 }),
    issueSyncCredentials: async (organizationId) => ({
      organizationId,
      url: "libsql://org-1.example.invalid",
      authToken: "database-scoped-token",
      expiresAt: "2026-07-12T00:15:00.000Z",
    }),
  });

describe("organization authorization", () => {
  it("denies unauthenticated upload requests", async () => {
    const response = await appFor(false, false).request("/api/uploads", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("denies users who are no longer active organization members", async () => {
    const response = await appFor(false).request("/api/uploads", { method: "POST" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { code: "ORGANIZATION_ACCESS_DENIED" },
    });
  });

  it("allows an active member to request database-scoped sync credentials", async () => {
    const response = await appFor(true).request("/api/sync/credentials");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      organizationId: "org-1",
      url: "libsql://org-1.example.invalid",
      authToken: "database-scoped-token",
      expiresAt: "2026-07-12T00:15:00.000Z",
    });
  });

  it("allows members through upload authorization before validating input", async () => {
    const response = await appFor(true).request("/api/uploads", { method: "POST" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "FILES_REQUIRED" } });
  });
});

describe("organization database provisioning", () => {
  it("creates a missing tenant database before issuing its scoped token", async () => {
    process.env.TURSO_PLATFORM_API_TOKEN = "platform-token-for-test";
    process.env.TURSO_ORGANIZATION_SLUG = "store-platform";
    process.env.TURSO_DATABASE_URL_TEMPLATE =
      "libsql://{databaseName}-{tursoOrganization}.example.invalid";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ database: { Name: "store-org-1" } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ jwt: "database-token-for-test" })));

    const credentials = await issueTursoCredentials("org-1");

    expect(credentials).toMatchObject({
      organizationId: "org-1",
      url: "libsql://store-org-1-store-platform.example.invalid",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ name: "store-org-1", group: "default" }),
    });
  });
});
