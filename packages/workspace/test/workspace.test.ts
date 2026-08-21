import { AccessToken, RefreshToken, TokenSet, type TokenSet as TokenSetType } from "@store/auth";
import {
  decodeAuthenticatedWorkspace,
  unauthenticatedWorkspace,
  type WorkspaceSnapshot,
} from "@store/contracts";
import { expect, test } from "vitest";

import {
  AuthenticatedWorkspace,
  WorkspaceActivationError,
  type WorkspaceAuthAdapter,
  type WorkspaceStoreAdapter,
} from "../src/workspace";

const authenticated = (organizationId: string): WorkspaceSnapshot =>
  decodeAuthenticatedWorkspace({
    status: "authenticated",
    user: { id: "user-1", name: "Owner", email: "owner@example.com" },
    activeOrganization: {
      id: organizationId,
      name: `Store ${organizationId}`,
      role: "owner",
    },
    organizations: [],
    isOnline: true,
  });

const unauthenticated: WorkspaceSnapshot = unauthenticatedWorkspace({ isOnline: true });

const tokenSet = (label: string): TokenSetType =>
  TokenSet.make({
    accessToken: AccessToken.make(label),
    accessExpiresAt: 1,
    refreshToken: RefreshToken.make(`refresh-${label}`),
    refreshExpiresAt: 2,
  });

const makeAuth = (
  initial: WorkspaceSnapshot,
  adoptSession: (tokens: TokenSetType | null) => Promise<WorkspaceSnapshot> = async (tokens) =>
    tokens ? authenticated(tokens.accessToken) : unauthenticated,
): WorkspaceAuthAdapter => {
  let snapshot = initial;
  const update = async (next: WorkspaceSnapshot) => {
    snapshot = next;
    return next;
  };
  return {
    get snapshot() {
      return snapshot;
    },
    initialize: () => Promise.resolve(snapshot),
    adoptSession: (tokens) => adoptSession(tokens).then(update),
    renewSession: () => Promise.resolve(snapshot),
    signOut: async () => {
      snapshot = unauthenticated;
    },
    apiRequest: () => Promise.reject(new Error("Not used by this test")),
    authRequest: () => Promise.reject(new Error("Not used by this test")),
  };
};

const makeStores = (events: string[], failOrganizationId?: string): WorkspaceStoreAdapter => ({
  open: async (target) => {
    const label = target._tag === "Locked" ? "locked" : target.organizationId;
    events.push(`open:${label}`);
    if (label === failOrganizationId) throw new Error(`Could not open ${label}`);
    return {
      run: () => Promise.reject(new Error("Not used by this test")),
      sync: async () => {
        events.push(`sync:${label}`);
        return {
          phase: "idle",
          lastSyncedAt: Date.now(),
          message: "Local and cloud data are in sync",
          pendingOperations: 0,
          oldestPendingAt: null,
          lastError: null,
          quarantined: false,
        };
      },
      onSyncStatusChange: () => {
        events.push(`subscribe:${label}`);
        return () => events.push(`unsubscribe:${label}`);
      },
      dispose: async () => {
        events.push(`dispose:${label}`);
      },
    };
  },
});

const makeWorkspace = (
  auth: WorkspaceAuthAdapter,
  stores: WorkspaceStoreAdapter,
  events: string[],
) =>
  new AuthenticatedWorkspace({
    auth,
    stores,
    deviceId: "device-1",
    events: {
      publishSnapshot: (snapshot) =>
        events.push(
          `publish:${snapshot.status === "authenticated" ? (snapshot.activeOrganization?.id ?? snapshot.status) : snapshot.status}`,
        ),
      publishSyncStatus: () => undefined,
    },
  });

test("publishes an authenticated workspace only after its store is ready", async () => {
  const events: string[] = [];
  const workspace = makeWorkspace(makeAuth(authenticated("a")), makeStores(events), events);

  await expect(workspace.initialize()).resolves.toMatchObject({
    status: "authenticated",
    activeOrganization: { id: "a" },
  });
  expect(events).toEqual(["open:a", "subscribe:a", "sync:a", "publish:a"]);

  await workspace.dispose();
});

test("serializes competing session adoptions", async () => {
  const events: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const auth = makeAuth(authenticated("initial"), async (tokens) => {
    const label = tokens?.accessToken ?? "anonymous";
    events.push(`auth:${label}:start`);
    if (label === "a") await firstGate;
    events.push(`auth:${label}:finish`);
    return tokens ? authenticated(label) : unauthenticated;
  });
  const workspace = makeWorkspace(auth, makeStores(events), events);
  await workspace.initialize();
  events.length = 0;

  const first = workspace.execute({ _tag: "AdoptSession", tokens: tokenSet("a") });
  const second = workspace.execute({ _tag: "AdoptSession", tokens: tokenSet("b") });
  await Promise.resolve();
  expect(events).toEqual(["auth:a:start"]);

  releaseFirst?.();
  await Promise.all([first, second]);
  expect(events.indexOf("auth:b:start")).toBeGreaterThan(events.indexOf("publish:a"));
  expect(
    workspace.snapshot.status === "authenticated"
      ? workspace.snapshot.activeOrganization?.id
      : undefined,
  ).toBe("b");

  await workspace.dispose();
});

test("falls back to the locked workspace when organization activation fails", async () => {
  const events: string[] = [];
  const workspace = makeWorkspace(makeAuth(authenticated("a")), makeStores(events, "b"), events);
  await workspace.initialize();
  events.length = 0;

  await expect(
    workspace.execute({ _tag: "AdoptSession", tokens: tokenSet("b") }),
  ).rejects.toBeInstanceOf(WorkspaceActivationError);

  expect(events).toEqual([
    "unsubscribe:a",
    "dispose:a",
    "open:b",
    "open:locked",
    "subscribe:locked",
    "publish:unauthenticated",
  ]);
  expect(workspace.snapshot).toMatchObject({
    status: "unauthenticated",
    activeOrganization: null,
    workspaceError: "Could not open b",
  });

  await workspace.dispose();
});

test("publishes the authenticated workspace when its initial sync fails", async () => {
  const events: string[] = [];
  const stores: WorkspaceStoreAdapter = {
    open: async () => ({
      run: () => Promise.reject(new Error("Not used by this test")),
      sync: async () => {
        events.push("sync");
        throw new Error("Network unavailable");
      },
      onSyncStatusChange: () => () => undefined,
      dispose: async () => undefined,
    }),
  };
  const workspace = makeWorkspace(makeAuth(authenticated("a")), stores, events);

  await expect(workspace.initialize()).resolves.toMatchObject({
    status: "authenticated",
    activeOrganization: { id: "a" },
  });
  expect(events).toEqual(["sync", "publish:a"]);

  await workspace.dispose();
});

test("guest Locked refuse stays idle without workspaceError", async () => {
  const events: string[] = [];
  const { GuestWorkspaceRefused } = await import("../src/workspace");
  const stores: WorkspaceStoreAdapter = {
    open: async () => {
      events.push("open:locked");
      throw new GuestWorkspaceRefused({});
    },
  };
  const workspace = makeWorkspace(makeAuth(unauthenticated), stores, events);

  await expect(workspace.initialize()).resolves.toMatchObject({
    status: "unauthenticated",
    workspaceError: null,
  });
  expect(events).toEqual(["open:locked", "publish:unauthenticated"]);
});
