import { AccessToken, IssuedSession, RefreshToken, TokenSet } from "@store/auth";
import { decodeAuthenticatedWorkspace, type WorkspaceSnapshot } from "@store/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { describe, expect, it, vi } from "vitest";

import {
  adoptAuthenticatedSnapshot,
  adoptSessionTokens,
  loadSessionSnapshot,
  renewSessionSnapshot,
  type SessionSnapshotHooks,
} from "../src/session-broker";
import { MemoryTokenStore, layerSessionHttp, type RefreshedTokenSet } from "../src/session-http";

const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  user: { id: "user-1", name: "Owner", email: "owner@example.com", image: null },
  activeOrganization: { id: "org-1", name: "Store", slug: null, role: "owner" },
  organizations: [{ id: "org-1", name: "Store", slug: null, role: "owner" }],
  isOnline: true,
});

const issue = (suffix: string) =>
  TokenSet.make({
    accessToken: AccessToken.make(`access-${suffix}`),
    accessExpiresAt: Date.now() + 60_000,
    refreshToken: RefreshToken.make(`session-${suffix}.secret`),
    refreshExpiresAt: Date.now() + 120_000,
  });

const sessionRuntime = (options: {
  readonly store: MemoryTokenStore;
  readonly fetch: typeof fetch;
  readonly onRefreshed?: (refreshed: RefreshedTokenSet) => Effect.Effect<void>;
}) =>
  ManagedRuntime.make(
    layerSessionHttp({
      apiBaseUrl: "https://api.example.com",
      authBaseUrl: "https://auth.example.com",
      tokens: options.store,
      credential: "refreshToken",
      onRefreshed: options.onRefreshed ?? (() => Effect.void),
      onRejected: Effect.void,
    }).pipe(
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, options.fetch)),
    ),
  );

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
    const store = new MemoryTokenStore();
    store.set(issue("current"));
    const runtime = sessionRuntime({
      store,
      fetch: async () => Response.json(authenticated),
    });

    const result = await runtime.runPromise(
      loadSessionSnapshot({
        getLocalSnapshot: () => local,
        publish,
        persistAuthenticated: () => Effect.fail(new Error("Secret store is locked.")),
      }),
    );

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
    const clearAuthenticated = vi.fn(() => undefined);
    const store = new MemoryTokenStore();
    const fetch = vi.fn(async () => Response.json(authenticated));
    const runtime = sessionRuntime({ store, fetch });

    const result = await runtime.runPromise(
      loadSessionSnapshot({
        getLocalSnapshot: () => local,
        publish,
        clearAuthenticated: Effect.sync(clearAuthenticated),
      }),
    );

    expect(result).toMatchObject({ status: "unauthenticated", isOnline: true });
    expect(clearAuthenticated).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get()).toBeNull();
  });

  it("renews from the workspace a refresh carries without reading the session", async () => {
    let local: WorkspaceSnapshot = { ...authenticated, isOnline: false };
    const persisted: Array<WorkspaceSnapshot> = [];
    const reads: Array<string> = [];
    const store = new MemoryTokenStore();
    store.set(issue("old"));
    const hooks: SessionSnapshotHooks = {
      getLocalSnapshot: () => local,
      publish: (snapshot) => {
        local = snapshot;
        return snapshot;
      },
      persistAuthenticated: (snapshot) =>
        Effect.sync(() => {
          persisted.push(snapshot);
        }),
    };
    const runtime = sessionRuntime({
      store,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url === "https://auth.example.com/v1/session/refresh") {
          return Response.json({
            ...issue("new"),
            workspace: { ...authenticated, user: { ...authenticated.user, name: "Renewed" } },
          });
        }
        reads.push(request.url);
        return Response.json(authenticated);
      },
      onRefreshed: (refreshed) =>
        adoptAuthenticatedSnapshot(hooks, refreshed.workspace).pipe(Effect.asVoid),
    });

    const renewed = await runtime.runPromise(renewSessionSnapshot(hooks));

    expect(reads).toEqual([]);
    expect(renewed).toMatchObject({ status: "authenticated", isOnline: true });
    expect(renewed.user?.name).toBe("Renewed");
    expect(persisted).toHaveLength(1);
    expect(store.get()?.accessToken).toBe("access-new");
  });

  it("adopts the workspace a sign-in carries and reads the session only without one", async () => {
    let local: WorkspaceSnapshot = { ...authenticated, isOnline: false };
    const reads: Array<string> = [];
    const store = new MemoryTokenStore();
    const hooks: SessionSnapshotHooks = {
      getLocalSnapshot: () => local,
      publish: (snapshot) => {
        local = snapshot;
        return snapshot;
      },
    };
    const runtime = sessionRuntime({
      store,
      fetch: async (input, init) => {
        reads.push(new Request(input, init).url);
        return Response.json(authenticated);
      },
    });

    const tokens = issue("signed-in");
    const signedIn = await runtime.runPromise(
      adoptSessionTokens(
        hooks,
        Schema.decodeUnknownSync(IssuedSession)({
          ...tokens,
          workspace: { ...authenticated, user: { ...authenticated.user, name: "Issued" } },
        }),
      ),
    );

    expect(reads).toEqual([]);
    expect(signedIn).toMatchObject({ status: "authenticated", isOnline: true });
    expect(signedIn.user?.name).toBe("Issued");
    expect(store.get()).toEqual(tokens);

    const fallback = await runtime.runPromise(adoptSessionTokens(hooks, issue("legacy")));

    expect(reads).toEqual(["https://api.example.com/api/auth/session"]);
    expect(fallback.user?.name).toBe("Owner");
  });
});
