import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { decodeAuthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadSessionSnapshot } from "../src/session-broker";
import { SessionHttpClient } from "../src/session-http";

const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  user: { id: "user-1", name: "Owner", email: "owner@example.com" },
  activeOrganization: null,
  organizations: [],
  isOnline: true,
});

describe("session snapshot persistence", () => {
  it("keeps a verified session authenticated when durable persistence fails", async () => {
    let local: WorkspaceSnapshot = {
      status: "unauthenticated",
      user: null,
      activeOrganization: null,
      organizations: [],
      isOnline: false,
    };
    const publish = vi.fn((snapshot: WorkspaceSnapshot) => {
      local = snapshot;
      return snapshot;
    });
    const tokens = TokenSet.make({
      accessToken: AccessToken.make("access-token"),
      accessExpiresAt: Date.now() + 60_000,
      refreshToken: RefreshToken.make("refresh-token"),
      refreshExpiresAt: Date.now() + 120_000,
    });
    const http = new SessionHttpClient({
      apiBaseUrl: "https://api.example.com",
      authBaseUrl: "https://auth.example.com",
      tokens: { get: () => tokens, set: vi.fn() },
      fetch: vi.fn(async () => Response.json(authenticated)),
      refreshSession: async () => tokens,
      needsRefresh: () => false,
    });

    const result = await loadSessionSnapshot({
      http,
      getLocalSnapshot: () => local,
      publish,
      persistAuthenticated: () => Promise.reject(new Error("Secret store is locked.")),
    });

    expect(result).toMatchObject({
      status: "authenticated",
      isOnline: true,
      workspaceError: "Secret store is locked.",
    });
    expect(publish.mock.calls.map(([snapshot]) => snapshot.status)).toEqual([
      "authenticated",
      "authenticated",
    ]);
  });
});
