import type { WorkspaceSnapshot } from "@store/contracts";
import { expect, test } from "vitest";

import {
  AuthenticatedWorkspace,
  WorkspaceActivationError,
  type WorkspaceAuthAdapter,
  type WorkspaceStoreAdapter,
} from "../../electron/workspace";

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
  switchOrganization: (organizationId: string) => Promise<WorkspaceSnapshot> = async (id) =>
    authenticated(id),
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
    signIn: () => update(authenticated("a")),
    signUp: () => update(authenticated("a")),
    signOut: async () => {
      snapshot = unauthenticated;
    },
    switchOrganization: ({ organizationId }) => switchOrganization(organizationId).then(update),
    createOrganization: ({ name }) => update(authenticated(name)),
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
  expect(events).toEqual(["open:a", "subscribe:a", "publish:a"]);

  await workspace.dispose();
});

test("serializes competing organization transitions", async () => {
  const events: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const auth = makeAuth(authenticated("initial"), async (organizationId) => {
    events.push(`auth:${organizationId}:start`);
    if (organizationId === "a") await firstGate;
    events.push(`auth:${organizationId}:finish`);
    return authenticated(organizationId);
  });
  const workspace = makeWorkspace(auth, makeStores(events), events);
  await workspace.initialize();
  events.length = 0;

  const first = workspace.execute({ _tag: "SwitchOrganization", organizationId: "a" });
  const second = workspace.execute({ _tag: "SwitchOrganization", organizationId: "b" });
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

  await expect(
    workspace.execute({ _tag: "SwitchOrganization", organizationId: "b" }),
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
