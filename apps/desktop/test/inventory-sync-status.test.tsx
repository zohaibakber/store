import type { ReplicaSyncHealth } from "@store/client-db";
import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
// @vitest-environment happy-dom
import {
  createCatalogLifetime,
  openInventoryWorkspace,
  type InventoryHost,
} from "@store/inventory-react";
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InventoryProvider, InventoryReady } from "../src/lib/inventory/provider";
import { InventorySyncStatusView } from "../src/lib/inventory/sync-status";
import { renderWithRouter } from "./lib/render";

describe("InventorySyncStatusView", () => {
  it("renders the named sync states", () => {
    const { rerender } = renderWithRouter(
      <InventorySyncStatusView status={{ _tag: "savedLocally" }} />,
    );
    expect(screen.getByRole("status").textContent).toBe("Saved locally");

    rerender(<InventorySyncStatusView status={{ _tag: "pendingConfirmation" }} />);
    expect(screen.getByRole("status").textContent).toBe("Pending confirmation");

    rerender(<InventorySyncStatusView status={{ _tag: "caughtUp" }} />);
    expect(screen.getByRole("status").textContent).toBe("Caught up");

    rerender(
      <InventorySyncStatusView
        status={{ _tag: "rejected", message: "The authority rejected a local command." }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("The authority rejected a local command.");

    rerender(
      <InventorySyncStatusView
        status={{ _tag: "storageError", message: "Local replica storage failed." }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Local replica storage failed.");

    rerender(
      <InventorySyncStatusView
        status={{ _tag: "recoveryRequired", message: "Sync needs recovery." }}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Sync needs recovery.");
  });

  it("renders the shell from a local replica", async () => {
    const replica = await openNodeReplicaSqlite({
      organizationId: "org-1",
      userId: "user-1",
      replicaId: "replica-1",
    });
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: "device",
      openReplica: async () => replica,
    };
    const catalog = createCatalogLifetime({
      open: openInventoryWorkspace,
      databaseName: () => "org-1",
    });
    const lease = catalog.claim({ organizationId: "org-1", userId: "user-1" });
    renderWithRouter(
      <InventoryProvider catalog={catalog} host={host} lease={lease}>
        <InventoryReady>
          <p>Ready shell</p>
        </InventoryReady>
      </InventoryProvider>,
    );
    expect(await screen.findByText("Caught up")).toBeTruthy();
    expect(screen.getByText("Ready shell")).toBeTruthy();
    catalog.release();
  });

  it("follows the owned session's scheduler halts into the sync status", async () => {
    const replica = await openNodeReplicaSqlite({
      organizationId: "org-1",
      userId: "user-1",
      replicaId: "replica-1",
    });
    const listeners = new Set<(health: ReplicaSyncHealth) => void>();
    const emit = (health: ReplicaSyncHealth) => {
      for (const listener of listeners) listener(health);
    };
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      deviceId: "device",
      openReplica: async () => ({
        ...replica,
        subscribeSyncHealth: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      }),
    };
    const catalog = createCatalogLifetime({
      open: openInventoryWorkspace,
      databaseName: () => "org-1",
    });
    const lease = catalog.claim({ organizationId: "org-1", userId: "user-1" });
    renderWithRouter(
      <InventoryProvider catalog={catalog} host={host} lease={lease}>
        <InventoryReady>
          <p>Ready shell</p>
        </InventoryReady>
      </InventoryProvider>,
    );
    expect(await screen.findByText("Caught up")).toBeTruthy();

    act(() => {
      emit({ _tag: "storageError", message: "Local replica storage failed." });
    });
    expect(await screen.findByText("Local replica storage failed.")).toBeTruthy();

    act(() => {
      emit({ _tag: "recoveryRequired", message: "Sync needs recovery." });
    });
    expect(await screen.findByText("Sync needs recovery.")).toBeTruthy();

    act(() => {
      emit({ _tag: "running" });
    });
    expect(await screen.findByText("Caught up")).toBeTruthy();
    catalog.release();
    await vi.waitFor(() => {
      expect(listeners.size).toBe(0);
    });
  });
});
