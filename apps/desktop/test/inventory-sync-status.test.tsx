// @vitest-environment happy-dom
import type { ReplicaSyncHealth } from "@store/client-db";
import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import {
  createCatalogLifetime,
  openInventoryWorkspace,
  type InventoryHost,
} from "@store/inventory-react";
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InventoryProvider, InventoryReady } from "../src/lib/inventory/provider";
import { HeaderSyncStatus, InventorySyncStatusView } from "../src/lib/inventory/sync-status";
import { renderWithRouter } from "./lib/render";

const statusButton = (label: string) =>
  screen.getByRole("button", { name: `Sync status: ${label}` });

const findStatusButton = (label: string) =>
  screen.findByRole("button", { name: `Sync status: ${label}` });

describe("InventorySyncStatusView", () => {
  it("names every sync state on the header button", () => {
    const { rerender } = renderWithRouter(
      <InventorySyncStatusView status={{ _tag: "savedLocally" }} />,
    );
    expect(statusButton("Saved locally")).toBeTruthy();

    rerender(<InventorySyncStatusView status={{ _tag: "pendingConfirmation" }} />);
    expect(statusButton("Pending confirmation")).toBeTruthy();

    rerender(<InventorySyncStatusView status={{ _tag: "caughtUp" }} />);
    expect(statusButton("Caught up")).toBeTruthy();

    rerender(
      <InventorySyncStatusView
        status={{ _tag: "rejected", message: "The authority rejected a local command." }}
      />,
    );
    expect(statusButton("The authority rejected a local command.")).toBeTruthy();

    rerender(
      <InventorySyncStatusView
        status={{ _tag: "storageError", message: "Local replica storage failed." }}
      />,
    );
    expect(statusButton("Local replica storage failed.")).toBeTruthy();

    rerender(
      <InventorySyncStatusView
        status={{ _tag: "recoveryRequired", message: "Sync needs recovery." }}
      />,
    );
    expect(statusButton("Sync needs recovery.")).toBeTruthy();
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
        <HeaderSyncStatus />
        <InventoryReady>
          <p>Ready shell</p>
        </InventoryReady>
      </InventoryProvider>,
    );
    expect(await findStatusButton("Caught up")).toBeTruthy();
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
        <HeaderSyncStatus />
        <InventoryReady>
          <p>Ready shell</p>
        </InventoryReady>
      </InventoryProvider>,
    );
    expect(await findStatusButton("Caught up")).toBeTruthy();

    act(() => {
      emit({ _tag: "storageError", message: "Local replica storage failed." });
    });
    expect(await findStatusButton("Local replica storage failed.")).toBeTruthy();

    act(() => {
      emit({ _tag: "recoveryRequired", message: "Sync needs recovery." });
    });
    expect(await findStatusButton("Sync needs recovery.")).toBeTruthy();

    act(() => {
      emit({ _tag: "running" });
    });
    expect(await findStatusButton("Caught up")).toBeTruthy();
    catalog.release();
    await vi.waitFor(() => {
      expect(listeners.size).toBe(0);
    });
  });
});
