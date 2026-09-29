import { AccessToken, RefreshToken, TokenSet } from "@store/auth";
import { decodeAuthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  adoptAuthenticatedSnapshot,
  loadSessionSnapshot,
  renewSessionSnapshot,
} from "../src/session-broker";
import { MemoryTokenStore, SessionHttpClient } from "../src/session-http";

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
      refreshSession: async () => null,
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

  it("does not keep a cached authenticated snapshot when tokens are gone", async () => {
    let local: WorkspaceSnapshot = authenticated;
    const publish = vi.fn((snapshot: WorkspaceSnapshot) => {
      local = snapshot;
      return snapshot;
    });
    const clearAuthenticated = vi.fn(async () => undefined);
    const http = new SessionHttpClient({
      apiBaseUrl: "https://api.example.com",
      authBaseUrl: "https://auth.example.com",
      tokens: { get: () => null, set: vi.fn() },
      fetch: vi.fn(),
      refreshSession: async () => null,
      needsRefresh: () => false,
    });

    const result = await loadSessionSnapshot({
      http,
      getLocalSnapshot: () => local,
      publish,
      clearAuthenticated,
    });

    expect(result).toMatchObject({ status: "unauthenticated", isOnline: true });
    expect(clearAuthenticated).toHaveBeenCalledOnce();
    expect(http.tokens.get()).toBeNull();
  });

  it("renews from the workspace a refresh carries without reading the session", async () => {
    const issue = (suffix: string) =>
      TokenSet.make({
        accessToken: AccessToken.make(`access-${suffix}`),
        accessExpiresAt: Date.now() + 60_000,
        refreshToken: RefreshToken.make(`session-${suffix}.secret`),
        refreshExpiresAt: Date.now() + 120_000,
      });
    const renew = async () => {
      let local: WorkspaceSnapshot = { ...authenticated, isOnline: false };
      const persisted: Array<WorkspaceSnapshot> = [];
      const reads: Array<string> = [];
      const store = new MemoryTokenStore();
      store.set(issue("old"));
      const hooks = {
        http: new SessionHttpClient({
          apiBaseUrl: "https://api.example.com",
          authBaseUrl: "https://auth.example.com",
          tokens: store,
          fetch: async (input) => {
            reads.push(new Request(input).url);
            return Response.json(authenticated);
          },
          refreshSession: async () => {
            const next = issue("new");
            store.set(next);
            const workspace = {
              ...authenticated,
              user: { ...authenticated.user, name: "Renewed" },
            };
            await adoptAuthenticatedSnapshot(hooks, workspace);
            return { ...next, workspace };
          },
          needsRefresh: (_tokens, force) => force,
        }),
        getLocalSnapshot: () => local,
        publish: (snapshot: WorkspaceSnapshot) => {
          local = snapshot;
          return snapshot;
        },
        persistAuthenticated: async (snapshot: WorkspaceSnapshot) => {
          persisted.push(snapshot);
        },
      };
      const renewed = await renewSessionSnapshot(hooks);
      return { renewed, reads, persisted };
    };

    const adopted = await renew();
    expect(adopted.reads).toEqual([]);
    expect(adopted.renewed).toMatchObject({ status: "authenticated", isOnline: true });
    expect(adopted.renewed.user?.name).toBe("Renewed");
    expect(adopted.persisted).toHaveLength(1);
  });
});
