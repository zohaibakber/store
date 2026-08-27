import { decodeAuthenticatedWorkspace, unauthenticatedWorkspace } from "@store/contracts";
import { describe, expect, it, vi } from "vitest";

import { hostAccess } from "../src/host-access";
import type { InventoryHost } from "../src/lib/inventory-host";
import { createCatalogLifetime } from "../src/lib/inventory/lifetime";
import { makeReplayChannel } from "../src/replay-channel";
import { applyWorkspaceSnapshot, type WorkspaceSession } from "../src/session/workspace-session";

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
  authenticatedFetch: globalThis.fetch,
  deviceId: "device",
  openPowerSyncDatabase: async () => {
    throw new Error("unused");
  },
};

const catalogForTest = () =>
  createCatalogLifetime({
    open: async () => ({ dispose: async () => undefined }),
    databaseName: (_host, scope) => scope.organizationId,
  });

describe("applyWorkspaceSnapshot", () => {
  it("patches the snapshot in place when the workspace scope is unchanged", async () => {
    const session = makeReplayChannel<WorkspaceSession>();
    session.publish({ _tag: "Steady", snapshot: authenticated });
    const catalog = catalogForTest();
    catalog.claim({ organizationId: "o1", userId: "u1" });
    const invalidate = vi.fn(async () => undefined);
    const patched = { ...authenticated, isOnline: false };

    await applyWorkspaceSnapshot(
      {
        session,
        catalog,
        access: hostAccess(),
        invalidate,
        flush: (fn) => fn(),
        isCurrent: () => true,
      },
      patched,
    );

    expect(session.current()).toEqual({ _tag: "Steady", snapshot: patched });
    expect(invalidate).not.toHaveBeenCalled();
    expect(catalog.lease()?.scope.organizationId).toBe("o1");
  });

  it("releases the catalog and invalidates on logout without awaiting dispose", async () => {
    let disposeStarted = 0;
    const hanging = new Promise<void>(() => undefined);
    const session = makeReplayChannel<WorkspaceSession>();
    session.publish({ _tag: "Steady", snapshot: authenticated });
    const catalog = createCatalogLifetime({
      open: async () => ({
        dispose: async () => {
          disposeStarted += 1;
          await hanging;
        },
      }),
      databaseName: () => "org",
    });
    const lease = catalog.claim({ organizationId: "o1", userId: "u1" });
    await catalog.open(lease, host);
    const invalidate = vi.fn(async () => undefined);

    const started = Date.now();
    await applyWorkspaceSnapshot(
      {
        session,
        catalog,
        access: hostAccess(),
        invalidate,
        flush: (fn) => fn(),
        isCurrent: () => true,
      },
      unauthenticated,
    );
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(200);
    expect(catalog.lease()).toBeNull();
    expect(invalidate).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(disposeStarted).toBe(1));
    expect(session.current()?._tag).toBe("Steady");
    expect(session.current()?.snapshot.status).toBe("unauthenticated");
  });

  it("does not settle Switching when a newer commit superseded it", async () => {
    const session = makeReplayChannel<WorkspaceSession>();
    session.publish({ _tag: "Steady", snapshot: authenticated });
    const catalog = catalogForTest();
    catalog.claim({ organizationId: "o1", userId: "u1" });
    let releaseInvalidate: (() => void) | undefined;
    const invalidate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseInvalidate = resolve;
        }),
    );

    const first = applyWorkspaceSnapshot(
      {
        session,
        catalog,
        access: hostAccess(),
        invalidate,
        flush: (fn) => fn(),
        isCurrent: () => false,
      },
      unauthenticated,
    );
    expect(session.current()?._tag).toBe("Switching");
    releaseInvalidate?.();
    await first;
    expect(session.current()?._tag).toBe("Switching");
  });
});
