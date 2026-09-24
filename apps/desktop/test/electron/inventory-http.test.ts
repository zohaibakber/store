import { describe, expect, it } from "vitest";

import {
  MAX_INVENTORY_COMMAND_BODY_BYTES,
  assertInventoryRequestBodySize,
  makeReplicaSyncApiRequest,
  validatedInventoryUrl,
} from "../../electron/inventory-http";

const apiBaseUrl = "https://api.tabaaq.app";

describe("desktop inventory HTTP allowlist", () => {
  it("rejects the retired inventory mutation routes", () => {
    for (const path of ["mutations", "imports", "invoices"]) {
      expect(() =>
        validatedInventoryUrl(apiBaseUrl, {
          method: "POST",
          url: `https://api.tabaaq.app/api/inventory/${path}`,
        }),
      ).toThrow("The inventory request is outside the configured inventory API.");
    }
  });

  it("rejects retired credential fetches", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/powersync/credentials",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("allows the sync command and receipt routes", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/commands",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/commands");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/replicas",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/replicas");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/pull",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/pull");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/receipts/sale-a",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/receipts/sale-a");
  });

  it("allows snapshot, live-ticket, and nonce live routes", () => {
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/snapshots",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/snapshots");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/live-tickets",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/live-tickets");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/snapshots/snap-1/parts/1",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/snapshots/snap-1/parts/1");
    const nonce = "ab".repeat(32);
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: `https://api.tabaaq.app/api/sync/live?nonce=${nonce}`,
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
      }),
    ).toBe(
      `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`,
    );
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational&afterHorizon=0&waitMs=20000`,
      }),
    ).toBe(
      `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational&afterHorizon=0&waitMs=20000`,
    );
  });

  it("rejects live sync without a nonce and unknown sync paths", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/api/sync/live",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/live",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("rejects a path that would leak credentials", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url: "https://api.tabaaq.app/v1/session/refresh",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/v1/session/refresh",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it.each([
    "https://api.tabaaq.app/api/inventory/legacy-migrations",
    "https://api.tabaaq.app/api/inventory/legacy-migrations/job-123",
    "https://api.tabaaq.app/api/inventory/products",
  ])("rejects leftover or unknown inventory GET %s", (url) => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "GET",
        url,
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("rejects command bodies larger than 1 MiB", () => {
    expect(() =>
      assertInventoryRequestBodySize("x".repeat(MAX_INVENTORY_COMMAND_BODY_BYTES + 1)),
    ).toThrow("The inventory request body exceeds the 1 MiB limit.");
  });

  it("rejects inventory posts that are not on the command allowlist", () => {
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/legacy-migrations",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
    expect(() =>
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/inventory/not-a-command",
      }),
    ).toThrow("The inventory request is outside the configured inventory API.");
  });

  it("forwards allowlisted worker sync requests through the authenticated fetch", async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const syncApiRequest = makeReplicaSyncApiRequest(apiBaseUrl, async (url, init) => {
      requests.push({ url, init });
      return new Response('{"ok":true}', { status: 200 });
    });
    await expect(
      syncApiRequest("/api/sync/commands", { method: "POST", body: "{}" }),
    ).resolves.toEqual({ ok: true, status: 200, bodyText: '{"ok":true}' });
    expect(requests).toEqual([
      {
        url: "https://api.tabaaq.app/api/sync/commands",
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      },
    ]);
    await expect(syncApiRequest("/api/inventory/products")).rejects.toThrow(
      "The inventory request is outside the configured inventory API.",
    );
    expect(requests).toHaveLength(1);
  });

  it("allows the live ticket mint and its SSE upgrade", () => {
    const nonce = "ab".repeat(32);
    expect(
      validatedInventoryUrl(apiBaseUrl, {
        method: "POST",
        url: "https://api.tabaaq.app/api/sync/live-tickets",
      }),
    ).toBe("https://api.tabaaq.app/api/sync/live-tickets");
    const live = `https://api.tabaaq.app/api/sync/live?nonce=${nonce}&replicaId=replica-a&subscription=operational`;
    expect(validatedInventoryUrl(apiBaseUrl, { method: "GET", url: live })).toBe(live);
  });
});
