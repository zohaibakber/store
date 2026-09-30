// @vitest-environment happy-dom
import type { ReplicaSyncHealth } from "@store/client-db";
import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import {
  createCatalogLifetime,
  openInventoryWorkspace,
  type InventoryHost,
} from "@store/inventory-react";
import { act, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { SidebarMenu, SidebarProvider } from "../src/components/ui/sidebar";
import { InventoryProvider, InventoryReady } from "../src/lib/inventory/provider";
import { SidebarSyncButton } from "../src/lib/inventory/sync-status";
import { renderWithRouter } from "./lib/render";

const inSidebar = (ui: ReactNode) => (
  <SidebarProvider>
    <SidebarMenu>{ui}</SidebarMenu>
  </SidebarProvider>
);

const findStatusButton = (label: string) => screen.findByRole("button", { name: label });

describe("SidebarSyncButton", () => {
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
        {inSidebar(<SidebarSyncButton />)}
        <InventoryReady>
          <p>Ready shell</p>
        </InventoryReady>
      </InventoryProvider>,
    );
    expect(await findStatusButton("Sync now")).toBeTruthy();
    expect(screen.getByText("Ready shell")).toBeTruthy();

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
    expect(await findStatusButton("Sync now")).toBeTruthy();
    catalog.release();
    await vi.waitFor(() => {
      expect(listeners.size).toBe(0);
    });
  });
});
