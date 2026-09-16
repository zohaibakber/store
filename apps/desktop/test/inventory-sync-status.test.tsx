// @vitest-environment happy-dom
import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { InventoryHost } from "../src/lib/inventory-host";
import { createCatalogLifetime } from "../src/lib/inventory/lifetime";
import { openInventoryWorkspace } from "../src/lib/inventory/open";
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
  });

  it("renders the shell from a local replica without opening PowerSync", async () => {
    let powerSyncOpens = 0;
    const replica = openNodeReplicaSqlite({
      organizationId: "org-1",
      userId: "user-1",
      replicaId: "replica-1",
    });
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      authenticatedFetch: globalThis.fetch,
      backend: { _tag: "organizationObject" },
      deviceId: "device",
      openPowerSyncDatabase: async () => {
        powerSyncOpens += 1;
        throw new Error("must not open PowerSync");
      },
      openReplicaSqlite: async () => replica,
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
    expect(powerSyncOpens).toBe(0);
    catalog.release();
  });
});
