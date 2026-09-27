import {
  decodeAuthenticatedWorkspace,
  unauthenticatedWorkspace,
  type WorkspaceSnapshot,
} from "@store/contracts";
import { createCatalogLifetime, type InventoryHost } from "@store/inventory-react";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { describe, expect, it, vi } from "vitest";

import { hostAccess } from "../src/host-access";
import { makeReplayChannel } from "../src/replay-channel";
import {
  applyWorkspaceSnapshot,
  bindWorkspaceSession,
  refreshBoundWorkspaceSession,
  type SessionChangeBridge,
  type WorkspaceSession,
} from "../src/session/workspace-session";

const unauthenticated = unauthenticatedWorkspace({ isOnline: true });
const authenticated = decodeAuthenticatedWorkspace({
  status: "authenticated",
  isOnline: true,
  user: { id: "u1", name: "A", email: "a@b.c", image: null },
  activeOrganization: { id: "o1", name: "Org", slug: "org", role: "owner" },
  organizations: [{ id: "o1", name: "Org", slug: "org", role: "owner" }],
});

const host: InventoryHost = {
  apiBaseUrl: "http://localhost",
  deviceId: "device",
  openReplica: async () => {
    throw new Error("unused");
  },
};

const catalogForTest = () =>
  createCatalogLifetime({
    open: async () => ({ dispose: async () => undefined }),
    databaseName: (_host, scope) => scope.organizationId,
  });

const steadySession = (snapshot: WorkspaceSnapshot) => {
  const session = makeReplayChannel<WorkspaceSession>();
  session.publish({ _tag: "Steady", snapshot });
  return session;
};

const gatedInvalidate = () => {
  const gates: Array<Deferred.Deferred<void>> = [];
  const invalidate = vi.fn(() => {
    const gate = Deferred.makeUnsafe<void>();
    gates.push(gate);
    return Effect.runPromise(Deferred.await(gate));
  });
  const open = (index: number) => {
    const gate = gates[index];
    if (gate === undefined) throw new Error(`invalidate #${index} was not requested`);
    Deferred.doneUnsafe(gate, Exit.void);
  };
  return { invalidate, open };
};

const sessionBridge = (initial: WorkspaceSnapshot) => {
  const listeners = new Set<(snapshot: WorkspaceSnapshot) => void>();
  let latest = initial;
  const bridge: SessionChangeBridge = {
    getSession: async () => latest,
    onSessionChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const emit = (snapshot: WorkspaceSnapshot) => {
    latest = snapshot;
    for (const listener of listeners) listener(snapshot);
  };
  return { bridge, emit, listeners };
};

describe("applyWorkspaceSnapshot", () => {
  it("patches the snapshot in place when the workspace scope is unchanged", async () => {
    const session = steadySession(authenticated);
    const catalog = catalogForTest();
    catalog.claim({ organizationId: "o1", userId: "u1" });
    const invalidate = vi.fn(async () => undefined);
    const patched = { ...authenticated, isOnline: false };

    await Effect.runPromise(
      applyWorkspaceSnapshot(
        { session, catalog, access: hostAccess(), invalidate, flush: (fn) => fn() },
        patched,
      ),
    );

    expect(session.current()).toEqual({ _tag: "Steady", snapshot: patched });
    expect(invalidate).not.toHaveBeenCalled();
    expect(catalog.lease()?.scope.organizationId).toBe("o1");
  });

  it("releases the catalog and invalidates on logout without awaiting dispose", async () => {
    const disposing = Deferred.makeUnsafe<void>();
    const session = steadySession(authenticated);
    const catalog = createCatalogLifetime({
      open: async () => ({
        dispose: () => {
          Deferred.doneUnsafe(disposing, Exit.void);
          return new Promise<void>(() => undefined);
        },
      }),
      databaseName: () => "org",
    });
    await Effect.runPromise(
      catalog.open(catalog.claim({ organizationId: "o1", userId: "u1" }), host),
    );
    const invalidate = vi.fn(async () => undefined);

    await Effect.runPromise(
      applyWorkspaceSnapshot(
        { session, catalog, access: hostAccess(), invalidate, flush: (fn) => fn() },
        unauthenticated,
      ),
    );

    expect(catalog.lease()).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
    await Effect.runPromise(Deferred.await(disposing));
    expect(session.current()?._tag).toBe("Steady");
    expect(session.current()?.snapshot.status).toBe("unauthenticated");
  });

  it("does not settle Switching when its commit is interrupted", async () => {
    const session = steadySession(authenticated);
    const catalog = catalogForTest();
    catalog.claim({ organizationId: "o1", userId: "u1" });
    const { invalidate, open } = gatedInvalidate();

    const commit = Effect.runFork(
      applyWorkspaceSnapshot(
        { session, catalog, access: hostAccess(), invalidate, flush: (fn) => fn() },
        unauthenticated,
      ),
    );
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect(session.current()?._tag).toBe("Switching");

    await Effect.runPromise(Fiber.interrupt(commit));
    open(0);

    expect(session.current()?._tag).toBe("Switching");
  });
});

describe("bindWorkspaceSession", () => {
  it("lets a newer session change supersede an in-flight commit", async () => {
    const session = steadySession(authenticated);
    const catalog = catalogForTest();
    catalog.claim({ organizationId: "o1", userId: "u1" });
    const { invalidate, open } = gatedInvalidate();
    const { bridge, emit } = sessionBridge(authenticated);
    const binding = bindWorkspaceSession({
      session,
      catalog,
      access: hostAccess(),
      bridge,
      invalidate,
      flush: (fn) => fn(),
    });

    emit(unauthenticated);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    emit(authenticated);
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    open(0);
    await Effect.runPromise(Effect.yieldNow);

    expect(session.current()).toEqual({ _tag: "Switching", snapshot: authenticated });
    expect(catalog.lease()?.scope.organizationId).toBe("o1");

    open(1);
    await vi.waitFor(() =>
      expect(session.current()).toEqual({ _tag: "Steady", snapshot: authenticated }),
    );
    binding.stop();
  });

  it("refreshes through the bound session until that binding stops", async () => {
    const session = steadySession(authenticated);
    const catalog = catalogForTest();
    catalog.claim({ organizationId: "o1", userId: "u1" });
    const { bridge, emit, listeners } = sessionBridge(authenticated);
    const invalidate = vi.fn(async () => undefined);
    const older = bindWorkspaceSession({
      session,
      catalog,
      access: hostAccess(),
      bridge,
      invalidate,
      flush: (fn) => fn(),
    });
    const newer = bindWorkspaceSession({
      session,
      catalog,
      access: hostAccess(),
      bridge,
      invalidate,
      flush: (fn) => fn(),
    });
    older.stop();
    expect(listeners.size).toBe(1);

    emit(unauthenticated);
    await refreshBoundWorkspaceSession();

    expect(session.current()).toEqual({ _tag: "Steady", snapshot: unauthenticated });
    expect(catalog.lease()).toBeNull();

    newer.stop();
    await expect(refreshBoundWorkspaceSession()).rejects.toThrow("Workspace session is not bound.");
  });
});
