import type { WorkspaceSnapshot } from "@store/contracts";
import { expect, test } from "vitest";

import {
  AuthenticatedWorkspace,
  WorkspaceActivationError,
  type WorkspaceAuthAdapter,
  type WorkspaceStoreAdapter,
} from "../src/workspace";

const authenticated = (organizationId: string): WorkspaceSnapshot => ({
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

const unauthenticated: WorkspaceSnapshot = {
  status: "unauthenticated",
  user: null,
  activeOrganization: null,
  organizations: [],
  isOnline: true,
};

const makeAuth = (
  initial: WorkspaceSnapshot,
  adoptSession: (token: string | null) => Promise<WorkspaceSnapshot> = async (token) =>
    token ? authenticated(token) : unauthenticated,
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
    adoptSession: (token) => adoptSession(token).then(update),
    signOut: async () => {
      snapshot = unauthenticated;
    },
    apiRequest: () => Promise.reject(new Error("Not used by this test")),
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
          configured: label !== "locked",
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
        events.push(`publish:${snapshot.activeOrganization?.id ?? snapshot.status}`),
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
  const auth = makeAuth(authenticated("initial"), async (token) => {
    events.push(`auth:${token}:start`);
    if (token === "a") await firstGate;
    events.push(`auth:${token}:finish`);
    return token ? authenticated(token) : unauthenticated;
  });
  const workspace = makeWorkspace(auth, makeStores(events), events);
  await workspace.initialize();
  events.length = 0;

  const first = workspace.execute({ _tag: "AdoptSession", token: "a" });
  const second = workspace.execute({ _tag: "AdoptSession", token: "b" });
  await Promise.resolve();
  expect(events).toEqual(["auth:a:start"]);

  releaseFirst?.();
  await Promise.all([first, second]);
  expect(events.indexOf("auth:b:start")).toBeGreaterThan(events.indexOf("publish:a"));
  expect(workspace.snapshot.activeOrganization?.id).toBe("b");

  await workspace.dispose();
});

test("falls back to the locked workspace when organization activation fails", async () => {
  const events: string[] = [];
  const workspace = makeWorkspace(makeAuth(authenticated("a")), makeStores(events, "b"), events);
  await workspace.initialize();
  events.length = 0;

  await expect(workspace.execute({ _tag: "AdoptSession", token: "b" })).rejects.toBeInstanceOf(
    WorkspaceActivationError,
  );

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
