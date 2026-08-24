import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { appFor } from "../lib/app";

const command = {
  kind: "categories" as const,
  commandId: "legacy-v1:device-1:categories:0",
  deviceId: "device-1",
  occurredAt: 1_700_000_000_000,
  rows: [
    {
      id: "medicine",
      name: "Medicine",
      tracksPacks: true,
      createdAt: 1_600_000_000_000,
      updatedAt: 1_650_000_000_000,
    },
  ],
};

describe("legacy catalog migrations", () => {
  it("requires an authenticated organization", async () => {
    const response = await appFor(false).request("/api/inventory/legacy-migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });

    expect(response.status).toBe(401);
  });

  it("binds imported rows to the authenticated organization", async () => {
    const migrateLegacyCatalog = vi.fn(() => Effect.succeed({ imported: 1, skipped: 0, txid: 42 }));
    const response = await appFor(true, { migrateLegacyCatalog }).request(
      "/api/inventory/legacy-migrations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 1, skipped: 0, txid: 42 });
    expect(migrateLegacyCatalog).toHaveBeenCalledWith(
      { organizationId: "org-1", userId: "user-1" },
      command,
    );
  });

  it("rejects oversized chunks at the HTTP boundary", async () => {
    const response = await appFor(true).request("/api/inventory/legacy-migrations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...command,
        rows: Array.from({ length: 251 }, (_, index) => ({
          ...command.rows[0],
          id: `category-${index}`,
        })),
      }),
    });

    expect(response.status).toBe(400);
  });

  it("still accepts the live AppImage 250-row product payload", async () => {
    const migrateLegacyCatalog = vi.fn(() =>
      Effect.succeed({ imported: 250, skipped: 0, txid: 42 }),
    );
    const response = await appFor(true, { migrateLegacyCatalog }).request(
      "/api/inventory/legacy-migrations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "products",
          commandId: "legacy-v1:device-1:products:0",
          deviceId: "device-1",
          occurredAt: 1_700_000_000_000,
          rows: Array.from({ length: 250 }, (_, index) => ({
            id: `product-${index}`,
            name: `Product ${index}`,
            categoryId: "medicine",
            aisle: null,
            composition: null,
            strength: null,
            unitsPerPack: 1,
            packPrice: null,
            unitPrice: null,
            visible: true,
            createdAt: 1_600_000_000_000,
            updatedAt: 1_650_000_000_000,
          })),
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imported: 250, skipped: 0, txid: 42 });
  });
});
