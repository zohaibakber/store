import { openNodeReplicaSqlite } from "@store/client-db/node-sqlite";
import { describe, expect, it } from "vitest";

import type { InventoryHost } from "../src/lib/inventory-host";
import { openInventoryWorkspace } from "../src/lib/inventory/open";

const scope = { organizationId: "org-1", userId: "user-1" };

const identity = {
  organizationId: scope.organizationId,
  userId: scope.userId,
  replicaId: "replica-1",
};

describe("openInventoryWorkspace", () => {
  it("opens the organization-object replica", async () => {
    const replica = openNodeReplicaSqlite(identity);
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      authenticatedFetch: globalThis.fetch,
      deviceId: "device",
      openReplicaSqlite: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    expect(inventory.sync).toEqual({ _tag: "caughtUp" });
    await expect(inventory.actions.createCategory({ name: "Tea" })).rejects.toThrow(
      "The organization-object backend does not accept catalog commands.",
    );
    await inventory.dispose();
  });

  it("does not open a workspace when the replica opener fails", async () => {
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      authenticatedFetch: globalThis.fetch,
      deviceId: "device",
      openReplicaSqlite: async () => {
        throw new Error("replica missing");
      },
    };
    await expect(openInventoryWorkspace(host, scope)).rejects.toThrow("replica missing");
  });

  it("reports saved-locally from the outbox without waiting for a remote connection", async () => {
    const replica = openNodeReplicaSqlite(identity);
    replica.withWrite(
      (sqlite) => {
        sqlite
          .prepare(
            `insert into command_outbox (
              operationId, status, envelopeJson, clientSequence, createdAt, attempts, outcomeUncertain
            ) values ('op-1', 'pending', '{}', '1', 1, 0, 0)`,
          )
          .run();
      },
      [],
      [],
    );
    const host: InventoryHost = {
      apiBaseUrl: "http://localhost",
      authenticatedFetch: globalThis.fetch,
      deviceId: "device",
      openReplicaSqlite: async () => replica,
    };
    const inventory = await openInventoryWorkspace(host, scope);
    expect(inventory.sync).toEqual({ _tag: "savedLocally" });
    expect(inventory.commands.status()).toEqual({ _tag: "savedLocally" });
    await inventory.dispose();
  });
});
